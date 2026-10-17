// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {IERC7579Hook, MODULE_TYPE_HOOK} from "./interfaces/IERC7579.sol";
import {MandateState, Modules, Ctx, CapsRec, KyaRec, AssetRec, AttesterRec, ApprovalRec} from "./hook/HookTypes.sol";
import {ConsortiumLib} from "./hook/ConsortiumLib.sol";
import {OwnerLib} from "./hook/OwnerLib.sol";

/// @title MandateHook
/// @notice The single global ERC-7579 hook of every Praetor account: the policy engine (spec 03). Every execution
/// passes it, whoever signed (I1). Default deny (I2). Consortium decisions arrive as member signatures it verifies
/// itself (I3); human approvals and owner actions are verified on-chain (I5, I6). Large parts live in external
/// libraries (delegatecall on this storage) to stay under the contract size limit.
contract MandateHook is IERC7579Hook, IMandateHookEvents {
    address internal immutable bank;
    address internal immutable regulator;
    address internal immutable operator;
    address internal immutable deployer;
    bool public immutable soterCounterStrict;
    bytes32 internal immutable domainSep;
    string public domainName;

    MandateState internal s;

    error OnlyDeployer();
    error ModulesAlreadySet();
    error InvalidMembers();
    error NotInstalled();

    constructor(address bank_, address regulator_, address operator_, string memory domainName_, bool soterCounterStrict_) {
        if (
            bank_ == address(0) || regulator_ == address(0) || operator_ == address(0) || bank_ == regulator_
                || bank_ == operator_ || regulator_ == operator_
        ) revert InvalidMembers();
        bank = bank_;
        regulator = regulator_;
        operator = operator_;
        deployer = msg.sender;
        domainName = domainName_;
        soterCounterStrict = soterCounterStrict_;
        domainSep = P.domainSeparator(domainName_, address(this));
    }

    /// Wired once, last in the deployment, by the deployer (spec 03).
    function setModules(Modules calldata m) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (s.modulesSet) revert ModulesAlreadySet();
        s.m = m;
        s.modulesSet = true;
    }

    // ---------------------------------------------------------------- ERC-7579 module

    function onInstall(bytes calldata) external {
        s.installed[msg.sender] = true;
    }

    function onUninstall(bytes calldata) external {}

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK;
    }

    function isInitialized(address account) external view returns (bool) {
        return s.installed[account];
    }

    function preCheck(address, uint256, bytes calldata) external pure returns (bytes memory) {
        revert MandateRefused(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
    }

    function postCheck(bytes calldata) external {}

    // ---------------------------------------------------------------- consortium setters (permissionless)

    function applyStatus(P.StatusAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyStatus(s, _ctx(), a, sigs);
    }

    function applyHeartbeat(P.HeartbeatAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyHeartbeat(s, _ctx(), a, sigs);
    }

    function applyCaps(P.CapsAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyCaps(s, _ctx(), a, sigs);
    }

    function applyKYA(P.KYAAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyKYA(s, _ctx(), a, sigs);
    }

    function applyAsset(P.AssetAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyAsset(s, _ctx(), a, sigs);
    }

    function applySanctions(P.SanctionsAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applySanctions(s, _ctx(), a, sigs);
    }

    function applyJurisdiction(P.JurisdictionAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyJurisdiction(s, _ctx(), a, sigs);
    }

    function applyAttester(P.AttesterAttestation calldata a, bytes[] calldata sigs) external {
        ConsortiumLib.applyAttester(s, _ctx(), a, sigs);
    }

    // ---------------------------------------------------------------- approvals, owner actions, recovery

    function registerApproval(P.Tier2Approval calldata a, P.OwnerAuth calldata auth) external {
        OwnerLib.registerApproval(s, _ctx(), a, auth);
    }

    function applyOwnerAction(P.OwnerAction calldata a, bytes calldata payload, P.OwnerAuth calldata auth, bytes[] calldata bankSigs)
        external
    {
        OwnerLib.applyOwnerAction(s, _ctx(), a, payload, auth, bankSigs);
    }

    function scheduleRecovery(P.OwnerAction calldata a, bytes calldata payload, bytes[] calldata bankSigs) external {
        OwnerLib.scheduleRecovery(s, _ctx(), a, payload, bankSigs);
    }

    function executeRecovery(address account) external {
        OwnerLib.executeRecovery(s, account);
    }

    // ---------------------------------------------------------------- views

    function members() external view returns (address, address, address) {
        return (bank, regulator, operator);
    }

    function domainSeparator() external view returns (bytes32) {
        return domainSep;
    }

    function modules() external view returns (Modules memory) {
        return s.m;
    }

    function statusOf(address account)
        external
        view
        returns (uint8 effective, uint8 accountStatus, uint8 globalStatus, uint64 heartbeatValidUntil)
    {
        accountStatus = s.status[account].status;
        globalStatus = s.globalStatus.status;
        effective = accountStatus > globalStatus ? accountStatus : globalStatus;
        heartbeatValidUntil = s.hbValidUntil;
    }

    function capsOf(uint8 profile) external view returns (uint256 perTxCap, uint256 dailyCap, uint256 monthlyCap) {
        CapsRec memory c = s.caps[profile];
        return (c.perTxCap, c.dailyCap, c.monthlyCap);
    }

    function kyaOf(address account)
        external
        view
        returns (address agentKey, uint8 kycLevel, uint8 riskProfile, bytes2 jurisdiction, uint64 validUntil)
    {
        KyaRec memory k = s.kya[account];
        return (k.agentKey, k.kycLevel, k.riskProfile, k.jurisdiction, k.validUntil);
    }

    function assetOf(address asset) external view returns (uint8 kind, uint8 status, uint16 maxWeightBps, uint64 nonce) {
        AssetRec memory a = s.assets[asset];
        return (a.kind, a.status, a.maxWeightBps, a.nonce);
    }

    function isSanctioned(address target) external view returns (bool) {
        return s.sanctioned[target].on;
    }

    function isPayoutBlocked(bytes2 jurisdiction) external view returns (bool) {
        return s.jurisdictions[jurisdiction].on;
    }

    function attesterOf(address who) external view returns (bytes32 measurement, bool active) {
        AttesterRec memory a = s.attesters[who];
        return (a.measurement, a.active);
    }

    function policyOf(address account) external view returns (P.Policy memory) {
        return s.policy[account];
    }

    function policyHashOf(address account) external view returns (bytes32) {
        return s.policyHash[account];
    }

    function approvalOf(address account, bytes32 callHash) external view returns (uint64 expiresAt, bool consumed) {
        ApprovalRec memory a = s.approvals[account][s.epoch[account]][callHash];
        return (a.expiresAt, a.consumed);
    }

    function moduleApprovalOf(address account, bytes32 callHash) external view returns (uint64 expiresAt, bool consumed) {
        ApprovalRec memory a = s.moduleApprovals[account][s.epoch[account]][callHash];
        return (a.expiresAt, a.consumed);
    }

    function isDigestUsed(bytes32 digest) external view returns (bool) {
        return s.usedDigest[digest];
    }

    function bindingOf(address account) external view returns (bytes32) {
        return s.binding[account];
    }

    function soterCounterOf(bytes32 bindingHash) external view returns (uint64) {
        return s.soterCounter[bindingHash];
    }

    function isPaused(address account) external view returns (bool) {
        return s.paused[account];
    }

    function isRecoveryPending(address account) external view returns (bool) {
        return s.recovery[account].executableAt != 0;
    }

    /// Stored nonce per message type, key = the left-padded address, profile or bytes2: 0 status (account 0 = global), 1 caps (profile),
    /// 2 KYA (account), 3 asset, 4 sanctions, 5 jurisdiction (bytes2), 6 attester, 7 heartbeat epoch.
    function nonces(uint8 kind, bytes32 key) external view returns (uint64) {
        if (kind == 0) {
            address a = address(uint160(uint256(key)));
            return a == address(0) ? s.globalStatus.nonce : s.status[a].nonce;
        }
        if (kind == 1) return s.caps[uint8(uint256(key))].nonce;
        if (kind == 2) return s.kya[address(uint160(uint256(key)))].nonce;
        if (kind == 3) return s.assets[address(uint160(uint256(key)))].nonce;
        if (kind == 4) return s.sanctioned[address(uint160(uint256(key)))].nonce;
        if (kind == 5) return s.jurisdictions[bytes2(key)].nonce;
        if (kind == 6) return s.attesters[address(uint160(uint256(key)))].nonce;
        return s.hbEpoch;
    }

    function _ctx() internal view returns (Ctx memory) {
        return Ctx(domainSep, bank, regulator, operator, soterCounterStrict);
    }
}
