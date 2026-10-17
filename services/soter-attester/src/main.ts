import type { Server } from 'node:http';
import pino from 'pino';
import { loadDeployments } from '@praetor/chain';
import { createAttesterApp } from './app.js';
import { loadAttesterConfig } from './config.js';
import { dstackKeys } from './dstack.js';
import { createFakeTencent } from './fake-tencent.js';

const cfg = loadAttesterConfig(process.env);
const log = pino();
const base = loadDeployments(cfg.deploymentsFile);
let tencentBase = cfg.wechatBase;
if (cfg.fakeTencent) {
  // Local stack only (refused in prod): the fake answers on loopback inside this container.
  const fake = createFakeTencent({ appId: cfg.appId, secret: cfg.mpSecret });
  const server = await new Promise<Server>((r) => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
  tencentBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const app = createAttesterApp({
  keys: dstackKeys(cfg.dstackEndpoint), secrets: { api: cfg.apiSecret }, simulator: cfg.simulator, version: '0.1.0',
  tencent: { base: tencentBase, appId: cfg.appId, secret: cfg.mpSecret }, domain: { name: base.domainName, hook: base.mandateHook },
});
app.listen(cfg.port, () => log.info({ port: cfg.port, simulator: cfg.simulator, fakeTencent: cfg.fakeTencent }, 'soter-attester listening'));
