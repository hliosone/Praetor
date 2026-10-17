import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import { pushPost, webPushChannel, type PushSubscription } from '../src/webpush.js';

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
      vapid, subscriptions: async () => [browserSub('https://fcm.googleapis.com/fcm/send/a'), browserSub('https://updates.push.services.mozilla.com/wpush/v2/b')],
      post: async (url, init) => { posts.push({ url, headers: init.headers, body: init.body }); return { status: 201 }; },
    });
    await ch.send({ account: '0x00000000000000000000000000000000000c0ffe', kind: 'approval', text: 'Approve? Pay 300.00 USDC' });
    expect(posts.map((p) => p.url)).toEqual(['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/b']);
    for (const p of posts) {
      expect(p.headers['Content-Encoding']).toBe('aes128gcm');
      expect(p.headers.Authorization).toMatch(/^vapid t=.+, k=/);
      expect(p.body.length).toBeGreaterThan(0);
      expect(p.body.toString('utf8')).not.toContain('Approve?');
    }
  });

  it('fails (not counted as sent) without a subscription or when every push service refuses', async () => {
    await expect(webPushChannel({ vapid, subscriptions: async () => [] }).send({ account: '0x1', kind: 'x', text: 't' })).rejects.toThrow(/no push subscription/);
    const refused = webPushChannel({ vapid, subscriptions: async () => [browserSub('https://fcm.googleapis.com/fcm/send/c')], post: async () => ({ status: 410 }) });
    await expect(refused.send({ account: '0x1', kind: 'x', text: 't' })).rejects.toThrow(/accepted/);
  });

  it('posts only to browser push services, whatever the stored subscriptions say (SSRF)', async () => {
    const posts: string[] = [];
    const ch = webPushChannel({
      vapid, subscriptions: async () => [browserSub('https://10.88.0.4/internal'), browserSub('https://api:3200/internal/push-subscriptions'), browserSub('https://fcm.googleapis.com/fcm/send/d')],
      post: async (url) => { posts.push(url); return { status: 201 }; },
    });
    await ch.send({ account: '0x00000000000000000000000000000000000c0ffe', kind: 'x', text: 't' });
    expect(posts).toEqual(['https://fcm.googleapis.com/fcm/send/d']);
  });

  it('does not follow a redirect from a push endpoint to another address', async () => {
    let followed = false;
    const target = createServer((_req, res) => { followed = true; res.writeHead(201).end(); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const redirector = createServer((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/internal` }).end(); });
    await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r));
    try {
      await expect(pushPost(`http://127.0.0.1:${(redirector.address() as AddressInfo).port}/push`, { method: 'POST', headers: {}, body: Buffer.from('x') })).rejects.toThrow();
      expect(followed).toBe(false);
    } finally {
      redirector.close();
      target.close();
    }
  });
});
