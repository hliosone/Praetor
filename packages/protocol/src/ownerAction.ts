import { decodeAbiParameters, encodeAbiParameters, keccak256, size, slice, type Address, type Hex } from 'viem';
import { OwnerActionKind, ZERO_HASH } from './constants.js';
import { callHash } from './hash.js';
import { encodePolicy, type Policy } from './policy.js';
import { structHash, type SoterApproval, type StandingOrder } from './types.js';

export const STANDING_ORDER_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'account', type: 'address' }, { name: 'id', type: 'uint32' }, { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' }, { name: 'period', type: 'uint32' }, { name: 'firstDue', type: 'uint64' },
    { name: 'rail', type: 'uint8' }, { name: 'merchantRef', type: 'bytes32' },
  ],
} as const;

export const SOTER_APPROVAL_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'account', type: 'address' }, { name: 'digest', type: 'bytes32' }, { name: 'bindingHash', type: 'bytes32' },
    { name: 'soterCounter', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
  ],
} as const;

const K = OwnerActionKind;
type Args =
  | { kind: typeof K.SET_POLICY; account: Address; policy: Policy }
  | { kind: typeof K.ADD_STANDING_ORDER; account: Address; order: StandingOrder }
  | { kind: typeof K.CANCEL_STANDING_ORDER; account: Address; id: number }
  | { kind: typeof K.LINK_WECHAT; account: Address; linkNonce: Hex; proof: SoterApproval; attesterSig: Hex }
  | { kind: typeof K.UNLINK_WECHAT; account: Address; bindingHash: Hex }
  | { kind: typeof K.SET_AGENT_KEY; account: Address; agentKey: Address; validUntil: number }
  | { kind: typeof K.REVOKE_AGENT_KEY; account: Address; agentKey: Address }
  | { kind: typeof K.PAUSE_AGENT | typeof K.RESUME_AGENT; account: Address }
  | { kind: typeof K.SET_OWNER_KEY; account: Address; credIdHash: Hex; x: bigint; y: bigint }
  | { kind: typeof K.CANCEL_RECOVERY; account: Address; recoveryPayloadHash: Hex }
  | { kind: typeof K.MODULE_CHANGE; account: Address; moduleCallData: Hex }
  | { kind: typeof K.REMOVE_PAYEE; account: Address; payee: Address }
  | { kind: typeof K.REMOVE_PAYEE; account: Address; merchantKey: Hex };

// payload and payloadHash of an owner action, exactly as the table in spec 02.
export function ownerActionPayload(a: Args): { payload: Hex; payloadHash: Hex } {
  const plain = (payload: Hex) => ({ payload, payloadHash: keccak256(payload) });
  switch (a.kind) {
    case K.SET_POLICY:
      return plain(encodePolicy(a.policy));
    case K.ADD_STANDING_ORDER:
      if (a.order.account.toLowerCase() !== a.account.toLowerCase()) throw new Error('standing order account differs from the action account');
      return { payload: encodeAbiParameters([STANDING_ORDER_TUPLE], [a.order]), payloadHash: structHash('StandingOrder', a.order) };
    case K.CANCEL_STANDING_ORDER:
      return plain(encodeAbiParameters([{ type: 'uint32' }], [a.id]));
    case K.LINK_WECHAT:
      return {
        payload: encodeAbiParameters([{ type: 'bytes32' }, SOTER_APPROVAL_TUPLE, { type: 'bytes' }], [a.linkNonce, a.proof, a.attesterSig]),
        payloadHash: keccak256(encodeAbiParameters([{ type: 'bytes32' }], [a.linkNonce])),
      };
    case K.UNLINK_WECHAT:
      return plain(encodeAbiParameters([{ type: 'bytes32' }], [a.bindingHash]));
    case K.SET_AGENT_KEY:
      return plain(encodeAbiParameters([{ type: 'address' }, { type: 'uint48' }], [a.agentKey, a.validUntil]));
    case K.REVOKE_AGENT_KEY:
      return plain(encodeAbiParameters([{ type: 'address' }], [a.agentKey]));
    case K.PAUSE_AGENT:
    case K.RESUME_AGENT:
      return { payload: '0x', payloadHash: ZERO_HASH };
    case K.SET_OWNER_KEY:
      return plain(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [a.credIdHash, a.x, a.y]));
    case K.CANCEL_RECOVERY:
      return plain(encodeAbiParameters([{ type: 'bytes32' }], [a.recoveryPayloadHash]));
    case K.MODULE_CHANGE:
      return { payload: a.moduleCallData, payloadHash: callHash({ account: a.account, target: a.account, value: 0n, data: a.moduleCallData }) };
    case K.REMOVE_PAYEE:
      return 'payee' in a
        ? plain(encodeAbiParameters([{ type: 'uint8' }, { type: 'address' }], [0, a.payee]))
        : plain(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [1, a.merchantKey]));
  }
  throw new Error(`unknown owner action kind ${(a as { kind: number }).kind}`);
}

/** payloadHash from (account, kind, payload), like PraetorTypes.ownerActionPayloadHash: what a co-signer checks. */
export function ownerActionPayloadHash(account: Address, kind: number, payload: Hex): Hex {
  if (kind === K.ADD_STANDING_ORDER) {
    if (size(payload) !== 256) return keccak256(payload);
    const [o] = decodeAbiParameters([STANDING_ORDER_TUPLE], payload) as unknown as [StandingOrder];
    return structHash('StandingOrder', o);
  }
  if (kind === K.LINK_WECHAT) {
    if (size(payload) < 32) return keccak256(payload);
    return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [slice(payload, 0, 32)]));
  }
  if (kind === K.PAUSE_AGENT || kind === K.RESUME_AGENT) return size(payload) === 0 ? ZERO_HASH : keccak256(payload);
  if (kind === K.MODULE_CHANGE) return callHash({ account, target: account, value: 0n, data: payload });
  return keccak256(payload);
}
