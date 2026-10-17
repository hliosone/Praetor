// What the mini program checks before it lets SOTER sign (spec 05, spec 06 F2 step 3 and F6 step 5a). The api is
// untrusted: the phone recomputes the digest from the fields it shows, and signs its own digest, never the api's
// soterChallenge. `problems` means the request does not say what it claims (never sign); `closed` means it can no
// longer be signed (decided, used or expired).
const protocol = require('./protocol.js');
const calls = require('./calls.js');
const format = require('./format.js');
const i18n = require('./i18n.js');

// The chain id is the constant of spec 02, whatever the api's config says.
const domainOf = (cfg) => ({ name: cfg.domainName, version: '1', chainId: protocol.CHAIN_ID, verifyingContract: cfg.mandateHook });
const lower = (h) => String(h).toLowerCase();

function checkApproval(view, ctx) {
  const problems = [];
  let digest = null;
  let callIndex = -1;
  let decoded = [];
  try {
    if (!protocol.sameAddress(view.tier2.account, ctx.account)) problems.push('account');
    decoded = view.calls.map((c) => calls.decodeCall(c, ctx.config));
    callIndex = view.calls.map((c) => protocol.callHash({ account: view.tier2.account, target: c.to, value: c.value, data: c.data })).indexOf(lower(view.tier2.callHash));
    if (callIndex < 0) problems.push('callhash');
    digest = protocol.digest(domainOf(ctx.config), 'Tier2Approval', view.tier2);
    if (digest !== lower(view.digest)) problems.push('digest');
  } catch (e) {
    problems.push('malformed');
  }
  const closed = view.state !== 'pending' ? 'state' : Number(view.tier2.expiresAt) <= ctx.nowS ? 'expired' : null;
  const ok = problems.length === 0 && !closed;
  const what = callIndex >= 0 ? calls.describe(ctx.lang, decoded[callIndex], { short: true }) : '';
  return {
    ok, problems, closed, digest, callIndex, decoded,
    challenge: ok ? protocol.soterChallenge(digest) : null,
    authContent: ok ? i18n.t(ctx.lang, 'approve.authContent', { what }) : '',
  };
}

function checkLink(view, ctx) {
  const problems = [];
  let digest = null;
  const a = view.ownerAction || {};
  try {
    if (a.action !== protocol.OwnerActionKind.LINK_WECHAT) problems.push('action');
    else if (!view.linkNonce || protocol.linkPayloadHash(view.linkNonce) !== lower(a.payloadHash)) problems.push('payload');
    else if (!protocol.sameAddress(view.account, a.account)) problems.push('malformed');
    else {
      digest = protocol.digest(domainOf(ctx.config), 'OwnerAction', a);
      if (digest !== lower(view.digest)) problems.push('digest');
    }
  } catch (e) {
    problems.push('malformed');
  }
  const closed = view.state !== 'waiting' ? 'state' : Number(a.expiresAt) <= ctx.nowS ? 'expired' : null;
  const ok = problems.length === 0 && !closed;
  return {
    ok, problems, closed, digest, account: a.account,
    challenge: ok ? protocol.soterChallenge(digest) : null,
    authContent: ok ? i18n.t(ctx.lang, 'link.authContent', { account: format.shortAddress(a.account) }) : '',
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The link request id from the web app's QR code (".../mp/link?id=<uuid>") or a bare id; null for anything else. */
function linkIdFromQr(text) {
  const s = String(text || '').trim();
  if (UUID.test(s)) return s;
  const m = /[?&]id=([^&#]*)/.exec(s);
  return m && /^https?:\/\//.test(s) && UUID.test(m[1]) ? m[1] : null;
}

module.exports = { checkApproval, checkLink, linkIdFromQr };
