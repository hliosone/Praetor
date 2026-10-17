// The three WeChat calls SOTER needs (from Alex's services/approvals/soter/server/server.js): code2Session for the
// user's openid, stable_token (cached), verify_signature of the device result. TLS to api.weixin.qq.com ends inside the
// TEE; nothing returned here is logged.
export type TencentConfig = { base: string; appId: string; secret: string; fetch?: typeof fetch };

export class TencentError extends Error {}

export function tencentClient(c: TencentConfig) {
  const f = c.fetch ?? fetch;
  let token: { value: string; until: number } | undefined;
  const getJson = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;

  async function accessToken(now: number): Promise<string> {
    if (token && token.until > now + 60) return token.value;
    const j = await getJson(await f(`${c.base}/cgi-bin/stable_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credential', appid: c.appId, secret: c.secret }) }));
    if (typeof j.access_token !== 'string') throw new TencentError(`stable_token failed: ${String(j.errcode ?? '')}`);
    token = { value: j.access_token, until: now + Number(j.expires_in ?? 7200) };
    return token.value;
  }

  return {
    async openid(code: string): Promise<string> {
      const q = new URLSearchParams({ appid: c.appId, secret: c.secret, js_code: code, grant_type: 'authorization_code' });
      const j = await getJson(await f(`${c.base}/sns/jscode2session?${q}`));
      if (typeof j.openid !== 'string') throw new TencentError(`code2Session failed: ${String(j.errcode ?? '')}`);
      return j.openid;
    },
    async verifySignature(openid: string, jsonString: string, signature: string, now: number): Promise<boolean> {
      const t = await accessToken(now);
      const j = await getJson(await f(`${c.base}/cgi-bin/soter/verify_signature?access_token=${encodeURIComponent(t)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openid, json_string: jsonString, json_signature: signature }),
      }));
      return j.is_ok === true;
    },
  };
}
