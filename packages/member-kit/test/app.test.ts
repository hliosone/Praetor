import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { keccak256, toHex, type Hex } from 'viem';
import { softPasskey } from '@praetor/protocol';
import { createMemberApp, StaffAuth, MemoryStaffStore, type ConsortiumPort } from '../src/index.js';

const RP = 'praetor.localhost';
const ORIGIN = 'https://praetor.localhost';
const TOKEN = 'members-internal-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const DIGEST = keccak256(toHex('proposal digest'));

class FakeConsortium implements ConsortiumPort {
  opened: unknown[] = [];
  signed: unknown[] = [];
  async open(board: string, fn: string, args: readonly unknown[]) { this.opened.push({ board, fn, args }); return { proposalId: 7n, digest: DIGEST, txHash: keccak256(toHex('tx')) as Hex }; }
  async read(_board: string, id: bigint) { return { id, kind: 0, status: 1, digest: DIGEST, message: { status: 2 }, signers: [], required: 1, bankRequired: false }; }
  async sign(board: string, id: bigint) { this.signed.push({ board, id }); return { txHash: keccak256(toHex('sign')) as Hex, ready: true }; }
  async reissue(_board: string, _id: bigint) { return { proposalId: 8n, digest: DIGEST, txHash: keccak256(toHex('re')) as Hex }; }
  async deadline() { return 1_900_000_000n; }
}

async function setup() {
  const consortium = new FakeConsortium();
  const staff = new StaffAuth(new MemoryStaffStore(), { enrolToken: 'enrol-tok', rpId: RP, origin: ORIGIN });
  const app = createMemberApp({ role: 'regulator', consortium, staff, token: TOKEN, health: async () => ({ fisco: true }), version: 't' });
  const pk = softPasskey('staff-alice', RP, ORIGIN);
  await request(app).post('/staff/enrol').set(auth).send({ token: 'enrol-tok', credentialId: pk.credIdHash, x: toHex(pk.x), y: toHex(pk.y), label: 'alice' }).expect(204);
  const assertion = (challenge: Hex) => {
    const a = pk.sign(challenge);
    return { credentialId: pk.credIdHash, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, r: toHex(a.r, { size: 32 }), s: toHex(a.s, { size: 32 }) };
  };
  return { app, consortium, assertion };
}

describe('member service API (spec 05)', () => {
  it('needs the internal token except for health and version', async () => {
    const { app } = await setup();
    await request(app).get('/health').expect(200);
    await request(app).post('/status').send({ account: `0x${'11'.repeat(20)}`, status: 2 }).expect(401);
  });

  it('opens a freeze and returns the digest to sign', async () => {
    const { app, consortium } = await setup();
    const r = await request(app).post('/status').set(auth).send({ account: `0x${'11'.repeat(20)}`, status: 2 }).expect(200);
    expect(r.body).toMatchObject({ board: 'status', proposalId: '7', digest: DIGEST });
    expect(consortium.opened).toEqual([{ board: 'status', fn: 'openStatus', args: [`0x${'11'.repeat(20)}`, 2, 1_900_000_000n] }]);
  });

  it('signs only with a staff passkey assertion over the proposal digest', async () => {
    const { app, consortium, assertion } = await setup();
    await request(app).post('/proposals/status/7/sign').set(auth).send({ assertion: assertion(keccak256(toHex('another'))) }).expect(403);
    expect(consortium.signed).toEqual([]);
    const r = await request(app).post('/proposals/status/7/sign').set(auth).send({ assertion: assertion(DIGEST) }).expect(200);
    expect(r.body.ready).toBe(true);
    expect(consortium.signed).toEqual([{ board: 'status', id: 7n }]);
  });

  it('exposes the opens every member may do, with validation', async () => {
    const { app, consortium } = await setup();
    await request(app).post('/sanctions').set(auth).send({ target: `0x${'22'.repeat(20)}`, listed: true }).expect(200);
    await request(app).post('/jurisdictions').set(auth).send({ jurisdiction: 'CN', blocked: true }).expect(200);
    await request(app).post('/assets').set(auth).send({ asset: `0x${'33'.repeat(20)}`, kind: 0, status: 2, maxWeightBps: 3000 }).expect(200);
    await request(app).post('/attesters').set(auth).send({ attester: `0x${'44'.repeat(20)}`, measurement: DIGEST, active: false }).expect(200);
    await request(app).post('/heartbeat').set(auth).send({ ttlSeconds: 900 }).expect(200);
    await request(app).post('/jurisdictions').set(auth).send({ jurisdiction: 'CHN', blocked: true }).expect(400);
    await request(app).post('/status').set(auth).send({ account: 'nope', status: 2 }).expect(400);
    expect((consortium.opened as { fn: string }[]).map((o) => o.fn)).toEqual(['openSanctions', 'openJurisdiction', 'openAsset', 'openAttester', 'openHeartbeat']);
  });

  it('reads a proposal and reissues one', async () => {
    const { app } = await setup();
    const r = await request(app).get('/proposals/status/7').set(auth).expect(200);
    expect(r.body.digest).toBe(DIGEST);
    expect((await request(app).post('/proposals/status/7/reissue').set(auth).send({}).expect(200)).body.proposalId).toBe('8');
    await request(app).get('/proposals/nope/7').set(auth).expect(400);
  });

  it('refuses a second enrolment with the one-time token', async () => {
    const { app } = await setup();
    const pk = softPasskey('staff-bob', RP, ORIGIN);
    await request(app).post('/staff/enrol').set(auth).send({ token: 'enrol-tok', credentialId: pk.credIdHash, x: toHex(pk.x), y: toHex(pk.y), label: 'bob' }).expect(403);
  });
});
