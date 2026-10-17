// code2Session for the mini program sign-in (spec 05: the api also holds MP_SECRET for this, and it gives read access
// only). The attester does its own code2Session inside the TEE for every approval. The openid is never logged.
const WECHAT = 'https://api.weixin.qq.com';

export class WechatError extends Error {}

export function code2session(c: { base: string; appId: string; secret: string; fetch?: typeof fetch }) {
  const f = c.fetch ?? fetch;
  return async (code: string): Promise<string> => {
    const q = new URLSearchParams({ appid: c.appId, secret: c.secret, js_code: code, grant_type: 'authorization_code' });
    const r = await f(`${c.base}/sns/jscode2session?${q}`, { signal: AbortSignal.timeout(10_000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof j.openid !== 'string' || !j.openid) throw new WechatError(`code2Session failed: ${String(j.errcode ?? r.status)}`);
    return j.openid;
  };
}

// Local stack only (SOTER_FAKE_TENCENT=1): the answer of the attester's fake Tencent, so a test that hands the same
// code to both sees the same WeChat user on both sides.
const fakeCode2session = async (code: string): Promise<string> => {
  if (!code || code === 'bad') throw new WechatError('code2Session failed: 40029');
  return `openid-of-${code}`;
};

export type MpWechat = { appId: string; resolve: ((code: string) => Promise<string>) | null };

/** Sign-in is disabled (resolve = null) without credentials or the fake, so the rest of the api still starts. */
export function mpWechatConfig(env: Record<string, string | undefined>): MpWechat {
  const prod = env.PRAETOR_ENV === 'prod';
  const fake = env.SOTER_FAKE_TENCENT === '1';
  const base = env.WECHAT_API_BASE || WECHAT;
  if (prod && fake) throw new Error('prod refuses the fake Tencent (SOTER_FAKE_TENCENT=1)');
  if (prod && base !== WECHAT) throw new Error(`prod talks only to ${WECHAT}`);
  if (fake) return { appId: env.MP_APPID || 'wx-fake-local', resolve: fakeCode2session };
  if (env.MP_APPID && env.MP_SECRET) return { appId: env.MP_APPID, resolve: code2session({ base, appId: env.MP_APPID, secret: env.MP_SECRET }) };
  return { appId: env.MP_APPID ?? '', resolve: null };
}
