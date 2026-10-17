import pino from 'pino';
import { createSignerApp } from './app.js';
import { loadSignerConfig } from './config.js';
import { dstackKeys } from './dstack.js';

const cfg = loadSignerConfig(process.env);
const log = pino();
const keys = dstackKeys(cfg.dstackEndpoint);
const app = createSignerApp({ keys, secrets: cfg.secrets, simulator: cfg.simulator, version: '0.1.0', mcpUrl: cfg.mcpUrl });
app.listen(cfg.port, () => log.info({ port: cfg.port, simulator: cfg.simulator }, 'agent-signer listening'));
