// Known answers taken from spec/02-protocol.md: enum order, reason order, exact EIP-712 type strings.
import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import {
  REASONS, Reason, Status, RiskProfile, AssetKind, AssetStatus, Rail, Tier, AuthKind, PriceSource,
  OwnerActionKind, OWNER_ACTION_KINDS, PRIMARY_TYPES, encodeType, typehash, T2_REASONS, BASE_CHAIN_ID, DOMAIN_NAMES,
  TEST_VERIFYING_CONTRACT, praetorDomain,
} from '../src/index.js';

const SPEC_TYPES: Record<string, string> = {
  StatusAttestation: 'StatusAttestation(address account,uint8 status,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  HeartbeatAttestation: 'HeartbeatAttestation(uint64 epoch,uint64 validUntil,uint64 deadline)',
  CapsAttestation: 'CapsAttestation(uint8 riskProfile,uint256 perTxCap,uint256 dailyCap,uint256 monthlyCap,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  KYAAttestation: 'KYAAttestation(address account,address agentKey,bytes32 agentDidHash,bytes32 kycCredentialHash,bytes32 mandateCredentialHash,uint8 kycLevel,uint8 riskProfile,bytes2 jurisdiction,bytes32 agentMeasurement,uint64 validUntil,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  AssetAttestation: 'AssetAttestation(address asset,uint8 kind,uint8 status,uint16 maxWeightBps,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  SanctionsAttestation: 'SanctionsAttestation(address target,bool listed,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  JurisdictionAttestation: 'JurisdictionAttestation(bytes2 jurisdiction,bool payoutBlocked,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  AttesterAttestation: 'AttesterAttestation(address attester,bytes32 measurement,bool active,uint64 nonce,uint64 deadline,bytes32 fiscoRef)',
  AnchorAttestation: 'AnchorAttestation(uint64 seq,bytes32 head,uint64 fiscoBlock,uint64 deadline)',
  Tier2Approval: 'Tier2Approval(address account,bytes32 callHash,uint64 nonce,uint64 expiresAt)',
  OwnerAction: 'OwnerAction(address account,uint8 action,bytes32 payloadHash,uint64 nonce,uint64 expiresAt,bytes32 fiscoRef)',
  SoterApproval: 'SoterApproval(address account,bytes32 digest,bytes32 bindingHash,uint64 soterCounter,uint64 expiresAt)',
  StandingOrder: 'StandingOrder(address account,uint32 id,address payee,uint256 amount,uint32 period,uint64 firstDue,uint8 rail,bytes32 merchantRef)',
};

describe('EIP-712 types (spec 02)', () => {
  it('has exactly the 13 types of the spec', () => {
    expect([...PRIMARY_TYPES].sort()).toEqual(Object.keys(SPEC_TYPES).sort());
  });
  for (const [name, str] of Object.entries(SPEC_TYPES)) {
    it(`${name} type string and typehash`, () => {
      expect(encodeType(name as never)).toBe(str);
      expect(typehash(name as never)).toBe(keccak256(toHex(str)));
    });
  }
});

describe('domain', () => {
  it('uses the constant chain id 84532 and the environment name', () => {
    expect(BASE_CHAIN_ID).toBe(84532);
    expect(DOMAIN_NAMES).toEqual({ live: 'Praetor', local: 'Praetor-local', sandbox: 'Praetor-sandbox', test: 'Praetor-test' });
    expect(TEST_VERIFYING_CONTRACT).toBe('0x00000000000000000000000000000000DeaDBeef');
    expect(praetorDomain('Praetor-test', TEST_VERIFYING_CONTRACT)).toEqual({
      name: 'Praetor-test', version: '1', chainId: 84532, verifyingContract: TEST_VERIFYING_CONTRACT,
    });
  });
});

describe('enums (uint8 on the wire, order = value)', () => {
  it('matches the spec values', () => {
    expect(Status).toEqual({ ACTIVE: 0, RESTRICTED: 1, FROZEN: 2 });
    expect(RiskProfile).toEqual({ NONE: 0, CONSERVATIVE: 1, BALANCED: 2, GROWTH: 3 });
    expect(AssetKind).toEqual({ TOKEN: 0, DESK: 1, PAYOUT_PARTNER: 2 });
    expect(AssetStatus).toEqual({ NONE: 0, ACTIVE: 1, SUSPENDED: 2, DELISTED: 3 });
    expect(Rail).toEqual({ USDC_DIRECT: 0, ALIPAY_PLUS: 1, WECHAT_PAY: 2 });
    expect(Tier).toEqual({ T0_NEVER: 0, T1_AUTONOMOUS: 1, T2_HUMAN: 2, T3_OWNER: 3, T4_CONSORTIUM: 4 });
    expect(AuthKind).toEqual({ PASSKEY: 0, SOTER: 1 });
    expect(PriceSource).toEqual({ PYTH: 0, DEMO: 1 });
  });

  it('lists the 13 owner action kinds in order', () => {
    expect(OWNER_ACTION_KINDS).toEqual([
      'SET_POLICY', 'ADD_STANDING_ORDER', 'CANCEL_STANDING_ORDER', 'LINK_WECHAT', 'UNLINK_WECHAT', 'SET_AGENT_KEY',
      'REVOKE_AGENT_KEY', 'PAUSE_AGENT', 'RESUME_AGENT', 'SET_OWNER_KEY', 'CANCEL_RECOVERY', 'MODULE_CHANGE', 'REMOVE_PAYEE',
    ]);
    expect(OwnerActionKind.REMOVE_PAYEE).toBe(12);
  });

  it('lists the 28 refusal reasons in wire order', () => {
    expect(REASONS).toEqual([
      'OK', 'FROZEN', 'RESTRICTED', 'STALE_STATUS', 'SESSION_EXPIRED', 'TARGET_NOT_ALLOWED', 'SELECTOR_NOT_ALLOWED',
      'UNKNOWN_PAYEE', 'OVER_AUTO_CAP', 'OVER_HARD_CAP', 'BUDGET_EXCEEDED', 'COUNT_EXCEEDED', 'BAND_BREACH',
      'BUFFER_BREACH', 'TIER2_REQUIRED', 'TIER2_INVALID', 'ASSET_NOT_APPROVED', 'SANCTIONED', 'JURISDICTION_BLOCKED',
      'COUNTERPARTY_NOT_APPROVED', 'HIDDEN_CALL', 'REBALANCE_LIMIT', 'STALE_PRICE', 'SLIPPAGE', 'KYA_INVALID',
      'NO_POLICY', 'TIER3_REQUIRED', 'INVALID_AMOUNT',
    ]);
    expect(Reason.INVALID_AMOUNT).toBe(27);
    expect(Reason.HIDDEN_CALL).toBe(20);
  });

  it('marks as T2 (a human approval can lift them) exactly the T2 reasons of the table', () => {
    expect([...T2_REASONS].sort()).toEqual([
      'BAND_BREACH', 'BUDGET_EXCEEDED', 'BUFFER_BREACH', 'COUNT_EXCEEDED', 'OVER_AUTO_CAP', 'REBALANCE_LIMIT',
      'RESTRICTED', 'STALE_STATUS', 'TIER2_REQUIRED', 'UNKNOWN_PAYEE',
    ]);
  });
});
