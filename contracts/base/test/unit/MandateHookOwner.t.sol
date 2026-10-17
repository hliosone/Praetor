// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {OwnerLib} from "../../src/hook/OwnerLib.sol";
import {HookBase} from "../utils/HookBase.sol";
import {StandingOrdersMock} from "../utils/StandingOrdersMock.sol";
import {IERC7579Account} from "../../src/interfaces/IERC7579.sol";

/// Human approvals (I5, I6), owner actions (T3 and T3-) and recovery (spec 03).
contract MandateHookOwnerTest is HookBase {
    bytes32 internal callH = keccak256("callHash");
    bytes32 internal binding = keccak256("binding");

    function _t2(bytes32 ch, uint64 ttl) internal returns (P.Tier2Approval memory a, bytes32 d) {
        a = P.Tier2Approval(account, ch, ++saltNonce, uint64(block.timestamp) + ttl);
        d = _d(P.hash(a));
    }

    function _link() internal {
        bytes32 linkNonce = keccak256("link");
        bytes memory placeholder = abi.encode(linkNonce, P.SoterApproval(account, 0, binding, 1, 0), bytes(""));
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.LINK_WECHAT), placeholder);
        (P.SoterApproval memory proof, bytes memory sig) = _soterApproval(account, d, binding, 1);
        bytes memory payload = abi.encode(linkNonce, proof, sig);
        hook.applyOwnerAction(a, payload, _passkeyAuth(owner, d), _bankSig(d));
    }

    function _soterReady() internal {
        _attester(attester, true, _pks(bankPk));
        _setPolicy(_linPolicy());
        _link();
    }

    // ---------------------------------------------------------------- Tier2Approval with a passkey

    function test_passkeyApprovalRegisters() public {
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        vm.expectEmit(address(hook));
        emit ApprovalRegistered(account, callH, 0, a.expiresAt);
        hook.registerApproval(a, _passkeyAuth(owner, d));
        (uint64 exp, bool consumed) = hook.approvalOf(account, callH);
        assertEq(exp, a.expiresAt);
        assertFalse(consumed);
        assertTrue(hook.isDigestUsed(d));
    }

    /// I5: single use per digest; one live approval per slot; expiry at most one hour.
    function test_approvalReplayAndSlotRules() public {
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        hook.registerApproval(a, auth);
        vm.expectRevert(OwnerLib.DigestUsed.selector);
        hook.registerApproval(a, auth);
        (P.Tier2Approval memory b, bytes32 db) = _t2(callH, 600);
        P.OwnerAuth memory authB = _passkeyAuth(owner, db);
        vm.expectRevert(OwnerLib.SlotBusy.selector);
        hook.registerApproval(b, authB);
        vm.warp(block.timestamp + 601);
        hook.registerApproval(P.Tier2Approval(account, callH, b.nonce, uint64(block.timestamp + 60)),
            _passkeyAuth(owner, _d(P.hash(P.Tier2Approval(account, callH, b.nonce, uint64(block.timestamp + 60))))));
    }

    function test_approvalExpiryWindow() public {
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 3601);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        vm.expectRevert(OwnerLib.BadExpiry.selector);
        hook.registerApproval(a, auth);
        a.expiresAt = uint64(block.timestamp);
        auth = _passkeyAuth(owner, _d(P.hash(a)));
        vm.expectRevert(OwnerLib.BadExpiry.selector);
        hook.registerApproval(a, auth);
    }

    function test_approvalRefusesWrongPasskeyOrUnknownCredential() public {
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        Passkey memory stranger = _passkey("stranger");
        P.OwnerAuth memory auth = P.OwnerAuth(0, abi.encode(owner.credIdHash, _auth(stranger, abi.encodePacked(d))));
        vm.expectRevert(OwnerLib.BadOwnerAuth.selector);
        hook.registerApproval(a, auth);
        auth = _passkeyAuth(stranger, d);
        vm.expectRevert(OwnerLib.BadOwnerAuth.selector);
        hook.registerApproval(a, auth);
        auth = P.OwnerAuth(7, "");
        vm.expectRevert(OwnerLib.BadOwnerAuth.selector);
        hook.registerApproval(a, auth);
    }

    // ---------------------------------------------------------------- SOTER

    function test_soterApprovalNeedsPolicyBindingAndActiveAttester() public {
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        P.OwnerAuth memory auth = _soterAuth(d, binding, 2);
        vm.expectRevert(OwnerLib.SoterNotEnabled.selector);
        hook.registerApproval(a, auth);
        _soterReady();
        hook.registerApproval(a, auth);
        assertEq(hook.soterCounterOf(binding), 2);
        assertEq(hook.bindingOf(account), binding);
    }

    /// I6: the counter strictly increases per binding; the binding must match the account's.
    function test_soterCounterAndBinding() public {
        _soterReady();
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        P.OwnerAuth memory auth = _soterAuth(d, binding, 1);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, auth); // equal to the link counter
        auth = _soterAuth(d, keccak256("other phone"), 5);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, auth);
        hook.registerApproval(a, _soterAuth(d, binding, 5));
        (P.Tier2Approval memory b, bytes32 db) = _t2(keccak256("call2"), 600);
        auth = _soterAuth(db, binding, 4);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(b, auth);
    }

    function test_soterRefusesWrongDigestAccountExpiryOrInactiveAttester() public {
        _soterReady();
        (P.Tier2Approval memory a, bytes32 d) = _t2(callH, 600);
        P.OwnerAuth memory auth = _soterAuth(keccak256("other digest"), binding, 9);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, auth);
        (P.SoterApproval memory sa, bytes memory sig) = _soterApproval(makeAddr("other account"), d, binding, 9);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, P.OwnerAuth(1, abi.encode(sa, sig)));
        (sa,) = _soterApproval(account, d, binding, 9);
        sa.expiresAt = uint64(block.timestamp + 3601);
        sig = _sign(attesterPk, _d(P.hash(sa)));
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, P.OwnerAuth(1, abi.encode(sa, sig)));
        _attester(attester, false, _pks(regPk));
        auth = _soterAuth(d, binding, 9);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.registerApproval(a, auth);
    }

    // ---------------------------------------------------------------- owner actions

    function test_setPolicyNeedsOwnerAndBank() public {
        P.Policy memory p = _linPolicy();
        bytes memory payload = abi.encode(p);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(0, payload);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        vm.expectRevert(OwnerLib.BankRequired.selector);
        hook.applyOwnerAction(a, payload, auth, _noSigs());
        vm.expectRevert(OwnerLib.BankRequired.selector);
        hook.applyOwnerAction(a, payload, auth, _sigs(d, _pks(regPk)));
        vm.expectEmit(address(hook));
        emit PolicySet(account, P.policyHash(p));
        hook.applyOwnerAction(a, payload, auth, _bankSig(d));
        assertEq(hook.policyHashOf(account), P.policyHash(p));
        P.Policy memory stored = hook.policyOf(account);
        assertEq(stored.bands.length, 3);
        assertEq(stored.payees[2], cafe);
        assertEq(stored.hardCap, 2_000e6);
    }

    function test_setPolicyRefusesInvalidPolicyAndPayloadMismatch() public {
        P.Policy memory p = _linPolicy();
        p.autoCap = p.hardCap + 1;
        bytes memory payload = abi.encode(p);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(0, payload);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(abi.encodeWithSelector(OwnerLib.InvalidPolicy.selector, uint8(P.PolicyRule.AUTO_CAP_GT_HARD_CAP)));
        hook.applyOwnerAction(a, payload, auth, bs);
        bytes memory other = abi.encode(_linPolicy());
        vm.expectRevert(OwnerLib.PayloadMismatch.selector);
        hook.applyOwnerAction(a, other, auth, bs);
    }

    function test_setPolicyWithSoterAndBank() public {
        _soterReady();
        P.Policy memory p = _linPolicy();
        p.autoCap = 100e6;
        bytes memory payload = abi.encode(p);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(0, payload);
        hook.applyOwnerAction(a, payload, _soterAuth(d, binding, 3), _bankSig(d));
        assertEq(hook.policyOf(account).autoCap, 100e6);
    }

    function test_ownerActionDigestSingleUseAndExpiry() public {
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.PAUSE_AGENT), "");
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        hook.applyOwnerAction(a, "", auth, _noSigs());
        vm.expectRevert(OwnerLib.DigestUsed.selector);
        hook.applyOwnerAction(a, "", auth, _noSigs());
        (a, d) = _ownerActionMsg(uint8(P.OwnerActionKind.RESUME_AGENT), "");
        a.expiresAt = uint64(block.timestamp + 3601);
        d = _d(P.hash(a));
        auth = _passkeyAuth(owner, d);
        vm.expectRevert(OwnerLib.BadExpiry.selector);
        hook.applyOwnerAction(a, "", auth, _noSigs());
    }

    function test_pauseAndResumeAreOwnerAlone() public {
        _ownerAction(uint8(P.OwnerActionKind.PAUSE_AGENT), "", false);
        assertTrue(hook.isPaused(account));
        _ownerAction(uint8(P.OwnerActionKind.RESUME_AGENT), "", false);
        assertFalse(hook.isPaused(account));
    }

    /// Q18: linking WeChat needs passkey + SOTER proof + bank, but no policy yet.
    function test_linkWechatWithoutPolicyThenUnlinkAlone() public {
        _attester(attester, true, _pks(bankPk));
        _link();
        assertEq(hook.bindingOf(account), binding);
        assertEq(hook.soterCounterOf(binding), 1);
        _ownerAction(uint8(P.OwnerActionKind.UNLINK_WECHAT), abi.encode(binding), false);
        assertEq(hook.bindingOf(account), bytes32(0));
    }

    function test_linkWechatIsPasskeyOnlyAndChecksTheProof() public {
        _soterReady();
        bytes32 nb = keccak256("new phone");
        bytes32 linkNonce = keccak256("link2");
        bytes memory placeholder = abi.encode(linkNonce, P.SoterApproval(account, 0, nb, 1, 0), bytes(""));
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.LINK_WECHAT), placeholder);
        (P.SoterApproval memory proof, bytes memory sig) = _soterApproval(account, keccak256("wrong"), nb, 1);
        bytes memory payload = abi.encode(linkNonce, proof, sig);
        P.OwnerAuth memory pk = _passkeyAuth(owner, d);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.BadSoter.selector);
        hook.applyOwnerAction(a, payload, pk, bs);
        (proof, sig) = _soterApproval(account, d, nb, 1);
        payload = abi.encode(linkNonce, proof, sig);
        P.OwnerAuth memory so = _soterAuth(d, binding, 7);
        vm.expectRevert(OwnerLib.BadOwnerAuth.selector);
        hook.applyOwnerAction(a, payload, so, bs);
        hook.applyOwnerAction(a, payload, pk, bs);
        assertEq(hook.bindingOf(account), nb);
    }

    function test_setAgentKeyOnlyTheBankVerifiedKey() public {
        _kya(account, agent, 2, 2, "HK", uint64(block.timestamp + 365 days));
        bytes memory wrong = abi.encode(makeAddr("other key"), uint48(block.timestamp + 30 days));
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.SET_AGENT_KEY), wrong);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.applyOwnerAction(a, wrong, auth, bs);
        _ownerAction(uint8(P.OwnerActionKind.SET_AGENT_KEY), abi.encode(agent, uint48(block.timestamp + 30 days)), true);
        (address key,, bool revoked) = agentV.agentOf(account);
        assertEq(key, agent);
        assertFalse(revoked);
        _ownerAction(uint8(P.OwnerActionKind.REVOKE_AGENT_KEY), abi.encode(agent), false);
        (,, revoked) = agentV.agentOf(account);
        assertTrue(revoked);
    }

    function test_setOwnerKeyPasskeyAndBankOnly() public {
        _soterReady();
        Passkey memory second = _passkey("second");
        bytes memory payload = abi.encode(second.credIdHash, second.x, second.y);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.SET_OWNER_KEY), payload);
        P.OwnerAuth memory so = _soterAuth(d, binding, 8);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.BadOwnerAuth.selector);
        hook.applyOwnerAction(a, payload, so, bs);
        hook.applyOwnerAction(a, payload, _passkeyAuth(owner, d), bs);
        assertEq(passkeyV.keyCount(account), 2);
    }

    function test_standingOrderAddNeedsBankCancelAlone() public {
        P.StandingOrder memory o = P.StandingOrder(account, 1, partner, 1_200e6, 30 days, uint64(block.timestamp + 1 days), 1, keccak256("KOWLOON-LETTINGS"));
        bytes memory payload = abi.encode(o);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.ADD_STANDING_ORDER), payload);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        vm.expectRevert(OwnerLib.BankRequired.selector);
        hook.applyOwnerAction(a, payload, auth, _noSigs());
        hook.applyOwnerAction(a, payload, auth, _bankSig(d));
        (address acc, uint32 id,, uint256 amount,,,,) = StandingOrdersMock(standingOrders).last();
        assertEq(acc, account);
        assertEq(id, 1);
        assertEq(amount, 1_200e6);
        _ownerAction(uint8(P.OwnerActionKind.CANCEL_STANDING_ORDER), abi.encode(uint32(1)), false);
        assertEq(StandingOrdersMock(standingOrders).cancelledId(), 1);
    }

    function test_standingOrderForAnotherAccountRefused() public {
        P.StandingOrder memory o = P.StandingOrder(makeAddr("x"), 1, partner, 1, 1, 1, 1, 0);
        bytes memory payload = abi.encode(o);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.ADD_STANDING_ORDER), payload);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.applyOwnerAction(a, payload, auth, bs);
    }

    function test_removePayeeAndMerchantUpdatesThePolicyHash() public {
        _setPolicy(_linPolicy());
        bytes32 before = hook.policyHashOf(account);
        _ownerAction(uint8(P.OwnerActionKind.REMOVE_PAYEE), abi.encode(uint8(0), cafe), false);
        P.Policy memory p = hook.policyOf(account);
        assertEq(p.payees.length, 2);
        assertEq(hook.policyHashOf(account), P.policyHash(p));
        assertTrue(hook.policyHashOf(account) != before);
        _ownerAction(uint8(P.OwnerActionKind.REMOVE_PAYEE), abi.encode(uint8(1), P.merchantKey(partner, keccak256("KOWLOON-LETTINGS"))), false);
        assertEq(hook.policyOf(account).merchants.length, 0);
        bytes memory missing = abi.encode(uint8(0), makeAddr("nobody"));
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.REMOVE_PAYEE), missing);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.applyOwnerAction(a, missing, auth, _noSigs());
    }

    function test_moduleChangeRegistersAModuleApproval() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), ""));
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), inner, true);
        (uint64 exp, bool consumed) = hook.moduleApprovalOf(account, P.callHash(account, account, 0, inner));
        assertEq(exp, block.timestamp + 600);
        assertFalse(consumed);
        bytes memory notModule = abi.encodeWithSelector(bytes4(0xdeadbeef));
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.MODULE_CHANGE), notModule);
        P.OwnerAuth memory auth = _passkeyAuth(owner, d);
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.applyOwnerAction(a, notModule, auth, bs);
    }

    function test_unknownActionKindRefused() public {
        P.OwnerAction memory a = P.OwnerAction(account, 13, keccak256(""), 1, uint64(block.timestamp + 60), 0);
        P.OwnerAuth memory auth = _passkeyAuth(owner, _d(P.hash(a)));
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.applyOwnerAction(a, "", auth, _noSigs());
    }

    // ---------------------------------------------------------------- recovery

    function _recoveryMsg(Passkey memory fresh) internal returns (P.OwnerAction memory a, bytes memory payload, bytes32 d) {
        payload = abi.encode(fresh.credIdHash, fresh.x, fresh.y);
        (a, d) = _ownerActionMsg(uint8(P.OwnerActionKind.SET_OWNER_KEY), payload);
    }

    function test_recoveryScheduledByBankExecutesAfter48h() public {
        _kya(account, agent, 2, 2, "HK", uint64(block.timestamp + 365 days));
        _ownerAction(uint8(P.OwnerActionKind.SET_AGENT_KEY), abi.encode(agent, uint48(block.timestamp + 30 days)), true);
        _attester(attester, true, _pks(bankPk));
        _link();
        (P.Tier2Approval memory t2, bytes32 dt2) = _t2(callH, 600);
        hook.registerApproval(t2, _passkeyAuth(owner, dt2));

        Passkey memory fresh = _passkey("fresh");
        (P.OwnerAction memory a, bytes memory payload, bytes32 d) = _recoveryMsg(fresh);
        vm.expectRevert(OwnerLib.BankRequired.selector);
        hook.scheduleRecovery(a, payload, _sigs(d, _pks(regPk)));
        vm.expectEmit(address(hook));
        emit RecoveryScheduled(account, a.payloadHash, uint64(block.timestamp + 48 hours));
        hook.scheduleRecovery(a, payload, _bankSig(d));
        assertTrue(hook.isRecoveryPending(account));
        vm.expectRevert(OwnerLib.TooEarly.selector);
        hook.executeRecovery(account);
        vm.warp(block.timestamp + 48 hours);
        hook.executeRecovery(account);
        assertEq(passkeyV.keyCount(account), 1);
        (uint256 x,) = passkeyV.ownerKey(account, fresh.credIdHash);
        assertEq(x, fresh.x);
        assertEq(hook.bindingOf(account), bytes32(0));
        (,, bool revoked) = agentV.agentOf(account);
        assertTrue(revoked);
        (uint64 exp,) = hook.approvalOf(account, callH);
        assertEq(exp, 0, "pending approvals voided");
        assertFalse(hook.isRecoveryPending(account));
    }

    function test_ownerCancelsRecoveryAlone() public {
        Passkey memory fresh = _passkey("fresh");
        (P.OwnerAction memory a, bytes memory payload, bytes32 d) = _recoveryMsg(fresh);
        hook.scheduleRecovery(a, payload, _bankSig(d));
        _ownerAction(uint8(P.OwnerActionKind.CANCEL_RECOVERY), abi.encode(a.payloadHash), false);
        assertFalse(hook.isRecoveryPending(account));
        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(OwnerLib.NoRecovery.selector);
        hook.executeRecovery(account);
    }

    function test_recoveryOnlyForSetOwnerKey() public {
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.PAUSE_AGENT), "");
        bytes[] memory bs = _bankSig(d);
        vm.expectRevert(OwnerLib.InvalidPayload.selector);
        hook.scheduleRecovery(a, "", bs);
    }
}
