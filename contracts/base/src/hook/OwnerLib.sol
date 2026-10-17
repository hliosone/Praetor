// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {MandateState, Ctx, ApprovalRec, RecoveryRec} from "./HookTypes.sol";
import {IPasskeyKeys, IAgentKeys, IStandingOrdersAdmin} from "../interfaces/IPraetorModules.sol";
import {IERC7579Account} from "../interfaces/IERC7579.sol";

/// @notice Human approvals (T2), owner actions (T3, T3-) and recovery of MandateHook (spec 03). Owner auth is a
/// passkey checked with WebAuthn.sol, or a SOTER approval signed by an active attester for the account's binding
/// with a strictly increasing counter (I5, I6). Runs by delegatecall on the hook's storage.
library OwnerLib {
    error BadExpiry();
    error DigestUsed();
    error SlotBusy();
    error BadOwnerAuth();
    error BadSoter();
    error SoterNotEnabled();
    error BankRequired();
    error PayloadMismatch();
    error InvalidPayload();
    error InvalidPolicy(uint8 rule);
    error RecoveryPending();
    error NoRecovery();
    error TooEarly();

    uint256 internal constant MAX_TTL = 1 hours;
    uint256 internal constant RECOVERY_DELAY = 48 hours;

    // ---------------------------------------------------------------- Tier2Approval

    function registerApproval(MandateState storage s, Ctx memory c, P.Tier2Approval calldata a, P.OwnerAuth calldata auth)
        external
    {
        _window(a.expiresAt);
        bytes32 d = P.digest(c.domainSeparator, P.hash(a));
        if (s.usedDigest[d]) revert DigestUsed();
        ApprovalRec storage slot = s.approvals[a.account][s.epoch[a.account]][a.callHash];
        _slotFree(slot);
        uint8 kind = _ownerAuth(s, c, a.account, d, auth, true);
        s.usedDigest[d] = true;
        slot.expiresAt = a.expiresAt;
        slot.consumed = false;
        emit IMandateHookEvents.ApprovalRegistered(a.account, a.callHash, kind, a.expiresAt);
    }

    // ---------------------------------------------------------------- owner actions

    function applyOwnerAction(
        MandateState storage s,
        Ctx memory c,
        P.OwnerAction calldata a,
        bytes calldata payload,
        P.OwnerAuth calldata auth,
        bytes[] calldata bankSigs
    ) external {
        if (a.action > uint8(P.OwnerActionKind.REMOVE_PAYEE)) revert InvalidPayload();
        _window(a.expiresAt);
        bytes32 d = P.digest(c.domainSeparator, P.hash(a));
        if (s.usedDigest[d]) revert DigestUsed();
        if (P.ownerActionPayloadHash(a.account, a.action, payload) != a.payloadHash) revert PayloadMismatch();
        bool passkeyOnly = a.action == uint8(P.OwnerActionKind.LINK_WECHAT) || a.action == uint8(P.OwnerActionKind.SET_OWNER_KEY);
        uint8 kind = _ownerAuth(s, c, a.account, d, auth, !passkeyOnly);
        if (_needsBank(a.action) && !_bankSigned(c, d, bankSigs)) revert BankRequired();
        s.usedDigest[d] = true;
        _effect(s, c, a, payload, d);
        emit IMandateHookEvents.OwnerActionApplied(a.account, a.action, a.payloadHash, kind, d);
    }

    // ---------------------------------------------------------------- recovery

    /// The bank alone (after its own re-KYC) schedules a SET_OWNER_KEY that replaces every owner key in 48 h;
    /// meanwhile the account is RESTRICTED and the owner can cancel it alone.
    function scheduleRecovery(MandateState storage s, Ctx memory c, P.OwnerAction calldata a, bytes calldata payload, bytes[] calldata bankSigs)
        external
    {
        if (a.action != uint8(P.OwnerActionKind.SET_OWNER_KEY)) revert InvalidPayload();
        _window(a.expiresAt);
        bytes32 d = P.digest(c.domainSeparator, P.hash(a));
        if (s.usedDigest[d]) revert DigestUsed();
        if (keccak256(payload) != a.payloadHash) revert PayloadMismatch();
        if (!_bankSigned(c, d, bankSigs)) revert BankRequired();
        if (s.recovery[a.account].executableAt != 0) revert RecoveryPending();
        (bytes32 cred, uint256 x, uint256 y) = abi.decode(payload, (bytes32, uint256, uint256));
        if (x == 0 && y == 0) revert InvalidPayload();
        s.usedDigest[d] = true;
        uint64 at = uint64(block.timestamp + RECOVERY_DELAY);
        s.recovery[a.account] = RecoveryRec(a.payloadHash, at, cred, x, y);
        emit IMandateHookEvents.RecoveryScheduled(a.account, a.payloadHash, at);
    }

    function executeRecovery(MandateState storage s, address account) external {
        RecoveryRec memory r = s.recovery[account];
        if (r.executableAt == 0) revert NoRecovery();
        if (block.timestamp < r.executableAt) revert TooEarly();
        delete s.recovery[account];
        IPasskeyKeys(s.m.passkeyValidator).replaceAllKeys(account, r.credIdHash, r.x, r.y);
        s.binding[account] = bytes32(0);
        s.epoch[account] += 1;
        IAgentKeys(s.m.agentKeyValidator).revoke(account);
        emit IMandateHookEvents.RecoveryExecuted(account, r.payloadHash);
    }

    // ---------------------------------------------------------------- effects

    function _effect(MandateState storage s, Ctx memory c, P.OwnerAction calldata a, bytes calldata payload, bytes32 d) internal {
        uint8 k = a.action;
        address account = a.account;
        if (k == uint8(P.OwnerActionKind.SET_POLICY)) {
            P.Policy memory p = abi.decode(payload, (P.Policy));
            if (P.policyHash(p) != a.payloadHash) revert PayloadMismatch();
            uint8 rule = P.validatePolicy(p, block.timestamp, s.m.usdc);
            if (rule != 0) revert InvalidPolicy(rule);
            _storePolicy(s, account, p);
        } else if (k == uint8(P.OwnerActionKind.ADD_STANDING_ORDER)) {
            P.StandingOrder memory o = abi.decode(payload, (P.StandingOrder));
            if (o.account != account) revert InvalidPayload();
            IStandingOrdersAdmin(s.m.standingOrders).set(o);
        } else if (k == uint8(P.OwnerActionKind.CANCEL_STANDING_ORDER)) {
            IStandingOrdersAdmin(s.m.standingOrders).cancel(account, abi.decode(payload, (uint32)));
        } else if (k == uint8(P.OwnerActionKind.LINK_WECHAT)) {
            _link(s, c, account, payload, d);
        } else if (k == uint8(P.OwnerActionKind.UNLINK_WECHAT)) {
            bytes32 b = abi.decode(payload, (bytes32));
            if (b == bytes32(0) || b != s.binding[account]) revert InvalidPayload();
            s.binding[account] = bytes32(0);
        } else if (k == uint8(P.OwnerActionKind.SET_AGENT_KEY)) {
            (address key, uint48 validUntil) = abi.decode(payload, (address, uint48));
            if (key == address(0) || key != s.kya[account].agentKey || validUntil <= block.timestamp) revert InvalidPayload();
            IAgentKeys(s.m.agentKeyValidator).setKey(account, key, validUntil);
        } else if (k == uint8(P.OwnerActionKind.REVOKE_AGENT_KEY)) {
            IAgentKeys(s.m.agentKeyValidator).revoke(account);
        } else if (k == uint8(P.OwnerActionKind.PAUSE_AGENT) || k == uint8(P.OwnerActionKind.RESUME_AGENT)) {
            if (payload.length != 0) revert InvalidPayload();
            s.paused[account] = k == uint8(P.OwnerActionKind.PAUSE_AGENT);
        } else if (k == uint8(P.OwnerActionKind.SET_OWNER_KEY)) {
            (bytes32 cred, uint256 x, uint256 y) = abi.decode(payload, (bytes32, uint256, uint256));
            IPasskeyKeys(s.m.passkeyValidator).setKey(account, cred, x, y);
        } else if (k == uint8(P.OwnerActionKind.CANCEL_RECOVERY)) {
            bytes32 h = abi.decode(payload, (bytes32));
            if (h == bytes32(0) || s.recovery[account].payloadHash != h) revert InvalidPayload();
            delete s.recovery[account];
            emit IMandateHookEvents.RecoveryCancelled(account, h);
        } else if (k == uint8(P.OwnerActionKind.MODULE_CHANGE)) {
            _moduleApproval(s, account, payload, a.payloadHash, a.expiresAt);
        } else {
            _removePayee(s, account, payload);
        }
    }

    function _link(MandateState storage s, Ctx memory c, address account, bytes calldata payload, bytes32 d) internal {
        (, P.SoterApproval memory proof, bytes memory sig) = abi.decode(payload, (bytes32, P.SoterApproval, bytes));
        if (proof.bindingHash == bytes32(0)) revert BadSoter();
        _soter(s, c, account, d, proof, sig, proof.bindingHash);
        s.binding[account] = proof.bindingHash;
    }

    function _moduleApproval(MandateState storage s, address account, bytes calldata payload, bytes32 h, uint64 expiresAt) internal {
        if (payload.length < 4) revert InvalidPayload();
        bytes4 sel = bytes4(payload[:4]);
        if (sel != IERC7579Account.installModule.selector && sel != IERC7579Account.uninstallModule.selector) revert InvalidPayload();
        ApprovalRec storage slot = s.moduleApprovals[account][s.epoch[account]][h];
        _slotFree(slot);
        slot.expiresAt = expiresAt;
        slot.consumed = false;
    }

    function _removePayee(MandateState storage s, address account, bytes calldata payload) internal {
        (uint8 tag, bytes32 v) = abi.decode(payload, (uint8, bytes32));
        P.Policy storage p = s.policy[account];
        bool found;
        if (tag == 0) {
            if (uint256(v) >> 160 != 0) revert InvalidPayload();
            address payee = address(uint160(uint256(v)));
            for (uint256 i; i < p.payees.length; ++i) {
                if (p.payees[i] == payee) {
                    p.payees[i] = p.payees[p.payees.length - 1];
                    p.payees.pop();
                    found = true;
                    break;
                }
            }
        } else if (tag == 1) {
            for (uint256 i; i < p.merchants.length; ++i) {
                if (p.merchants[i] == v) {
                    p.merchants[i] = p.merchants[p.merchants.length - 1];
                    p.merchants.pop();
                    found = true;
                    break;
                }
            }
        }
        if (!found) revert InvalidPayload();
        bytes32 h = P.policyHash(s.policy[account]);
        s.policyHash[account] = h;
        emit IMandateHookEvents.PolicySet(account, h);
    }

    /// Legacy codegen cannot copy a memory Band[] into storage in one assignment: copied field by field.
    function _storePolicy(MandateState storage s, address account, P.Policy memory p) internal {
        P.Policy storage sp = s.policy[account];
        sp.autoCap = p.autoCap;
        sp.hardCap = p.hardCap;
        sp.dailyBudget = p.dailyBudget;
        sp.monthlyBudget = p.monthlyBudget;
        sp.dailyCount = p.dailyCount;
        sp.bufferUsdc = p.bufferUsdc;
        sp.maxRebalancesPerDay = p.maxRebalancesPerDay;
        sp.maxTradeUsd = p.maxTradeUsd;
        sp.maxSlippageBps = p.maxSlippageBps;
        sp.validUntil = p.validUntil;
        sp.soterEnabled = p.soterEnabled;
        delete sp.payees;
        for (uint256 i; i < p.payees.length; ++i) sp.payees.push(p.payees[i]);
        delete sp.merchants;
        for (uint256 i; i < p.merchants.length; ++i) sp.merchants.push(p.merchants[i]);
        delete sp.bands;
        for (uint256 i; i < p.bands.length; ++i) sp.bands.push(p.bands[i]);
        bytes32 h = P.policyHash(p);
        s.policyHash[account] = h;
        emit IMandateHookEvents.PolicySet(account, h);
    }

    // ---------------------------------------------------------------- auth

    function _ownerAuth(MandateState storage s, Ctx memory c, address account, bytes32 d, P.OwnerAuth calldata auth, bool allowSoter)
        internal
        returns (uint8)
    {
        if (auth.kind == uint8(P.AuthKind.PASSKEY)) {
            (bytes32 cred, WebAuthn.WebAuthnAuth memory w) = abi.decode(auth.data, (bytes32, WebAuthn.WebAuthnAuth));
            (uint256 x, uint256 y) = IPasskeyKeys(s.m.passkeyValidator).ownerKey(account, cred);
            if ((x == 0 && y == 0) || !WebAuthn.verify(abi.encodePacked(d), true, w, x, y)) revert BadOwnerAuth();
            return uint8(P.AuthKind.PASSKEY);
        }
        if (auth.kind != uint8(P.AuthKind.SOTER) || !allowSoter) revert BadOwnerAuth();
        if (s.policyHash[account] == bytes32(0) || !s.policy[account].soterEnabled) revert SoterNotEnabled();
        bytes32 b = s.binding[account];
        if (b == bytes32(0)) revert BadSoter();
        (P.SoterApproval memory sa, bytes memory sig) = abi.decode(auth.data, (P.SoterApproval, bytes));
        _soter(s, c, account, d, sa, sig, b);
        return uint8(P.AuthKind.SOTER);
    }

    /// Attester-signed SoterApproval: active attester, same account and digest, expected binding, at most one hour,
    /// counter strictly above the stored one when strict (the counter is recorded either way).
    function _soter(
        MandateState storage s,
        Ctx memory c,
        address account,
        bytes32 d,
        P.SoterApproval memory sa,
        bytes memory sig,
        bytes32 expectedBinding
    ) internal {
        (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(P.digest(c.domainSeparator, P.hash(sa)), sig);
        if (err != ECDSA.RecoverError.NoError || !s.attesters[who].active) revert BadSoter();
        if (sa.account != account || sa.digest != d || sa.bindingHash != expectedBinding) revert BadSoter();
        if (block.timestamp >= sa.expiresAt || sa.expiresAt > block.timestamp + MAX_TTL) revert BadSoter();
        uint64 stored = s.soterCounter[expectedBinding];
        if (c.soterCounterStrict && sa.soterCounter <= stored) revert BadSoter();
        if (sa.soterCounter > stored) s.soterCounter[expectedBinding] = sa.soterCounter;
    }

    function _bankSigned(Ctx memory c, bytes32 d, bytes[] calldata sigs) internal pure returns (bool) {
        for (uint256 i; i < sigs.length; ++i) {
            (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(d, sigs[i]);
            if (err == ECDSA.RecoverError.NoError && who == c.bank) return true;
        }
        return false;
    }

    function _needsBank(uint8 k) internal pure returns (bool) {
        return k == uint8(P.OwnerActionKind.SET_POLICY) || k == uint8(P.OwnerActionKind.ADD_STANDING_ORDER)
            || k == uint8(P.OwnerActionKind.LINK_WECHAT) || k == uint8(P.OwnerActionKind.SET_AGENT_KEY)
            || k == uint8(P.OwnerActionKind.SET_OWNER_KEY) || k == uint8(P.OwnerActionKind.MODULE_CHANGE);
    }

    function _window(uint64 expiresAt) internal view {
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_TTL) revert BadExpiry();
    }

    /// A slot can be (re)registered when empty, consumed or expired.
    function _slotFree(ApprovalRec storage slot) internal view {
        if (slot.expiresAt != 0 && !slot.consumed && slot.expiresAt > block.timestamp) revert SlotBusy();
    }
}
