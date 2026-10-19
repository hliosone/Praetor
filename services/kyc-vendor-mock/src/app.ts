// kyc-vendor-mock (spec 05): imitation of a hosted KYC provider, clearly labelled "Demo KYC provider". The browser
// sends the ID photo, the typed MRZ fields, a selfie and the frames of a scripted head-turn check; the images are
// hashed in memory and dropped (never written), and the decision goes to bank-service signed with KYC_VENDOR_HMAC.
// Name screening and the age rule are the bank's.
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';

export const LIVENESS_STEPS = ['left', 'right', 'center'] as const;

/** The three prompts in order, one frame each, and frames that differ (a still photo held up repeats itself). */
export function evaluateLiveness(l: { steps: string[]; frames: string[] }): boolean {
  if (l.steps.length !== LIVENESS_STEPS.length || l.steps.some((s, i) => s !== LIVENESS_STEPS[i])) return false;
  if (l.frames.length !== LIVENESS_STEPS.length) return false;
  return new Set(l.frames).size === l.frames.length;
}

const dataUrl = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const submission = z.object({
  session: z.string().min(1).max(64),
  person: z.object({
    fullName: z.string().trim().min(2).max(200),
    birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    nationality: z.string().regex(/^[A-Za-z]{2}$/),
    documentNumber: z.string().trim().min(3).max(40),
  }),
  idImage: dataUrl,
  selfie: dataUrl,
  liveness: z.object({ steps: z.array(z.string().max(16)).max(8), frames: z.array(dataUrl).max(8) }),
});

/** What the person must fix, in the page's own words (the schema's paths mean nothing to them). */
const FIELD: Record<string, string> = {
  fullName: 'full name', birthdate: 'date of birth', nationality: 'nationality (2 letters)', documentNumber: 'document number',
  idImage: 'photo of the document (JPEG, PNG or WebP, under 6 MB)', selfie: 'selfie and liveness capture', liveness: 'selfie and liveness capture', session: 'session',
};
const missing = (issues: z.ZodIssue[]) => [...new Set(issues.map((i) => FIELD[String(i.path[0] === 'person' ? i.path[1] : i.path[0])] ?? 'form'))].join(', ');

const hashImage = (d: string) => `0x${createHash('sha256').update(Buffer.from(d.slice(d.indexOf(',') + 1), 'base64')).digest('hex')}`;

export type MockDeps = { bankUrl: string; hmacSecret: string; publicUrl: string; fetch?: typeof fetch };

export function createMockApp(d: MockDeps) {
  const f = d.fetch ?? fetch;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '24mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/kyc-mock', express.static(fileURLToPath(new URL('../public/', import.meta.url)), { index: 'index.html' }));

  app.post('/kyc-mock/api/submit', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const parsed = submission.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: `incomplete document or capture: ${missing(parsed.error.issues)}` });
      const s = parsed.data;
      const decision = {
        sessionId: s.session,
        decision: 'approved' as const,
        liveness: evaluateLiveness(s.liveness),
        person: { ...s.person, nationality: s.person.nationality.toUpperCase() },
        docHash: hashImage(s.idImage),
        selfieHash: hashImage(s.selfie),
      };
      const raw = JSON.stringify(decision);
      const r = await f(`${d.bankUrl}/kyc/vendor/callback`, {
        method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-praetor-signature': `sha256=${createHmac('sha256', d.hmacSecret).update(raw).digest('hex')}` },
      });
      if (r.status !== 204) return res.status(502).json({ error: 'the bank did not accept the result' });
      res.json({ decision: 'approved', next: `${d.publicUrl}/onboarding/kyc?session=${encodeURIComponent(s.session)}` });
    })().catch(next);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: (err as Error).name });
  });
  return app;
}
