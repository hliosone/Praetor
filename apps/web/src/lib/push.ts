// Web push (spec 07 PWA): the service worker subscribes with the api's VAPID public key and the subscription is stored
// by the api for the notifier. Approvals, refusals and freezes then reach the owner's device even with the app closed.
import { api } from './api.js';

/** The VAPID public key as the bytes PushManager.subscribe expects (applicationServerKey). */
export function vapidKeyBytes(b64url: string): Uint8Array {
  if (!b64url) throw new Error('no VAPID key configured on the server');
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('this browser has no web push');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications were not allowed');
  const { vapidPublic } = await api<{ vapidPublic: string }>('GET', '/config');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublic) as BufferSource }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('POST', '/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
}
