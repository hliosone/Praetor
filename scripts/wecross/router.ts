// The WeCross router's RPC as the WeCross SDK speaks it (M12): {version, data} bodies, and the login that
// RSA-encrypts the salted SHA-256 of the password with the router's public key (WeCross-Java-SDK RequestUtility).
import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto';

export const ROUTER = process.env.WECROSS_ROUTER_URL ?? 'http://10.88.0.30:8250';

export async function router(method: 'GET' | 'POST', path: string, data?: unknown, credential?: string) {
  const r = await fetch(`${ROUTER}${path}`, {
    method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(credential ? { authorization: credential } : {}) },
    body: method === 'POST' ? JSON.stringify({ version: '1', data: data ?? null }) : undefined,
  });
  const j = (await r.json()) as { errorCode: number; message: string; data: any };
  if (j.errorCode !== 0) throw new Error(`router ${path}: ${j.errorCode} ${j.message}`);
  return j.data;
}

/** The SDK's login: salted SHA-256 password and the auth code token, RSA-encrypted with the router's public key. */
export async function login(username: string, password: string): Promise<string> {
  const pub = (await router('GET', '/auth/pub')).pub as string;
  const code = (await router('GET', '/auth/authCode')).authCode;
  const body = JSON.stringify({ username, password: createHash('sha256').update(`1234567890~!#$%^&*()_+${password}`).digest('hex'), randomToken: code.randomToken });
  const der = Buffer.from(pub, 'base64');
  const enc = publicEncrypt({ key: createPublicKey({ key: der, format: 'der', type: 'spki' }), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body)).toString('base64');
  const r = await router('POST', '/auth/login', enc);
  return r.credential as string;
}

