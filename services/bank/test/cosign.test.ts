import { describe, it, expect } from 'vitest';
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { ownerActionPayload, OwnerActionKind as K, policyHash, type Policy } from '@praetor/protocol';
import { checkCosign, CosignRefused, type CosignReaders } from '../src/cosign.js';

const ACCOUNT = '0x00000000000000000000000000000000000000a1' as Address;
const AGENT = '0x00000000000000000000000000000000000000a6' as Address;
const FISCO_TX = keccak256(toHex('submitPolicy tx'));
const mods = { passkeyValidator: '0x00000000000000000000000000000000000000b1', agentKeyValidator: '0x00000000000000000000000000000000000000b2', standingOrders: '0x00000000000000000000000000000000000000b3', mandateHook: '0x00000000000000000000000000000000000000b4' } as const;

const policy: Policy = {
  autoCap: 200n, hardCap: 2_000n, dailyBudget: 500n, monthlyBudget: 3_000n, dailyCount: 10, bufferUsdc: 0n, payees: [], merchants: [],
  bands: [{ token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', minBps: 0, targetBps: 10_000, maxBps: 10_000 }],
  maxRebalancesPerDay: 1, maxTradeUsd: 1n, maxSlippageBps: 100, validUntil: 1_900_000_000n, soterEnabled: false,
};

const readers = (over: Partial<CosignReaders> = {}): CosignReaders => ({
  mandateChecked: async (tx) => (tx === FISCO_TX ? { account: ACCOUNT, policyHash: policyHash(policy), ok: true } : null),
  kyaAgentKey: async () => AGENT,
  perTxCap: async () => 5_000n,
  modules: mods,
  ...over,
});

const action = (kind: number, payloadHash: Hex, fiscoRef: Hex = `0x${'00'.repeat(32)}`) => ({ account: ACCOUNT, action: kind, payloadHash, nonce: 1n, expiresAt: 1n, fiscoRef });

describe('bank co-signature rules (spec 05)', () => {
  it('co-signs SET_POLICY only after its own successful check on FISCO for that exact policy', async () => {
    const p = ownerActionPayload({ kind: K.SET_POLICY, account: ACCOUNT, policy });
    await expect(checkCosign(action(K.SET_POLICY, p.payloadHash, FISCO_TX), p.payload, readers())).resolves.toBeUndefined();
    await expect(checkCosign(action(K.SET_POLICY, p.payloadHash, keccak256(toHex('other'))), p.payload, readers())).rejects.toThrow(CosignRefused);
    const other = ownerActionPayload({ kind: K.SET_POLICY, account: ACCOUNT, policy: { ...policy, autoCap: 100n } });
    await expect(checkCosign(action(K.SET_POLICY, other.payloadHash, FISCO_TX), other.payload, readers())).rejects.toThrow(/policy/);
    await expect(checkCosign(action(K.SET_POLICY, keccak256('0x01'), FISCO_TX), p.payload, readers())).rejects.toThrow(/payload/);
  });

  it('co-signs SET_AGENT_KEY only for the TEE key the bank verified in the KYA', async () => {
    const ok = ownerActionPayload({ kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: AGENT, validUntil: 1_900_000_000 });
    await expect(checkCosign(action(K.SET_AGENT_KEY, ok.payloadHash), ok.payload, readers())).resolves.toBeUndefined();
    const bad = ownerActionPayload({ kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: ACCOUNT, validUntil: 1_900_000_000 });
    await expect(checkCosign(action(K.SET_AGENT_KEY, bad.payloadHash), bad.payload, readers())).rejects.toThrow(/agent key/);
  });

  it('co-signs a standing order within the bank per-transaction cap', async () => {
    const order = { account: ACCOUNT, id: 1, payee: AGENT, amount: 1_200n, period: 30, firstDue: 1n, rail: 0, merchantRef: `0x${'00'.repeat(32)}` as Hex };
    const ok = ownerActionPayload({ kind: K.ADD_STANDING_ORDER, account: ACCOUNT, order });
    await expect(checkCosign(action(K.ADD_STANDING_ORDER, ok.payloadHash), ok.payload, readers())).resolves.toBeUndefined();
    const big = ownerActionPayload({ kind: K.ADD_STANDING_ORDER, account: ACCOUNT, order: { ...order, amount: 6_000n } });
    await expect(checkCosign(action(K.ADD_STANDING_ORDER, big.payloadHash), big.payload, readers())).rejects.toThrow(/cap/);
  });

  it('co-signs module changes only for our own modules and never the removal of the hook', async () => {
    const abi = parseAbi(['function installModule(uint256,address,bytes)', 'function uninstallModule(uint256,address,bytes)']);
    const inst = ownerActionPayload({ kind: K.MODULE_CHANGE, account: ACCOUNT, moduleCallData: encodeFunctionData({ abi, functionName: 'installModule', args: [2n, mods.standingOrders, '0x'] }) });
    await expect(checkCosign(action(K.MODULE_CHANGE, inst.payloadHash), inst.payload, readers())).resolves.toBeUndefined();
    const foreign = ownerActionPayload({ kind: K.MODULE_CHANGE, account: ACCOUNT, moduleCallData: encodeFunctionData({ abi, functionName: 'installModule', args: [2n, AGENT, '0x'] }) });
    await expect(checkCosign(action(K.MODULE_CHANGE, foreign.payloadHash), foreign.payload, readers())).rejects.toThrow(/module/);
    const unhook = ownerActionPayload({ kind: K.MODULE_CHANGE, account: ACCOUNT, moduleCallData: encodeFunctionData({ abi, functionName: 'uninstallModule', args: [4n, mods.mandateHook, '0x'] }) });
    await expect(checkCosign(action(K.MODULE_CHANGE, unhook.payloadHash), unhook.payload, readers())).rejects.toThrow(/hook/);
  });

  it('accepts LINK_WECHAT and SET_OWNER_KEY, refuses owner-alone kinds (no bank needed)', async () => {
    const link = ownerActionPayload({ kind: K.LINK_WECHAT, account: ACCOUNT, linkNonce: keccak256('0x01'), proof: { account: ACCOUNT, digest: keccak256('0x02'), bindingHash: keccak256('0x03'), soterCounter: 1n, expiresAt: 1n }, attesterSig: '0x01' });
    await expect(checkCosign(action(K.LINK_WECHAT, link.payloadHash), link.payload, readers())).resolves.toBeUndefined();
    const pause = ownerActionPayload({ kind: K.PAUSE_AGENT, account: ACCOUNT });
    await expect(checkCosign(action(K.PAUSE_AGENT, pause.payloadHash), pause.payload, readers())).rejects.toThrow(/owner alone/);
  });
});
