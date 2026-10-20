// Phala Cloud's verifier as it answered on 2026-10-20 for the server's soter-attester CVM: no `app_info` any more; the
// compose hash is in the quote's MRCONFIGID (0x01 || compose hash, zero-padded), which the TDX hardware measures.
import { describe, it, expect } from 'vitest';
import { phalaVerifier } from '../src/attestation.js';

const COMPOSE = '7328c4f30902aedf162b865698b2f73602bb38449c932c57a2d6966fac150469';
const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('phalaVerifier', () => {
  it('reads the compose hash from MRCONFIGID when the answer has no app_info', async () => {
    const v = await phalaVerifier(answer({ success: true, quote: { verified: true, body: { mr_config_id: `0x01${COMPOSE}000000000000` } } }))('00');
    expect(v).toEqual({ verified: true, composeHash: `0x${COMPOSE}` });
  });

  it('still reads app_info.compose_hash first, as the API answered before', async () => {
    const v = await phalaVerifier(answer({ success: true, quote: { verified: true }, app_info: { compose_hash: COMPOSE } }))('00');
    expect(v).toEqual({ verified: true, composeHash: `0x${COMPOSE}` });
  });

  it('takes no compose hash from an MRCONFIGID of another form, and an unverified quote stays unverified', async () => {
    const other = await phalaVerifier(answer({ success: true, quote: { verified: true, body: { mr_config_id: `0x02${COMPOSE}000000000000` } } }))('00');
    expect(other.composeHash).toBe('0x');
    const bad = await phalaVerifier(answer({ success: true, quote: { verified: false, body: { mr_config_id: `0x01${COMPOSE}000000000000` } } }))('00');
    expect(bad.verified).toBe(false);
  });
});
