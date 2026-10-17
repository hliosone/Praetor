// Web push endpoints (spec 05 notifier, spec 07 PWA): the notifier POSTs to the endpoint a browser subscription names,
// and a signed-in user chooses that URL. Only the browsers' push services are accepted, on the default https port, so
// the notifier never posts to an internal service, an address or any other host a user names (SSRF, amplification).

/** Push services of Chrome, Edge (Chromium), Firefox and Safari. */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_SUFFIXES = ['.notify.windows.com', '.push.services.mozilla.com'];

/** Subscriptions an account may hold (one per browser and device). */
export const MAX_PUSH_SUBSCRIPTIONS = 10;

export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}
