// Web attacker controls (spec 08): writes from another origin are refused before anything runs (the CSRF token is the
// second lock), and the public sign-in, onboarding and recovery routes are rate-limited per client address.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApiApp } from '../src/app.js';
import { MemoryApiStore } from '../src/store.js';

const app = (rateLimitPerMinute?: number) => createApiApp({
  store: new MemoryApiStore(), sessionSecret: 's'.repeat(64), rpId: 'praetor.localhost', origin: 'https://praetor.localhost',
  accountFor: async () => ({ address: '0x00000000000000000000000000000000000c0ffe' }), rateLimitPerMinute,
});

describe('api hardening', () => {
  it('refuses a write whose Origin is another site, accepts its own origin and clients that send none', async () => {
    const a = app();
    await request(a).post('/api/onboarding/start').set('origin', 'https://evil.example').send({ email: 'x@example.com' }).expect(403);
    await request(a).post('/api/onboarding/start').set('origin', 'https://praetor.localhost').send({ email: 'x@example.com' }).expect(200);
    await request(a).post('/api/onboarding/start').send({ email: 'x@example.com' }).expect(200);
  });

  it('rate-limits the public sign-in, onboarding and recovery routes per client', async () => {
    const a = app(3);
    for (let i = 0; i < 3; i++) await request(a).post('/api/auth/options').send({}).expect(200);
    await request(a).post('/api/auth/options').send({}).expect(429);
    await request(a).post('/api/onboarding/start').send({ email: 'y@example.com' }).expect(200);
    await request(a).get('/api/health').expect(200);
  });
});
