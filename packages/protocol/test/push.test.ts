import { describe, it, expect } from 'vitest';
import { isPushEndpoint, MAX_PUSH_SUBSCRIPTIONS } from '../src/push.js';

describe('web push endpoints (the notifier posts to them)', () => {
  it('accepts the push services of the browsers we support', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/cX1Ab:APA91bH',
      'https://fcm.googleapis.com/wp/dX2Cd:APA91bF',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
      'https://web.push.apple.com/QGx3yZ',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    ]) expect(isPushEndpoint(u), u).toBe(true);
  });

  it('refuses anything else: internal names, addresses, other ports, plain http, credentials, look-alike hosts', () => {
    for (const u of [
      'https://api:3200/internal/push-subscriptions',
      'https://caddy/api/sandbox/faucet',
      'https://10.88.0.4/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://user:pw@fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/fcm/send/x',
      'https://evilfcm.googleapis.com/x',
      'https://notify.windows.com.evil.example/w/',
      'https://evil.example/notify.windows.com',
      'not a url',
    ]) expect(isPushEndpoint(u), u).toBe(false);
  });

  it('caps the subscriptions of an account', () => {
    expect(MAX_PUSH_SUBSCRIPTIONS).toBe(10);
  });
});
