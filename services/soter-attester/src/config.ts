import { z } from 'zod';

const WECHAT = 'https://api.weixin.qq.com';

export function loadAttesterConfig(env: Record<string, string | undefined>) {
  const c = z.object({
    PRAETOR_ENV: z.string().default('local'),
    ATTESTATION_MODE: z.enum(['simulator', 'phala']),
    ATTESTER_HMAC_API: z.string().min(32),
    DEPLOYMENTS_FILE: z.string(),
    MP_APPID: z.string().default(''),
    MP_SECRET: z.string().default(''),
    WECHAT_API_BASE: z.string().url().default(WECHAT),
    SOTER_FAKE_TENCENT: z.enum(['0', '1']).default('0'),
    DSTACK_ENDPOINT: z.string().default('/var/run/dstack.sock'),
    PORT: z.coerce.number().int().default(3060),
  }).parse(env);
  const prod = c.PRAETOR_ENV === 'prod';
  if (prod && c.ATTESTATION_MODE === 'simulator') throw new Error('prod refuses simulator attestations (I13)');
  if (prod && c.SOTER_FAKE_TENCENT === '1') throw new Error('prod refuses the fake Tencent');
  if (prod && c.WECHAT_API_BASE !== WECHAT) throw new Error(`prod talks only to ${WECHAT}`);
  const fakeTencent = c.SOTER_FAKE_TENCENT === '1';
  if (!fakeTencent && (!c.MP_APPID || !c.MP_SECRET)) throw new Error('MP_APPID and MP_SECRET are required without the fake Tencent');
  return {
    simulator: c.ATTESTATION_MODE === 'simulator', fakeTencent, apiSecret: c.ATTESTER_HMAC_API, deploymentsFile: c.DEPLOYMENTS_FILE,
    appId: c.MP_APPID || 'wx-fake-local', mpSecret: c.MP_SECRET || 'fake-local-secret', wechatBase: c.WECHAT_API_BASE,
    dstackEndpoint: c.DSTACK_ENDPOINT, port: c.PORT,
  };
}
