// The service worker (public/sw.js): a notification opens a page of this app only. Its text and link come from whoever
// can reach the notifier (INTERNAL_TOKEN_API is shared by the api, mcp and the notifier, risk 20), so a forged
// message must not send the owner to another site.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';

const ORIGIN = 'https://praetor.localhost';

function load() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    clients: { openWindow: async (url: string) => { opened.push(url); }, claim: async () => undefined },
    registration: { showNotification: async () => undefined },
    skipWaiting: () => undefined,
  };
  runInNewContext(readFileSync(new NodeURL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL: NodeURL, caches: {}, fetch });
  const click = (url: unknown) => listeners.notificationclick!({ notification: { close: () => undefined, data: { url } }, waitUntil: () => undefined });
  return { click, opened };
}

describe('service worker notifications', () => {
  it('opens the app page a notification links to', () => {
    const { click, opened } = load();
    click(`${ORIGIN}/approve/42`);
    click('/settings');
    expect(opened).toEqual([`${ORIGIN}/approve/42`, `${ORIGIN}/settings`]);
  });

  it('never opens another site, whatever the notification says', () => {
    const { click, opened } = load();
    for (const url of ['https://evil.example/approve', '//evil.example/x', 'javascript:alert(1)', undefined]) click(url);
    expect(opened).toEqual([`${ORIGIN}/home`, `${ORIGIN}/home`, `${ORIGIN}/home`, `${ORIGIN}/home`]);
  });
});
