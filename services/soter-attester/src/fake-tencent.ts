// Fake Tencent (SOTER_FAKE_TENCENT=1, tests and the local stack only; prod refuses it): code2Session, stable_token and
// soter/verify_signature with the response shapes of api.weixin.qq.com. The "device signature" is a hash any test can
// compute with fakeSoterSignature, standing in for the RSA-2048 signature of the phone's SOTER key.
import { createHash } from 'node:crypto';
import express from 'express';

export const fakeSoterSignature = (openid: string, jsonString: string) =>
  createHash('sha256').update(`fake-soter|${openid}|${jsonString}`).digest('base64');

export function createFakeTencent(o: { appId: string; secret: string }) {
  const app = express();
  app.use(express.json());
  app.get('/sns/jscode2session', (req, res) => {
    const { appid, secret, js_code: code } = req.query as Record<string, string>;
    if (appid !== o.appId || secret !== o.secret) return res.json({ errcode: 40013, errmsg: 'invalid appid' });
    if (!code || code === 'bad') return res.json({ errcode: 40029, errmsg: 'invalid code' });
    res.json({ openid: `openid-of-${code}`, session_key: 'fake-session-key' });
  });
  app.post('/cgi-bin/stable_token', (req, res) => {
    if (req.body?.appid !== o.appId || req.body?.secret !== o.secret) return res.json({ errcode: 40013, errmsg: 'invalid appid' });
    res.json({ access_token: 'fake-access-token', expires_in: 7200 });
  });
  app.post('/cgi-bin/soter/verify_signature', (req, res) => {
    if (req.query.access_token !== 'fake-access-token') return res.json({ errcode: 40001, errmsg: 'invalid credential' });
    const { openid, json_string: json, json_signature: sig } = req.body ?? {};
    res.json({ errcode: 0, errmsg: 'ok', is_ok: typeof sig === 'string' && sig === fakeSoterSignature(String(openid), String(json)) });
  });
  return app;
}
