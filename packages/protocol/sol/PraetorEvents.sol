// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

// Base events of spec 02, one interface per contract. The TS twin is src/events.ts (parity test).

interface IMandateHookEvents {
    event Decision(address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, uint256 valueUsd6);
    event StatusApplied(address indexed account, uint8 status, uint64 nonce, bytes32 fiscoRef, uint8 signerCount);
    event HeartbeatApplied(uint64 epoch, uint64 validUntil);
    event CapsApplied(uint8 indexed riskProfile, uint256 perTxCap, uint256 dailyCap, uint256 monthlyCap, bytes32 fiscoRef);
    event KYAApplied(address indexed account, address agentKey, uint8 kycLevel, uint8 riskProfile, bytes2 jurisdiction, uint64 validUntil, bytes32 fiscoRef);
    event AssetApplied(address indexed asset, uint8 kind, uint8 status, uint16 maxWeightBps, bytes32 fiscoRef);
    event SanctionsApplied(address indexed target, bool listed, bytes32 fiscoRef);
    event JurisdictionApplied(bytes2 indexed jurisdiction, bool payoutBlocked, bytes32 fiscoRef);
    event AttesterApplied(address indexed attester, bytes32 measurement, bool active);
    event ApprovalRegistered(address indexed account, bytes32 indexed callHash, uint8 authKind, uint64 expiresAt);
    event ApprovalConsumed(address indexed account, bytes32 indexed callHash);
    event OwnerActionApplied(address indexed account, uint8 indexed action, bytes32 payloadHash, uint8 authKind, bytes32 digest);
    event PolicySet(address indexed account, bytes32 policyHash);
    event RecoveryScheduled(address indexed account, bytes32 payloadHash, uint64 executableAt);
    event RecoveryCancelled(address indexed account, bytes32 payloadHash);
    event RecoveryExecuted(address indexed account, bytes32 payloadHash);

    error MandateRefused(uint8 reason, bytes32 callHash);
}

interface IRefusalLogEvents {
    event Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter);
}

interface IStandingOrdersEvents {
    event StandingOrderSet(address indexed account, uint32 indexed id, bytes32 orderHash);
    event StandingOrderCancelled(address indexed account, uint32 indexed id);
    event StandingOrderExecuted(address indexed account, uint32 indexed id, uint256 amount, uint64 periodIndex, address trigger);
}

interface IPayoutRailEvents {
    event PayoutRequested(uint256 indexed id, address indexed account, address indexed partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef);
    event PayoutSettled(uint256 indexed id, bytes32 settlementRef);
    event PayoutFailed(uint256 indexed id, bytes32 code);
}

interface IPriceOracleEvents {
    event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source);
}

interface ITreasuryDeskEvents {
    event Swapped(address indexed account, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 price8);
}

interface IAnchorEvents {
    event Anchored(uint64 indexed seq, bytes32 head, uint64 fiscoBlock);
}
