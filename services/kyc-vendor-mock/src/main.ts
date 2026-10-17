import pino from 'pino';
import { z } from 'zod';
import { createMockApp } from './app.js';

const env = z.object({
  BANK_URL: z.string().url().default('http://bank:3020'),
  KYC_VENDOR_HMAC: z.string().min(32),
  PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  PORT: z.coerce.number().int().default(3040),
}).parse(process.env);

const log = pino();
createMockApp({ bankUrl: env.BANK_URL, hmacSecret: env.KYC_VENDOR_HMAC, publicUrl: env.PUBLIC_URL }).listen(env.PORT, () => log.info({ port: env.PORT }, 'kyc-vendor-mock listening'));
