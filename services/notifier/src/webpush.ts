// Web push channel (spec 05 notifier, spec 07 PWA): the account's browser subscriptions (stored by the api) receive
// the message, encrypted for each browser (RFC 8291) and signed with Praetor's VAPID key (RFC 8292). A channel with no
// subscription or no accepted delivery reports a failure, so the outbox does not list it as sent.
import webpush from 'web-push';
import type { Channel } from './app.js';

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Post = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;

export function webPushChannel(d: {
  subscriptions(account: string): Promise<PushSubscription[]>;
  vapid: { subject: string; publicKey: string; privateKey: string };
  post?: Post;
}): Channel {
  const post: Post = d.post ?? (async (url, init) => fetch(url, { method: init.method, headers: init.headers, body: new Uint8Array(init.body), signal: AbortSignal.timeout(10_000) }));
  return {
    name: 'web-push',
    async send(n) {
      const subs = await d.subscriptions(n.account);
      if (subs.length === 0) throw new Error('no push subscription');
      const payload = JSON.stringify({ title: 'Praetor', body: n.text, url: n.link ?? '/home' });
      let accepted = 0;
      for (const s of subs) {
        const r = webpush.generateRequestDetails(s, payload, { vapidDetails: d.vapid, TTL: 3600 });
        if ((await post(r.endpoint, { method: r.method, headers: r.headers as Record<string, string>, body: r.body as Buffer })).status < 300) accepted++;
      }
      if (accepted === 0) throw new Error('no push service accepted the message');
    },
  };
}
