// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {IERC7579Hook, IERC7579Account, Execution, MODULE_TYPE_HOOK, MODE_SINGLE, MODE_BATCH} from "./interfaces/IERC7579.sol";
import {MandateState, Modules, Ctx, CapsRec, KyaRec, AssetRec, AttesterRec, ApprovalRec, Verdict, KIND_APPROVE, KIND_SWAP} from "./hook/HookTypes.sol";
import {DecisionLib} from "./hook/DecisionLib.sol";
import {PostCheckLib} from "./hook/PostCheckLib.sol";
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
    error TierThreeRequired();

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

    /// Only during an approved removal of this hook (MODULE_CHANGE, flag set by the outer preCheck). Safe7579
    /// swallows a revert here, so the real gate is that preCheck (V1 T1, Q14).
    function onUninstall(bytes calldata) external {
        if (!_tget(UNINSTALLING, msg.sender)) revert TierThreeRequired();
        delete s.installed[msg.sender];
        delete s.policyHash[msg.sender];
        delete s.policy[msg.sender];
        delete s.binding[msg.sender];
        delete s.paused[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK;
    }

    function isInitialized(address account) external view returns (bool) {
        return s.installed[account];
    }

    /// Runs before every execution of the account (msg.sender). msgData ends with the 20-byte original caller.
    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData) external returns (bytes memory) {
        address account = msg.sender;
        if (!s.installed[account]) revert NotInstalled();
        if (msgValue != 0 || msgData.length < 24) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        bytes calldata data = msgData[:msgData.length - 20];
        bytes4 sel = bytes4(data[:4]);
        if (sel == IERC7579Account.execute.selector) return _preExecute(account, data, false);
        if (sel == IERC7579Account.executeFromExecutor.selector) {
            if (msgSender != s.m.standingOrders) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
            return _preExecute(account, data, true);
        }
        if (sel == IERC7579Account.installModule.selector || sel == IERC7579Account.uninstallModule.selector) {
            return _preModuleInner(account, msgSender, data);
        }
        _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
    }

    function postCheck(bytes calldata hookData) external {
        address account = msg.sender;
        if (_tget(UNINSTALLING, account)) {
            _tset(UNINSTALLING, account, 0);
            _tset(PENDING, account, 0);
            return;
        }
        uint8 mode = uint8(bytes1(hookData[:1]));
        if (mode == POST_MODULE_OUTER) {
            _tset(PENDING, account, 0);
            return;
        }
        if (mode == POST_EXEC) PostCheckLib.check(s, account, hookData[1:]);
    }

    // ---------------------------------------------------------------- decisions (views, never revert: I12)

    function check(address account, address target, uint256 value, bytes calldata data)
        external
        view
        returns (uint8 reason, uint8 tier, bytes32 callHash)
    {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(target, value, data);
        Verdict[] memory v = DecisionLib.evaluate(s, account, calls, false);
        return (v[0].reason, v[0].tier, v[0].callHash);
    }

    function checkBatch(address account, Execution[] calldata calls)
        external
        view
        returns (uint8[] memory reasons, uint8[] memory tiers, bytes32[] memory callHashes)
    {
        Verdict[] memory v = DecisionLib.evaluate(s, account, calls, false);
        reasons = new uint8[](v.length);
        tiers = new uint8[](v.length);
        callHashes = new bytes32[](v.length);
        for (uint256 i; i < v.length; ++i) (reasons[i], tiers[i], callHashes[i]) = (v[i].reason, v[i].tier, v[i].callHash);
    }

    // ---------------------------------------------------------------- preCheck paths

    function _preExecute(address account, bytes calldata data, bool executor) internal returns (bytes memory) {
        (bytes32 mode, bytes calldata exec) = _decodeExecute(data);
        Execution[] memory calls;
        if (mode == MODE_SINGLE) {
            if (exec.length < 52) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
            address target = address(bytes20(exec[:20]));
            uint256 value = uint256(bytes32(exec[20:52]));
            if (target == account && !executor) return _preModuleOuter(account, value, exec[52:]);
            calls = new Execution[](1);
            calls[0] = Execution(target, value, exec[52:]);
        } else if (mode == MODE_BATCH) {
            calls = abi.decode(exec, (Execution[]));
            // Canonical encoding only: a batch that decodes to these calls but has other bytes is hidden.
            if (keccak256(abi.encode(calls)) != keccak256(exec)) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        } else {
            _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        }
        Verdict[] memory v = DecisionLib.evaluate(s, account, calls, executor);
        for (uint256 i; i < v.length; ++i) if (v[i].reason != 0) _refuse(v[i].reason, v[i].callHash);
        DecisionLib.applyEffects(s, account, v, executor);
        return PostCheckLib.prepare(s, account, calls, v);
    }

    /// Module change (Q14): a single execute(self.installModule/uninstallModule) with a live MODULE_CHANGE
    /// approval. FROZEN still wins (D19): owner and bank cannot remove the hook during a regulator freeze.
    function _preModuleOuter(address account, uint256 value, bytes calldata inner) internal returns (bytes memory) {
        uint8 acc = s.status[account].status;
        uint8 glob = s.globalStatus.status;
        if ((acc > glob ? acc : glob) == uint8(P.Status.FROZEN)) _refuse(uint8(P.Reason.FROZEN), bytes32(0));
        bytes32 ch = P.callHash(account, account, value, inner);
        if (value != 0 || inner.length < 4) _refuse(uint8(P.Reason.HIDDEN_CALL), ch);
        bytes4 sel = bytes4(inner[:4]);
        if (sel != IERC7579Account.installModule.selector && sel != IERC7579Account.uninstallModule.selector) {
            _refuse(uint8(P.Reason.HIDDEN_CALL), ch);
        }
        ApprovalRec storage slot = s.moduleApprovals[account][s.epoch[account]][ch];
        if (slot.expiresAt <= block.timestamp || slot.consumed) _refuse(uint8(P.Reason.TIER3_REQUIRED), ch);
        slot.consumed = true;
        _tset(PENDING, account, uint256(ch));
        if (sel == IERC7579Account.uninstallModule.selector && inner.length >= 68) {
            (uint256 typeId, address module) = abi.decode(inner[4:68], (uint256, address));
            if (typeId == MODULE_TYPE_HOOK && module == address(this)) _tset(UNINSTALLING, account, 1);
        }
        emit Decision(account, ch, 0, uint8(P.Tier.T3_OWNER), account, 0);
        return abi.encodePacked(POST_MODULE_OUTER);
    }

    /// The account's own installModule/uninstallModule call, accepted only as the inner call of an approved
    /// outer module change (transient, same transaction, same account).
    function _preModuleInner(address account, address msgSender, bytes calldata data) internal returns (bytes memory) {
        bytes32 ch = P.callHash(account, account, 0, data);
        if (msgSender != account || _tload(PENDING, account) != uint256(ch) || ch == bytes32(0)) {
            _refuse(uint8(P.Reason.TIER3_REQUIRED), ch);
        }
        _tset(PENDING, account, 0);
        return abi.encodePacked(POST_MODULE_INNER);
    }

    function _decodeExecute(bytes calldata data) internal pure returns (bytes32 mode, bytes calldata exec) {
        if (data.length < 68) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        mode = bytes32(data[4:36]);
        uint256 offset = uint256(bytes32(data[36:68]));
        if (offset != 64 || data.length < 100) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        uint256 len = uint256(bytes32(data[68:100]));
        if (len > data.length - 100) _refuse(uint8(P.Reason.HIDDEN_CALL), bytes32(0));
        exec = data[100:100 + len];
    }

    function _refuse(uint8 reason, bytes32 callHash) internal pure {
        revert MandateRefused(reason, callHash);
    }

    // ---------------------------------------------------------------- transient flags, keyed by account

    bytes32 internal constant PENDING = keccak256("praetor.hook.pendingModuleCall");
    bytes32 internal constant UNINSTALLING = keccak256("praetor.hook.uninstalling");
    uint8 internal constant POST_EXEC = 1;
    uint8 internal constant POST_MODULE_OUTER = 2;
    uint8 internal constant POST_MODULE_INNER = 3;

    function _slot(bytes32 tag, address account) internal pure returns (bytes32) {
        return keccak256(abi.encode(tag, account));
    }

    function _tset(bytes32 tag, address account, uint256 value) internal {
        bytes32 slot = _slot(tag, account);
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    function _tload(bytes32 tag, address account) internal view returns (uint256 value) {
        bytes32 slot = _slot(tag, account);
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _tget(bytes32 tag, address account) internal view returns (bool) {
        return _tload(tag, account) != 0;
    }

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

    function spentOf(address account) external view returns (uint256 day, uint256 month, uint256 count, uint256 rebalances) {
        uint256 d = block.timestamp / 1 days;
        return (s.spentDay[account][d], s.spentMonth[account][block.timestamp / 30 days], s.countDay[account][d], s.rebalancesDay[account][d]);
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
