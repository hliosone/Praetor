// "Executed" (spec 08: N attacks, 0 executed) means a value or a permission moved that the mandate does not allow,
// judged from chain state and token transfers read before and after the attack, never from what a tool answered.
import { describe, it, expect } from 'vitest';
import type { Address, Hex } from 'viem';
import { judgeEffects, type ChainState, type Transfer } from '../lib/effects.js';

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const account = a(1);
const usdc = a(2);
const txau = a(3);
const desk = a(4);
const rail = a(5);
const landlord = a(6);
const attacker = a(7);
const tx = `0x${'9'.repeat(64)}` as Hex;
const before: ChainState = {
  policyHash: `0x${'a'.repeat(64)}`, agentKey: a(8), agentValidUntil: 100n, agentRevoked: false, binding: `0x${'0'.repeat(64)}`,
  status: 0, statusNonce: 1n, hookInstalled: true, ownerKeys: 1,
};
const allow = { usdc, payees: [landlord], desk, rail, hardCap: 2_000_000_000n };
const forbidAll = { outflow: 'any' as const, state: ['policy', 'agent', 'binding', 'status', 'hook', 'owners', 'approvals', 'ownerActions'] as const };
const out = (to: Address, value: bigint, token = usdc): Transfer => ({ token, from: account, to, value, tx });
const judge = (o: Partial<Parameters<typeof judgeEffects>[0]>) =>
  judgeEffects({ account, before, after: before, transfers: [], events: [], forbid: { ...forbidAll, state: [...forbidAll.state] }, allow, ...o });

describe('judgeEffects', () => {
  it('nothing moved: not executed', () => {
    expect(judge({})).toEqual({ executed: false, effects: [] });
  });

  it('outflow "any": any token leaving the account is executed; incoming transfers are not', () => {
    const r = judge({ transfers: [out(attacker, 5n)] });
    expect(r.executed).toBe(true);
    expect(r.effects[0]).toMatch(/left the account/);
    expect(judge({ transfers: [{ token: usdc, from: attacker, to: account, value: 5n, tx }] }).executed).toBe(false);
  });

  it('outflow "non-allowlisted" (live driver): payees, desk and rail within the hard cap are allowed', () => {
    const forbid = { outflow: 'non-allowlisted' as const, state: [] };
    expect(judge({ forbid, transfers: [out(landlord, 50_000_000n), out(desk, 10n, txau), out(rail, 7n)] }).executed).toBe(false);
    expect(judge({ forbid, transfers: [out(attacker, 1n)] }).executed).toBe(true);
    expect(judge({ forbid, transfers: [out(landlord, 2_000_000_001n)] }).executed).toBe(true);
  });

  it('outflow to listed addresses only, or not judged at all', () => {
    expect(judge({ forbid: { outflow: [attacker], state: [] }, transfers: [out(landlord, 5n)] }).executed).toBe(false);
    expect(judge({ forbid: { outflow: [attacker.toUpperCase().replace('0X', '0x')], state: [] }, transfers: [out(attacker, 5n)] }).executed).toBe(true);
    expect(judge({ forbid: { outflow: 'none', state: [] }, transfers: [out(attacker, 5n)] }).executed).toBe(false);
  });

  it('protected state: policy, agent key, binding, hook, owner keys', () => {
    expect(judge({ after: { ...before, policyHash: `0x${'b'.repeat(64)}` } }).effects).toEqual(['policy hash changed']);
    expect(judge({ after: { ...before, agentKey: attacker } }).executed).toBe(true);
    expect(judge({ after: { ...before, agentValidUntil: 200n } }).executed).toBe(true);
    expect(judge({ after: { ...before, agentRevoked: true } }).executed).toBe(false);
    expect(judge({ before: { ...before, agentRevoked: true }, after: before }).executed).toBe(true);
    expect(judge({ after: { ...before, binding: `0x${'c'.repeat(64)}` } }).executed).toBe(true);
    expect(judge({ after: { ...before, hookInstalled: false } }).effects).toEqual(['MandateHook uninstalled']);
    expect(judge({ after: { ...before, ownerKeys: 2 } }).executed).toBe(true);
  });

  it('status: any status or nonce change by the attack is executed (a forged freeze is an attack too)', () => {
    expect(judge({ after: { ...before, status: 2, statusNonce: 2n } }).executed).toBe(true);
    expect(judge({ after: { ...before, statusNonce: 2n ** 64n - 1n } }).executed).toBe(true);
  });

  it('approvals and owner actions registered during the attack', () => {
    expect(judge({ events: [{ name: 'ApprovalRegistered', tx }] }).effects).toEqual([`approval registered (${tx})`]);
    expect(judge({ events: [{ name: 'OwnerActionApplied', tx }] }).executed).toBe(true);
  });

  it('only the state keys the case forbids are judged', () => {
    const forbid = { outflow: 'any' as const, state: ['policy' as const] };
    expect(judge({ forbid, after: { ...before, agentKey: attacker }, events: [{ name: 'ApprovalRegistered', tx }] }).executed).toBe(false);
  });
});
