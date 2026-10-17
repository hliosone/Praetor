// The partner's HTTP surface on the internal network: health of the watch loop, processed payouts, the merchant
// directory the api reads.
import express from 'express';
import { DIRECTORY } from './merchants.js';

export function createPartnerApp(d: { partner: string; healthy(): boolean; processed(): { id: string; result: string }[] }) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.status(d.healthy() ? 200 : 503).json({ ok: d.healthy(), partner: d.partner }));
  app.get('/payouts', (_req, res) => res.json({ processed: d.processed() }));
  app.get('/merchants', (_req, res) => res.json({ partner: d.partner, merchants: DIRECTORY }));
  return app;
}
