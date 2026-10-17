import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { webPushChannel, type PushSubscription } from '../src/webpush.js';

const vapid = { subject: 'mailto:ops@praetor.localhost', ...webpush.generateVAPIDKeys() };
function browserSub(endpoint: string): PushSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

describe('web push channel', () => {
  it('posts an aes128gcm-encrypted payload with a VAPID authorization to every subscription of the account', async () => {
    const posts: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    const ch = webPushChannel({
      vapid, subscriptions: async () => [browserSub('https://push.example/a'), browserSub('https://push.example/b')],
      post: async (url, init) => { posts.push({ url, headers: init.headers, body: init.body }); return { status: 201 }; },
    });
    await ch.send({ account: '0x00000000000000000000000000000000000c0ffe', kind: 'approval', text: 'Approve? Pay 300.00 USDC' });
    expect(posts.map((p) => p.url)).toEqual(['https://push.example/a', 'https://push.example/b']);
    for (const p of posts) {
      expect(p.headers['Content-Encoding']).toBe('aes128gcm');
      expect(p.headers.Authorization).toMatch(/^vapid t=.+, k=/);
      expect(p.body.length).toBeGreaterThan(0);
      expect(p.body.toString('utf8')).not.toContain('Approve?');
    }
  });

  it('fails (not counted as sent) without a subscription or when every push service refuses', async () => {
    await expect(webPushChannel({ vapid, subscriptions: async () => [] }).send({ account: '0x1', kind: 'x', text: 't' })).rejects.toThrow(/no push subscription/);
    const refused = webPushChannel({ vapid, subscriptions: async () => [browserSub('https://push.example/c')], post: async () => ({ status: 410 }) });
    await expect(refused.send({ account: '0x1', kind: 'x', text: 't' })).rejects.toThrow(/accepted/);
  });
});
