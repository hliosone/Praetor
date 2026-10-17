// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";

// Storage of MandateHook, shared with its external libraries (they run by delegatecall on the hook's storage).

struct StatusRec {
    uint8 status;
    uint64 nonce;
}

struct CapsRec {
    uint256 perTxCap;
    uint256 dailyCap;
    uint256 monthlyCap;
    uint64 nonce;
}

struct KyaRec {
    address agentKey;
    uint64 validUntil;
    uint64 nonce;
    uint8 kycLevel;
    uint8 riskProfile;
    bytes2 jurisdiction;
    bytes32 agentDidHash;
    bytes32 kycCredentialHash;
    bytes32 mandateCredentialHash;
    bytes32 agentMeasurement;
}

struct AssetRec {
    uint8 kind;
    uint8 status;
    uint16 maxWeightBps;
    uint64 nonce;
}

struct FlagRec {
    bool on;
    uint64 nonce;
}

struct AttesterRec {
    bytes32 measurement;
    bool active;
    uint64 nonce;
}

struct ApprovalRec {
    uint64 expiresAt;
    bool consumed;
}

struct RecoveryRec {
    bytes32 payloadHash;
    uint64 executableAt;
    bytes32 credIdHash;
    uint256 x;
    uint256 y;
}

struct Modules {
    address passkeyValidator;
    address agentKeyValidator;
    address standingOrders;
    address usdc;
    address desk;
    address payoutRail;
    address oracle;
}

/// Immutable context the hook passes to its libraries.
struct Ctx {
    bytes32 domainSeparator;
    address bank;
    address regulator;
    address operator;
    bool soterCounterStrict;
}

struct MandateState {
    Modules m;
    bool modulesSet;
    StatusRec globalStatus;
    uint64 hbEpoch;
    uint64 hbValidUntil;
    mapping(address => bool) installed;
    mapping(address => StatusRec) status;
    mapping(uint8 => CapsRec) caps;
    mapping(address => KyaRec) kya;
    mapping(address => AssetRec) assets;
    mapping(address => FlagRec) sanctioned;
    mapping(bytes2 => FlagRec) jurisdictions;
    mapping(address => AttesterRec) attesters;
    mapping(address => P.Policy) policy;
    mapping(address => bytes32) policyHash;
    mapping(address => mapping(uint256 => uint256)) spentDay;
    mapping(address => mapping(uint256 => uint256)) spentMonth;
    mapping(address => mapping(uint256 => uint256)) countDay;
    mapping(address => mapping(uint256 => uint256)) rebalancesDay;
    // Approvals are keyed by an epoch bumped on recovery, so recovery voids every pending approval at once.
    mapping(address => uint256) epoch;
    mapping(address => mapping(uint256 => mapping(bytes32 => ApprovalRec))) approvals;
    mapping(address => mapping(uint256 => mapping(bytes32 => ApprovalRec))) moduleApprovals;
    mapping(bytes32 => bool) usedDigest;
    mapping(address => bytes32) binding;
    mapping(bytes32 => uint64) soterCounter;
    mapping(address => bool) paused;
    mapping(address => RecoveryRec) recovery;
}

/// One evaluated call. kind: 0 none, 1 payment (A), 2 approve (B), 3 swap (C), 4 payout (D).
struct Verdict {
    uint8 reason;
    uint8 tier;
    uint8 kind;
    bool usesApproval;
    bool enforceBands;
    address target;
    bytes32 callHash;
    uint256 amount;
    uint256 valueUsd6;
}

uint8 constant KIND_NONE = 0;
uint8 constant KIND_PAYMENT = 1;
uint8 constant KIND_APPROVE = 2;
uint8 constant KIND_SWAP = 3;
uint8 constant KIND_PAYOUT = 4;
