// HTTP routes of the bank's KYC, suitability and AgentMandate (spec 05). The provider callback is public and
// authenticated by its HMAC; everything else sits behind the members' internal token (called by the api).
import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import type { Hex } from 'viem';
import { checkVendorSignature, type KycService } from './kyc.js';
import type { MandateService } from './mandate.js';
import { createTransaction, pollTransaction, readIdentity } from './eudiw.js';

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
const userRef = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);

const vendorResult = z.object({
  sessionId: z.string().uuid().or(z.string().min(1).max(64)),
  decision: z.enum(['approved', 'rejected']),
  liveness: z.boolean(),
  person: z.object({ fullName: z.string().min(1).max(200), birthdate: z.string().max(10), nationality: z.string().max(3), documentNumber: z.string().max(40) }),
  docHash: bytes32,
  selfieHash: bytes32,
});

export function kycPublicRoutes(r: Router, d: { kyc: KycService; vendorHmac: string }) {
  r.post('/kyc/vendor/callback', h(async (req, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    if (!checkVendorSignature(d.vendorHmac, raw, req.header('x-praetor-signature'))) return res.status(401).json({ error: 'unauthorized' });
    await d.kyc.vendorResult(vendorResult.parse(req.body));
    res.status(204).end();
  }));
}

export type EudiConfig = { backend: string; fetch?: typeof fetch };

export function kycRoutes(r: Router, d: { kyc: KycService; mandate: MandateService; eudi?: EudiConfig }) {
  const f = d.eudi?.fetch ?? fetch;

  r.post('/kyc/sessions', h(async (req, res) => {
    const b = z.object({ userRef, account: address, method: z.enum(['vendor', 'eudi']) }).parse(req.body);
    const eudi = d.eudi ? { createTransaction: (body: unknown) => createTransaction(f, d.eudi!.backend, body) } : undefined;
    res.json(await d.kyc.startSession(b.userRef, b.method, b.account, eudi));
  }));

  // EUDI: each status read polls the verifier backend once; a verified presentation is reduced to the age boolean
  // and the jurisdiction on the spot (the birthdate never leaves readIdentity).
  r.get('/kyc/sessions/:id', h(async (req, res) => {
    const s = await d.kyc.sessionOf(z.string().max(64).parse(req.params.id));
    if (!s) return res.status(404).json({ error: 'unknown session' });
    if (s.method === 'eudi' && s.state === 'pending' && s.eudiTx && d.eudi) {
      const p = await pollTransaction(f, d.eudi.backend, s.eudiTx);
      if (p.state === 'verified') await d.kyc.eudiResult(s.id, readIdentity(p.vpToken));
      else if (p.state !== 'pending') await d.kyc.eudiResult(s.id, { ageOver18: false, country: null });
    }
    res.json(await d.kyc.status(s.userRef));
  }));

  r.get('/kyc/status/:userRef', h(async (req, res) => {
    res.json(await d.kyc.status(userRef.parse(req.params.userRef)));
  }));

  r.post('/suitability', h(async (req, res) => {
    const b = z.object({ userRef, answers: z.array(z.number().int()).length(5) }).parse(req.body);
    res.json(await d.kyc.suitability(b.userRef, b.answers));
  }));

  r.post('/kyc/revoke', h(async (req, res) => {
    const b = z.object({ userRef }).parse(req.body);
    await d.kyc.revoke(b.userRef);
    res.json(await d.kyc.status(b.userRef));
  }));

  r.post('/kya/mandate/prepare', h(async (req, res) => {
    const b = z.object({ userRef, account: address, agentKey: address, scopes: z.array(z.string()).min(1).max(8), mandateHash: bytes32, agentMeasurement: bytes32 }).parse(req.body);
    res.json(await d.mandate.prepare(b));
  }));

  r.post('/kya/mandate/sign', h(async (req, res) => {
    const b = z.object({
      draftId: z.string().max(64),
      assertion: z.object({ credentialId: bytes32, authenticatorData: hex, clientDataJSON: z.string().max(2048), r: hex, s: hex }),
    }).parse(req.body);
    const a = b.assertion as { credentialId: Hex; authenticatorData: Hex; clientDataJSON: string; r: Hex; s: Hex };
    res.json(await d.mandate.sign(b.draftId, a));
  }));
}
