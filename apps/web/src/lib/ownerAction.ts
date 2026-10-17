// What you see is what you sign (spec 08, compromised backend): before the passkey signs an owner action the api
// prepared, the page recomputes its EIP-712 digest and checks the action is the one it asked for, on this account,
// over this payload. A backend that lies gets no signature.
import { isAddressEqual, type Hex } from 'viem';
import { digest, ownerActionPayloadHash, praetorDomain } from '@praetor/protocol';

export type PreparedJson = {
  ownerAction: { account: `0x${string}`; action: number; payloadHash: Hex; nonce: string; expiresAt: string; fiscoRef: Hex };
  payload: Hex;
  digest: Hex;
};

export function checkOwnerAction(p: PreparedJson, cfg: { domainName: string; mandateHook: `0x${string}` }, account: `0x${string}`, kind: number, expectedPayload?: Hex): Hex {
  const oa = p.ownerAction;
  if (!isAddressEqual(oa.account, account)) throw new Error('the owner action is for another account: not signing');
  if (oa.action !== kind) throw new Error(`the owner action is of kind ${oa.action}, not ${kind}: not signing`);
  if (expectedPayload !== undefined && expectedPayload.toLowerCase() !== p.payload.toLowerCase()) throw new Error('the payload is not the one on this page: not signing');
  if (ownerActionPayloadHash(oa.account, oa.action, p.payload) !== oa.payloadHash) throw new Error('the payload does not match the owner action: not signing');
  const mine = digest(praetorDomain(cfg.domainName, cfg.mandateHook), 'OwnerAction', { ...oa, nonce: BigInt(oa.nonce), expiresAt: BigInt(oa.expiresAt) });
  if (mine !== p.digest) throw new Error('the digest from the server does not match the owner action: not signing');
  return mine;
}
