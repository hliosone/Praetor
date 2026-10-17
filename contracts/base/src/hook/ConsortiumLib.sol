// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {MandateState, Ctx, StatusRec, AssetRec, CapsRec} from "./HookTypes.sol";

/// @notice Consortium setters of MandateHook (spec 03). Permissionless: member signatures are the authority.
/// Every message: now <= deadline, nonce == stored + 1 (I18), signers distinct members sorted ascending (I3).
/// Stricter needs fewer signatures than looser: 1 member tightens, 2 loosen, the bank alone for caps, KYA,
/// asset activation and attester activation. Runs by delegatecall on the hook's storage.
library ConsortiumLib {
    error Expired();
    error BadNonce();
    error BadSignatures();
    error NotEnoughSigners();
    error BankRequired();
    error InvalidValue();

    uint256 internal constant MAX_AMOUNT = 2 ** 128;
    uint256 internal constant MAX_HEARTBEAT_TTL = 1 days;

    function applyStatus(MandateState storage s, Ctx memory c, P.StatusAttestation calldata a, bytes[] calldata sigs) external {
        if (a.status > uint8(P.Status.FROZEN)) revert InvalidValue();
        StatusRec storage r = a.account == address(0) ? s.globalStatus : s.status[a.account];
        _fresh(a.deadline, a.nonce, r.nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, a.status > r.status ? 1 : 2, false);
        r.status = a.status;
        r.nonce = a.nonce;
        emit IMandateHookEvents.StatusApplied(a.account, a.status, a.nonce, a.fiscoRef, uint8(n));
    }

    function applyHeartbeat(MandateState storage s, Ctx memory c, P.HeartbeatAttestation calldata a, bytes[] calldata sigs) external {
        _fresh(a.deadline, a.epoch, s.hbEpoch);
        if (a.validUntil > block.timestamp + MAX_HEARTBEAT_TTL) revert InvalidValue();
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, 1, false);
        s.hbEpoch = a.epoch;
        s.hbValidUntil = a.validUntil;
        emit IMandateHookEvents.HeartbeatApplied(a.epoch, a.validUntil);
    }

    function applyCaps(MandateState storage s, Ctx memory c, P.CapsAttestation calldata a, bytes[] calldata sigs) external {
        if (a.riskProfile > uint8(P.RiskProfile.GROWTH)) revert InvalidValue();
        if (a.perTxCap > MAX_AMOUNT || a.dailyCap > MAX_AMOUNT || a.monthlyCap > MAX_AMOUNT) revert InvalidValue();
        _fresh(a.deadline, a.nonce, s.caps[a.riskProfile].nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, 1, true);
        s.caps[a.riskProfile] = CapsRec(a.perTxCap, a.dailyCap, a.monthlyCap, a.nonce);
        emit IMandateHookEvents.CapsApplied(a.riskProfile, a.perTxCap, a.dailyCap, a.monthlyCap, a.fiscoRef);
    }

    function applyKYA(MandateState storage s, Ctx memory c, P.KYAAttestation calldata a, bytes[] calldata sigs) external {
        if (a.riskProfile > uint8(P.RiskProfile.GROWTH)) revert InvalidValue();
        _fresh(a.deadline, a.nonce, s.kya[a.account].nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, 1, true);
        s.kya[a.account].agentKey = a.agentKey;
        s.kya[a.account].validUntil = a.validUntil;
        s.kya[a.account].nonce = a.nonce;
        s.kya[a.account].kycLevel = a.kycLevel;
        s.kya[a.account].riskProfile = a.riskProfile;
        s.kya[a.account].jurisdiction = a.jurisdiction;
        s.kya[a.account].agentDidHash = a.agentDidHash;
        s.kya[a.account].kycCredentialHash = a.kycCredentialHash;
        s.kya[a.account].mandateCredentialHash = a.mandateCredentialHash;
        s.kya[a.account].agentMeasurement = a.agentMeasurement;
        emit IMandateHookEvents.KYAApplied(a.account, a.agentKey, a.kycLevel, a.riskProfile, a.jurisdiction, a.validUntil, a.fiscoRef);
    }

    function applyAsset(MandateState storage s, Ctx memory c, P.AssetAttestation calldata a, bytes[] calldata sigs) external {
        if (a.kind > uint8(P.AssetKind.PAYOUT_PARTNER) || a.status > uint8(P.AssetStatus.DELISTED) || a.maxWeightBps > P.BPS) {
            revert InvalidValue();
        }
        AssetRec storage r = s.assets[a.asset];
        _fresh(a.deadline, a.nonce, r.nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        bool loosens = _rank(a.status) < _rank(r.status) || a.maxWeightBps > r.maxWeightBps
            || (a.kind != r.kind && r.status != uint8(P.AssetStatus.NONE));
        _need(n, hasBank, 1, loosens);
        r.kind = a.kind;
        r.status = a.status;
        r.maxWeightBps = a.maxWeightBps;
        r.nonce = a.nonce;
        emit IMandateHookEvents.AssetApplied(a.asset, a.kind, a.status, a.maxWeightBps, a.fiscoRef);
    }

    function applySanctions(MandateState storage s, Ctx memory c, P.SanctionsAttestation calldata a, bytes[] calldata sigs) external {
        _fresh(a.deadline, a.nonce, s.sanctioned[a.target].nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, a.listed ? 1 : 2, false);
        s.sanctioned[a.target].on = a.listed;
        s.sanctioned[a.target].nonce = a.nonce;
        emit IMandateHookEvents.SanctionsApplied(a.target, a.listed, a.fiscoRef);
    }

    function applyJurisdiction(MandateState storage s, Ctx memory c, P.JurisdictionAttestation calldata a, bytes[] calldata sigs)
        external
    {
        _fresh(a.deadline, a.nonce, s.jurisdictions[a.jurisdiction].nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, a.payoutBlocked ? 1 : 2, false);
        s.jurisdictions[a.jurisdiction].on = a.payoutBlocked;
        s.jurisdictions[a.jurisdiction].nonce = a.nonce;
        emit IMandateHookEvents.JurisdictionApplied(a.jurisdiction, a.payoutBlocked, a.fiscoRef);
    }

    function applyAttester(MandateState storage s, Ctx memory c, P.AttesterAttestation calldata a, bytes[] calldata sigs) external {
        _fresh(a.deadline, a.nonce, s.attesters[a.attester].nonce);
        (uint256 n, bool hasBank) = _signers(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        _need(n, hasBank, 1, a.active);
        s.attesters[a.attester].measurement = a.measurement;
        s.attesters[a.attester].active = a.active;
        s.attesters[a.attester].nonce = a.nonce;
        emit IMandateHookEvents.AttesterApplied(a.attester, a.measurement, a.active);
    }

    /// Counts distinct member signers (ascending, no malleable s) and whether the bank is among them.
    function countSigners(Ctx memory c, bytes32 d, bytes[] calldata sigs) external pure returns (uint256 n, bool hasBank) {
        return _signers(c, d, sigs);
    }

    function _signers(Ctx memory c, bytes32 d, bytes[] calldata sigs) internal pure returns (uint256 n, bool hasBank) {
        address last;
        for (uint256 i; i < sigs.length; ++i) {
            (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(d, sigs[i]);
            if (err != ECDSA.RecoverError.NoError || who <= last) revert BadSignatures();
            if (who != c.bank && who != c.regulator && who != c.operator) revert BadSignatures();
            if (who == c.bank) hasBank = true;
            last = who;
        }
        n = sigs.length;
    }

    function _need(uint256 n, bool hasBank, uint256 min, bool bankRequired) internal pure {
        if (bankRequired && !hasBank) revert BankRequired();
        if (n < min) revert NotEnoughSigners();
    }

    function _fresh(uint64 deadline, uint64 nonce, uint64 stored) internal view {
        if (block.timestamp > deadline) revert Expired();
        if (nonce != stored + 1) revert BadNonce();
    }

    /// Strictness rank of an asset status: ACTIVE < SUSPENDED (sells only) < DELISTED = NONE (no trades).
    function _rank(uint8 status) internal pure returns (uint8) {
        if (status == uint8(P.AssetStatus.ACTIVE)) return 0;
        if (status == uint8(P.AssetStatus.SUSPENDED)) return 1;
        return 2;
    }
}
