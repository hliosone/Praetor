// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution, IERC7579Account, MODE_SINGLE, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";
import {MandateHook} from "../../src/MandateHook.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {Calls} from "../utils/Calls.sol";

/// preCheck / postCheck as Safe7579 calls them: msg.sender = account, msgData = calldata || 20-byte caller.
contract MandateHookExecuteTest is LinScenario {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function _pre(address msgSender, bytes memory callData) internal returns (bytes memory) {
        vm.prank(account);
        return hook.preCheck(msgSender, 0, abi.encodePacked(callData, msgSender));
    }

    function _post(bytes memory hookData) internal {
        vm.prank(account);
        hook.postCheck(hookData);
    }

    function _expectRefused(P.Reason r, bytes32 ch) internal {
        vm.expectRevert(abi.encodeWithSelector(IMandateHookEvents.MandateRefused.selector, uint8(r), ch));
    }

    function _ch(Execution memory x) internal view returns (bytes32) {
        return P.callHash(account, x.target, x.value, x.callData);
    }

    // ---------------------------------------------------------------- execute

    function test_allowedPaymentRecordsSpendAndEmitsDecision() public {
        Execution memory x = _transfer(landlord, 150e6);
        vm.expectEmit(address(hook));
        emit Decision(account, _ch(x), 0, 1, address(usdc), 150e6);
        bytes memory hd = _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
        _post(hd);
        (uint256 day, uint256 month, uint256 count, uint256 reb) = hook.spentOf(account);
        assertEq(day, 150e6);
        assertEq(month, 150e6);
        assertEq(count, 1);
        assertEq(reb, 0);
    }

    function test_refusedCallRevertsWithReasonAndCallHash() public {
        Execution memory x = _transfer(makeAddr("stranger"), 150e6);
        _expectRefused(P.Reason.UNKNOWN_PAYEE, _ch(x));
        _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
    }

    function test_approvalIsConsumedOnce() public {
        Execution memory x = _transfer(landlord, 250e6);
        _approveCall(x);
        vm.expectEmit(address(hook));
        emit ApprovalConsumed(account, _ch(x));
        _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
        (, bool consumed) = hook.approvalOf(account, _ch(x));
        assertTrue(consumed);
        _expectRefused(P.Reason.OVER_AUTO_CAP, _ch(x));
        _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
    }

    function test_dailyCountersCarryAcrossExecutionsAndReset() public {
        for (uint256 i; i < 3; ++i) _pre(ENTRYPOINT, Calls.single(address(usdc), 0, _transfer(cafe, 150e6).callData));
        Execution memory x = _transfer(cafe, 100e6);
        _expectRefused(P.Reason.BUDGET_EXCEEDED, _ch(x));
        _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
        vm.warp(block.timestamp + 1 days);
        _heartbeat(180);
        _pre(ENTRYPOINT, Calls.single(x.target, 0, x.callData));
    }

    function test_executionModesOtherThanSingleAndBatchAreHidden() public {
        bytes memory exec = abi.encodePacked(address(usdc), uint256(0), _transfer(landlord, 1e6).callData);
        bytes32[4] memory modes = [bytes32(bytes1(0xff)), bytes32(bytes1(0xfe)), bytes32(uint256(1) << 240), bytes32(uint256(1))];
        for (uint256 i; i < modes.length; ++i) {
            _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
            _pre(ENTRYPOINT, Calls.withMode(modes[i], exec));
        }
    }

    function test_nonCanonicalBatchIsHidden() public {
        Execution[] memory xs = Calls.one(_transfer(landlord, 1e6));
        bytes memory exec = abi.encodePacked(abi.encode(xs), uint256(0));
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        _pre(ENTRYPOINT, Calls.withMode(MODE_BATCH, exec));
    }

    function test_otherSelectorsValueAndShortDataAreHidden() public {
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        _pre(ENTRYPOINT, abi.encodeWithSelector(0xd9ed0e8f, uint256(0)));
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        _pre(ENTRYPOINT, abi.encodeWithSignature("setRegistry(address,address[],uint8)", address(0), new address[](0), 0));
        vm.prank(account);
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        hook.preCheck(ENTRYPOINT, 1, abi.encodePacked(Calls.single(address(usdc), 0, ""), ENTRYPOINT));
        vm.prank(account);
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        hook.preCheck(ENTRYPOINT, 0, hex"e9ae5c53");
    }

    function test_selfCallInsideABatchIsHidden() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), ""));
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), inner, true);
        Execution[] memory xs = Calls.two(_transfer(landlord, 1e6), Execution(account, 0, inner));
        _expectRefused(P.Reason.HIDDEN_CALL, P.callHash(account, account, 0, inner));
        _pre(ENTRYPOINT, Calls.batch(xs));
    }

    function test_notInstalledAccountRefused() public {
        vm.prank(makeAddr("not installed"));
        vm.expectRevert(MandateHook.NotInstalled.selector);
        hook.preCheck(ENTRYPOINT, 0, abi.encodePacked(Calls.single(address(usdc), 0, ""), ENTRYPOINT));
    }

    // ---------------------------------------------------------------- standing-order path (S)

    function test_executorPathOnlyFromStandingOrders() public {
        bytes memory cd = abi.encodeCall(IERC7579Account.executeFromExecutor, (MODE_SINGLE, abi.encodePacked(address(usdc), uint256(0), _transfer(landlord, 1e6).callData)));
        _expectRefused(P.Reason.HIDDEN_CALL, bytes32(0));
        _pre(makeAddr("other executor"), cd);
    }

    function test_executorPathSkipsTheT2GroupButNotT0() public {
        _status(account, 1, _pks(opPk)); // RESTRICTED
        Execution memory x = _transfer(makeAddr("rent payee"), 1_200e6); // unknown payee, over auto cap
        bytes memory cd = abi.encodeCall(IERC7579Account.executeFromExecutor, (MODE_SINGLE, abi.encodePacked(x.target, uint256(0), x.callData)));
        _pre(standingOrders, cd);
        (uint256 day,, uint256 count,) = hook.spentOf(account);
        assertEq(day, 1_200e6, "bank caps include standing orders");
        assertEq(count, 0, "count unchanged");
        _status(account, 2, _pks(regPk));
        _expectRefused(P.Reason.FROZEN, _ch(x));
        _pre(standingOrders, cd);
    }

    function test_executorPathRefusesSwapsAndBankCaps() public {
        _caps(uint8(P.RiskProfile.BALANCED), 5_000e6, 1_000e6, 50_000e6);
        Execution memory x = _transfer(landlord, 1_200e6);
        bytes memory cd = abi.encodeCall(IERC7579Account.executeFromExecutor, (MODE_SINGLE, abi.encodePacked(x.target, uint256(0), x.callData)));
        _expectRefused(P.Reason.BUDGET_EXCEEDED, _ch(x));
        _pre(standingOrders, cd);
        Execution memory sw = _swap(address(usdc), address(xau), 100e6, 0);
        cd = abi.encodeCall(IERC7579Account.executeFromExecutor, (MODE_SINGLE, abi.encodePacked(sw.target, uint256(0), sw.callData)));
        _expectRefused(P.Reason.SELECTOR_NOT_ALLOWED, _ch(sw));
        _pre(standingOrders, cd);
    }

    // ---------------------------------------------------------------- module changes (Q14, I1)

    function test_moduleChangeNeedsAnApproval() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), ""));
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        _pre(ENTRYPOINT, Calls.single(account, 0, inner));
    }

    function test_approvedHookRemovalSetsTheFlagAndClearsTheAccount() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), ""));
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), inner, true);
        vm.prank(account);
        vm.expectRevert(MandateHook.TierThreeRequired.selector);
        hook.onUninstall("");
        bytes memory hd = _pre(ENTRYPOINT, Calls.single(account, 0, inner));
        (, bool consumed) = hook.moduleApprovalOf(account, P.callHash(account, account, 0, inner));
        assertTrue(consumed);
        // Safe7579 skips the inner hook call when the hook itself is removed, then calls onUninstall.
        vm.prank(account);
        hook.onUninstall("");
        assertFalse(hook.isInitialized(account));
        _post(hd);
        vm.prank(account);
        hook.onInstall("");
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        _pre(ENTRYPOINT, Calls.single(account, 0, inner));
    }

    function test_approvedModuleInstallPassesTheInnerCallOnce() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.installModule, (2, makeAddr("executor2"), ""));
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), inner, true);
        _pre(ENTRYPOINT, Calls.single(account, 0, inner));
        vm.prank(account);
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        hook.preCheck(makeAddr("someone else"), 0, abi.encodePacked(inner, makeAddr("someone else")));
        _pre(account, inner);
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        _pre(account, inner);
    }

    function test_innerModuleCallWithoutOuterApprovalRefused() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.installModule, (2, makeAddr("executor2"), ""));
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        _pre(account, inner);
        _expectRefused(P.Reason.TIER3_REQUIRED, P.callHash(account, account, 0, inner));
        _pre(ENTRYPOINT, inner);
    }

    /// D19: owner + bank cannot remove the hook while a regulator freeze is in place (I14).
    function test_frozenBlocksModuleChanges() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), ""));
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), inner, true);
        _status(account, 2, _pks(regPk));
        _expectRefused(P.Reason.FROZEN, bytes32(0));
        _pre(ENTRYPOINT, Calls.single(account, 0, inner));
    }

    function test_moduleChangeWithValueOrOtherSelectorRefused() public {
        _expectRefused(P.Reason.HIDDEN_CALL, P.callHash(account, account, 1, hex"9517e29f"));
        _pre(ENTRYPOINT, Calls.single(account, 1, hex"9517e29f"));
        _expectRefused(P.Reason.HIDDEN_CALL, P.callHash(account, account, 0, hex"deadbeef"));
        _pre(ENTRYPOINT, Calls.single(account, 0, hex"deadbeef"));
    }

    // ---------------------------------------------------------------- postCheck

    function test_postCheckRequiresZeroAllowanceAfterTheApprovePattern() public {
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(rail), 150e6), _pay(150e6, MERCHANT_REF));
        bytes memory hd = _pre(ENTRYPOINT, Calls.batch(xs));
        vm.prank(account);
        usdc.approve(address(rail), 150e6); // as if the pay had not pulled the funds
        vm.prank(account);
        _expectRefused(P.Reason.SELECTOR_NOT_ALLOWED, bytes32(0));
        hook.postCheck(hd);
        vm.prank(account);
        rail.pay(partner, 150e6, 1, MERCHANT_REF, keccak256("p"));
        _post(hd);
    }

    function test_postCheckEnforcesBandsOnRealBalances() public {
        uint256 usdcIn = 200e6;
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(desk), usdcIn), _swap(address(usdc), address(xau), usdcIn, _minOutBuy(usdcIn, XAU_PRICE, 100)));
        bytes memory hd = _pre(ENTRYPOINT, Calls.batch(xs));
        vm.startPrank(account);
        usdc.approve(address(desk), usdcIn);
        desk.swap(address(usdc), address(xau), usdcIn, 0);
        vm.stopPrank();
        _post(hd);
        (,,, uint256 reb) = hook.spentOf(account);
        assertEq(reb, 1);
    }

    function test_postCheckCatchesABreachTheProjectionMissed() public {
        uint256 usdcIn = 200e6;
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(desk), usdcIn), _swap(address(usdc), address(xau), usdcIn, _minOutBuy(usdcIn, XAU_PRICE, 100)));
        bytes memory hd = _pre(ENTRYPOINT, Calls.batch(xs));
        vm.prank(address(desk));
        xau.mint(account, 0.5 ether); // the outcome differs from the projection: tXAU far above its band
        vm.prank(account);
        _expectRefused(P.Reason.BAND_BREACH, bytes32(0));
        hook.postCheck(hd);
    }

    function test_postCheckSkipsTheBandRuleWhenAHumanApprovedTheBreach() public {
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(desk), 500e6), _swap(address(usdc), address(xau), 500e6, _minOutBuy(500e6, XAU_PRICE, 100)));
        _approveCall(xs[1]);
        bytes memory hd = _pre(ENTRYPOINT, Calls.batch(xs));
        vm.startPrank(account);
        usdc.approve(address(desk), 500e6);
        desk.swap(address(usdc), address(xau), 500e6, 0);
        vm.stopPrank();
        _post(hd);
    }

    // ---------------------------------------------------------------- differential (I11: check and preCheck agree)

    function testFuzz_preCheckRevertsIffCheckRefuses(uint8 who, uint256 amount, bool approve) public {
        address[4] memory payees = [landlord, utilities, makeAddr("stranger"), cafe];
        amount = bound(amount, 0, 3_000e6);
        Execution memory x = _transfer(payees[who % 4], amount);
        if (approve) _approveCall(x);
        (uint8 r,) = _check(x);
        vm.prank(account);
        try hook.preCheck(ENTRYPOINT, 0, abi.encodePacked(Calls.single(x.target, 0, x.callData), ENTRYPOINT)) {
            assertEq(r, 0, "preCheck allowed what check refuses");
        } catch (bytes memory err) {
            assertTrue(r != 0, "preCheck refused what check allows");
            assertEq(err, abi.encodeWithSelector(IMandateHookEvents.MandateRefused.selector, r, _ch(x)));
        }
    }
}
