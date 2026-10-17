import { describe, it, expect } from 'vitest';
import { startRegulator } from '../src/main.js';

describe('regulator-service', () => {
  it('refuses to start without its configuration (spec 11)', async () => {
    await expect(startRegulator({ PRAETOR_ENV: 'local' })).rejects.toThrow(/invalid configuration|missing/);
  });
});
