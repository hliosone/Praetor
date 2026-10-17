// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents, IStandingOrdersEvents, IPayoutRailEvents} from "@praetor/protocol/PraetorEvents.sol";
import {StandingOrders} from "../../src/StandingOrders.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {MockAccount} from "../utils/MockAccount.sol";

contract StandingOrdersTest is LinScenario, IStandingOrdersEvents, IPayoutRailEvents {
    StandingOrders internal so;
    address internal rentPayee = makeAddr("kowloon lettings");

    function _deployStandingOrders() internal override returns (address) {
        so = new StandingOrders(address(hook));
        return address(so);
    }

    function setUp() public override {
        super.setUp();
        vm.etch(account, address(new MockAccount()).code);
        MockAccount(account).init(address(hook), address(so));
        vm.prank(account);
        so.onInstall("");
    }

    function _order(uint32 id, address payee, uint256 amount, uint8 rail_, bytes32 mref) internal view returns (P.StandingOrder memory) {
        return P.StandingOrder(account, id, payee, amount, 30 days, uint64(block.timestamp + 1 days), rail_, mref);
    }

    function _add(P.StandingOrder memory o) internal {
        _ownerAction(uint8(P.OwnerActionKind.ADD_STANDING_ORDER), abi.encode(o), true);
    }

    function test_onlyHookSetsAndCancels() public {
        vm.expectRevert(StandingOrders.OnlyHook.selector);
        so.set(_order(1, rentPayee, 1, 0, 0));
        vm.expectRevert(StandingOrders.OnlyHook.selector);
        so.cancel(account, 1);
    }

    function test_directOrderPaysOncePerPeriodAndAnyoneTriggers() public {
        _add(_order(1, rentPayee, 1_200e6, 0, 0));
        vm.expectRevert(StandingOrders.NotDue.selector);
        so.execute(account, 1);
        vm.warp(block.timestamp + 1 days);
        _heartbeat(180);
        vm.expectEmit(address(so));
        emit StandingOrderExecuted(account, 1, 1_200e6, 0, makeAddr("judge"));
        vm.prank(makeAddr("judge"));
        so.execute(account, 1);
        assertEq(usdc.balanceOf(rentPayee), 1_200e6);
        vm.expectRevert(StandingOrders.NotDue.selector);
        so.execute(account, 1);
    }

    function test_longGapPaysOnlyOnceAndSkipsMissedPeriods() public {
        P.StandingOrder memory o = _order(1, rentPayee, 100e6, 0, 0);
        _add(o);
        vm.warp(o.firstDue + 3 * 30 days + 5);
        so.execute(account, 1);
        (,,,, uint64 nextDue,,,) = so.orders(account, 1);
        assertEq(nextDue, o.firstDue + 4 * 30 days);
        vm.expectRevert(StandingOrders.NotDue.selector);
        so.execute(account, 1);
        assertEq(usdc.balanceOf(rentPayee), 100e6);
    }

    function test_alipayOrderGoesThroughThePayoutRail() public {
        P.StandingOrder memory o = _order(2, partner, 1_200e6, 1, MERCHANT_REF);
        _add(o);
        vm.warp(o.firstDue);
        bytes32 paymentRef = keccak256(abi.encode(account, uint32(2), uint64(0)));
        vm.expectEmit(address(rail));
        emit PayoutRequested(1, account, partner, 1_200e6, 1, MERCHANT_REF, paymentRef);
        so.execute(account, 2);
        assertEq(usdc.balanceOf(address(rail)), 1_200e6);
        assertEq(usdc.allowance(account, address(rail)), 0);
    }

    function test_cancelStopsTheOrder() public {
        P.StandingOrder memory o = _order(1, rentPayee, 100e6, 0, 0);
        _add(o);
        _ownerAction(uint8(P.OwnerActionKind.CANCEL_STANDING_ORDER), abi.encode(uint32(1)), false);
        vm.warp(o.firstDue);
        vm.expectRevert(StandingOrders.NotActive.selector);
        so.execute(account, 1);
    }

    function test_hookStillRefusesFrozenSanctionsJurisdictionPartnerAndCaps() public {
        P.StandingOrder memory o = _order(2, partner, 1_200e6, 1, MERCHANT_REF);
        _add(o);
        vm.warp(o.firstDue);
        _status(account, 2, _pks(regPk));
        vm.expectPartialRevert(IMandateHookEvents.MandateRefused.selector);
        so.execute(account, 2);
        _status(account, 0, _pks(bankPk, regPk));
        _jurisdiction("HK", true, _pks(regPk));
        vm.expectPartialRevert(IMandateHookEvents.MandateRefused.selector);
        so.execute(account, 2);
        _jurisdiction("HK", false, _pks(bankPk, regPk));
        _asset(partner, 2, 2, 0, _pks(opPk));
        vm.expectPartialRevert(IMandateHookEvents.MandateRefused.selector);
        so.execute(account, 2);
        _asset(partner, 2, 1, 0, _pks(bankPk));
        _sanction(partner, true, _pks(regPk));
        vm.expectPartialRevert(IMandateHookEvents.MandateRefused.selector);
        so.execute(account, 2);
        _sanction(partner, false, _pks(bankPk, regPk));
        _caps(uint8(P.RiskProfile.BALANCED), 1_000e6, 10_000e6, 50_000e6);
        vm.expectPartialRevert(IMandateHookEvents.MandateRefused.selector);
        so.execute(account, 2);
        _caps(uint8(P.RiskProfile.BALANCED), 5_000e6, 10_000e6, 50_000e6);
        so.execute(account, 2);
    }

    function test_policyExpiredRefuses() public {
        P.StandingOrder memory o = _order(1, rentPayee, 100e6, 0, 0);
        _add(o);
        vm.warp(block.timestamp + 366 days);
        _kya(account, agent, 2, 2, "HK", uint64(block.timestamp + 365 days));
        vm.expectRevert(abi.encodeWithSelector(IMandateHookEvents.MandateRefused.selector, uint8(P.Reason.SESSION_EXPIRED),
            P.callHash(account, address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, rentPayee, 100e6))));
        so.execute(account, 1);
    }

    function test_setValidatesTheOrder() public {
        vm.startPrank(address(hook));
        vm.expectRevert(StandingOrders.InvalidOrder.selector);
        so.set(_order(1, rentPayee, 0, 0, 0));
        vm.expectRevert(StandingOrders.InvalidOrder.selector);
        so.set(_order(1, address(0), 1, 0, 0));
        vm.expectRevert(StandingOrders.InvalidOrder.selector);
        so.set(_order(1, rentPayee, 1, 3, 0));
        P.StandingOrder memory o = _order(1, rentPayee, 1, 0, 0);
        o.period = 0;
        vm.expectRevert(StandingOrders.InvalidOrder.selector);
        so.set(o);
        vm.stopPrank();
    }

    function test_moduleBasics() public view {
        assertTrue(so.isModuleType(2));
        assertFalse(so.isModuleType(1));
        assertTrue(so.isInitialized(account));
    }
}
