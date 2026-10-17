// Listens on HTTPS port 443 inside the Docker network only: the MCP client always dials 443 (V7 trap 1).
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { z } from 'zod';
import { createGateway } from './gateway.js';

const env = z.object({
  ALIPAYPLUS_TEST_MERCHANT_PUBLIC_KEY: z.string().min(100),
  ALIPAYPLUS_TEST_GATEWAY_PRIVATE_KEY: z.string().min(100),
  TLS_DIR: z.string().default('/tls'),
  PORT: z.coerce.number().int().default(443),
}).parse(process.env);

const app = createGateway({ merchantPublicKey: env.ALIPAYPLUS_TEST_MERCHANT_PUBLIC_KEY, gatewayPrivateKey: env.ALIPAYPLUS_TEST_GATEWAY_PRIVATE_KEY });
https.createServer({ key: readFileSync(`${env.TLS_DIR}/key.pem`), cert: readFileSync(`${env.TLS_DIR}/cert.pem`) }, app).listen(env.PORT, () => console.log(`alipayplus-mock (MOCK) on ${env.PORT}`));
