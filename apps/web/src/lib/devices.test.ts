// A new device (F10, spec 07 settings) under a compromised api (spec 08): the passkey signs SET_OWNER_KEY only for the
// key this browser just created, read from its own registration, never for a key the server names.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { softPasskey, ownerActionPayload, OwnerActionKind as K } from '@praetor/protocol';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const phone = softPasskey('lin-phone');
const attacker = softPasskey('attacker');
const hex32 = (v: bigint) => v.toString(16).padStart(64, '0');
// SubjectPublicKeyInfo of a P-256 key, as PublicKeyCredential.getPublicKey() returns it: the fixed header, then 04 || x || y.
const spki = (x: bigint, y: bigint) => Buffer.from(`3059301306072a8648ce3d020106082a8648ce3d03010703420004${hex32(x)}${hex32(y)}`, 'hex').toString('base64url');
const registration = {
  id: phone.credentialId, rawId: phone.credentialId, type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: '', attestationObject: '', transports: ['internal'], publicKeyAlgorithm: -7, publicKey: spki(phone.x, phone.y) },
};
const keyJson = (k: { credIdHash: string; x: bigint; y: bigint }) => ({ credIdHash: k.credIdHash, x: `0x${k.x.toString(16)}`, y: `0x${k.y.toString(16)}` });

let serverKey = keyJson(phone);
const paths: string[] = [];
const prepared = { ownerAction: { action: K.SET_OWNER_KEY }, payload: '0x01', digest: `0x${'ab'.repeat(32)}` };
const api = vi.fn(async (_method: string, path: string, body?: unknown) => {
  paths.push(path);
  if (path === '/passkeys/options') return { challenge: 'Y2hhbGxlbmdl' };
  if (path === '/passkeys/verify') return serverKey;
  if (path === '/me') return { account: ACCOUNT };
  if (path === '/owner-actions/prepare') return { ...prepared, body };
  throw new Error(`unexpected ${path}`);
});
const signAndSubmit = vi.fn(async (..._a: unknown[]) => ({ success: true, txHash: null }));
vi.mock('./api.js', () => ({ api: (...a: unknown[]) => api(...(a as [string, string, unknown])) }));
vi.mock('./passkey.js', () => ({ signAndSubmit: (...a: unknown[]) => signAndSubmit(...a) }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: async () => registration }));

const { addDevice, ownerKeyOf } = await import('./devices.js');

beforeEach(() => {
  paths.length = 0;
  signAndSubmit.mockClear();
  serverKey = keyJson(phone);
});

describe('a new device passkey', () => {
  it('reads the owner key from the browser\'s own registration: keccak256 of the raw id and the P-256 point', () => {
    expect(ownerKeyOf(registration as never)).toEqual({ credIdHash: phone.credIdHash, x: phone.x, y: phone.y });
  });

  it('signs SET_OWNER_KEY for the key this browser created', async () => {
    expect(await addDevice()).toBe(true);
    const expected = ownerActionPayload({ kind: K.SET_OWNER_KEY, account: ACCOUNT, credIdHash: phone.credIdHash, x: phone.x, y: phone.y }).payload;
    expect(signAndSubmit).toHaveBeenCalledWith(expect.objectContaining({ payload: '0x01' }), K.SET_OWNER_KEY, expected);
  });

  it('refuses to sign when the server returns another key than the passkey this browser created', async () => {
    serverKey = keyJson(attacker);
    await expect(addDevice()).rejects.toThrow(/not signing/);
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(paths).not.toContain('/owner-actions/prepare');
  });

  it('refuses a registration whose public key is not a P-256 point', () => {
    expect(() => ownerKeyOf({ ...registration, response: { ...registration.response, publicKey: 'AAAA' } } as never)).toThrow(/P-256/);
    expect(() => ownerKeyOf({ ...registration, response: { ...registration.response, publicKey: undefined } } as never)).toThrow(/public key/);
  });
});
