import { describe, it, expect } from 'vitest';
import { code2session, mpWechatConfig, WechatError } from '../src/wechat.js';

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('code2Session for the mini program sign-in (spec 05)', () => {
  it('asks api.weixin.qq.com with the app credentials and returns the openid', async () => {
    const urls: string[] = [];
    const resolve = code2session({ base: 'https://api.weixin.qq.com', appId: 'wx123', secret: 's3', fetch: (async (u: string) => { urls.push(u); return jsonResponse({ openid: 'o-1', session_key: 'k' }); }) as typeof fetch });
    expect(await resolve('the-code')).toBe('o-1');
    const u = new URL(urls[0]!);
    expect(u.origin + u.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
    expect(Object.fromEntries(u.searchParams)).toEqual({ appid: 'wx123', secret: 's3', js_code: 'the-code', grant_type: 'authorization_code' });
  });

  it('turns a WeChat error into a WechatError (never an openid)', async () => {
    const resolve = code2session({ base: 'https://api.weixin.qq.com', appId: 'wx123', secret: 's3', fetch: (async () => jsonResponse({ errcode: 40163, errmsg: 'code been used' })) as typeof fetch });
    await expect(resolve('used')).rejects.toBeInstanceOf(WechatError);
  });
});

describe('mini program WeChat configuration', () => {
  it('uses the real code2Session with MP_APPID and MP_SECRET', () => {
    const c = mpWechatConfig({ MP_APPID: 'wx123', MP_SECRET: 's3' });
    expect(c.appId).toBe('wx123');
    expect(c.resolve).toBeTypeOf('function');
  });

  it('local stack with SOTER_FAKE_TENCENT=1: the attester fake answer (openid-of-<code>) and its app id', async () => {
    const c = mpWechatConfig({ SOTER_FAKE_TENCENT: '1' });
    expect(c.appId).toBe('wx-fake-local');
    expect(await c.resolve!('abc')).toBe('openid-of-abc');
    await expect(c.resolve!('bad')).rejects.toBeInstanceOf(WechatError);
  });

  it('without credentials nor the fake: sign-in disabled, the api still starts', () => {
    expect(mpWechatConfig({}).resolve).toBeNull();
  });

  it('prod refuses the fake and any WeChat base but the official one', () => {
    expect(() => mpWechatConfig({ PRAETOR_ENV: 'prod', SOTER_FAKE_TENCENT: '1', MP_APPID: 'wx1', MP_SECRET: 's' })).toThrow(/fake/);
    expect(() => mpWechatConfig({ PRAETOR_ENV: 'prod', MP_APPID: 'wx1', MP_SECRET: 's', WECHAT_API_BASE: 'http://evil.example' })).toThrow(/api.weixin.qq.com/);
  });
});
