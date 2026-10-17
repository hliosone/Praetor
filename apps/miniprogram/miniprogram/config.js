// The api base URL per environment (spec 07, 11): develop = the local stack through the cloudflared tunnel (the phone
// runs in debug mode, no domain allowlist), trial and release = the deployed domain. The web app is served at the same
// origin. No secret here: a mini program is public code. `pnpm --filter @praetor/miniprogram tunnel` sets develop from
// .run/tunnel-url.
const API_BASE = {
  develop: 'https://praetor-tunnel.trycloudflare.com',
  trial: 'https://praetor.example.com',
  release: 'https://praetor.example.com',
};

function apiBase(envVersion) {
  return API_BASE[envVersion] || API_BASE.develop;
}

/** A page of the web app (passkey actions: unlink, new standing orders). */
function webUrl(envVersion, path) {
  return `${apiBase(envVersion)}${path}`;
}

module.exports = { API_BASE, apiBase, webUrl };
