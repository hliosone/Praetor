import { describe, it, expect } from 'vitest';
import { loadAttesterConfig } from '../src/config.js';

const base = { ATTESTER_HMAC_API: 'a'.repeat(64), DEPLOYMENTS_FILE: '/x.json', MP_APPID: 'wx1', MP_SECRET: 's' };

describe('soter-attester config (I13)', () => {
  it('prod refuses the simulator, the fake Tencent and any other WeChat API base', () => {
    expect(() => loadAttesterConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'simulator' })).toThrow(/I13/);
    expect(() => loadAttesterConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala', SOTER_FAKE_TENCENT: '1' })).toThrow(/fake/);
    expect(() => loadAttesterConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala', WECHAT_API_BASE: 'http://evil' })).toThrow(/api.weixin.qq.com/);
    expect(loadAttesterConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala' }).fakeTencent).toBe(false);
  });
  it('without the fake, needs the mini program credentials', () => {
    expect(() => loadAttesterConfig({ ...base, MP_APPID: '', ATTESTATION_MODE: 'simulator' })).toThrow(/MP_APPID/);
    expect(loadAttesterConfig({ ...base, MP_APPID: '', MP_SECRET: '', ATTESTATION_MODE: 'simulator', SOTER_FAKE_TENCENT: '1' }).fakeTencent).toBe(true);
  });
});
