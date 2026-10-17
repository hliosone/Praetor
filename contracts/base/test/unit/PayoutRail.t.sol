// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PayoutRail, IPartnerRegistry} from "../../src/PayoutRail.sol";
import {IPayoutRailEvents} from "@praetor/protocol/PraetorEvents.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

contract PartnerRegistryMock is IPartnerRegistry {
    mapping(address => uint8) public kindOf;
    mapping(address => uint8) public statusOf;

    function set(address a, uint8 kind, uint8 status) external {
        kindOf[a] = kind;
        statusOf[a] = status;
    }

    function assetOf(address a) external view returns (uint8, uint8, uint16, uint64) {
        return (kindOf[a], statusOf[a], 0, 0);
    }
}

contract PayoutRailTest is Test, IPayoutRailEvents {
    MockUSDC internal usdc;
    PartnerRegistryMock internal reg;
    PayoutRail internal rail;
    address internal account = makeAddr("account");
    address internal partner = makeAddr("partner");
    address internal other = makeAddr("otherPartner");
    bytes32 internal mref = keccak256("KOWLOON-LETTINGS");
    bytes32 internal pref = keccak256("payment-1");

    function setUp() public {
        usdc = new MockUSDC();
        reg = new PartnerRegistryMock();
        rail = new PayoutRail(address(reg), address(usdc));
        reg.set(partner, 2, 1); // PAYOUT_PARTNER, ACTIVE
        reg.set(other, 2, 1);
        usdc.mint(account, 5_000e6);
        vm.prank(account);
        usdc.approve(address(rail), type(uint256).max);
    }

    function _pay(uint256 amount) internal returns (uint256 id) {
        vm.prank(account);
        id = rail.pay(partner, amount, 1, mref, pref);
    }

    function test_payPullsFromTheAccountAndEmits() public {
        vm.expectEmit(address(rail));
        emit PayoutRequested(1, account, partner, 1_200e6, 1, mref, pref);
        uint256 id = _pay(1_200e6);
        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(rail)), 1_200e6);
        assertEq(usdc.balanceOf(account), 3_800e6);
    }

    function test_payRefusesDirectRailInactiveOrWrongKindPartner() public {
        vm.startPrank(account);
        vm.expectRevert(PayoutRail.InvalidRail.selector);
        rail.pay(partner, 1e6, 0, mref, pref);
        vm.expectRevert(PayoutRail.InvalidRail.selector);
        rail.pay(partner, 1e6, 3, mref, pref);
        vm.expectRevert(PayoutRail.InvalidAmount.selector);
        rail.pay(partner, 0, 1, mref, pref);
        vm.stopPrank();
        reg.set(partner, 2, 2); // SUSPENDED
        vm.prank(account);
        vm.expectRevert(PayoutRail.PartnerNotActive.selector);
        rail.pay(partner, 1e6, 1, mref, pref);
        reg.set(partner, 1, 1); // DESK kind
        vm.prank(account);
        vm.expectRevert(PayoutRail.PartnerNotActive.selector);
        rail.pay(partner, 1e6, 2, mref, pref);
    }

    function test_partnerWithdrawsThenSettles() public {
        uint256 id = _pay(1_200e6);
        vm.startPrank(partner);
        rail.withdraw(id);
        vm.expectRevert(PayoutRail.InvalidState.selector);
        rail.withdraw(id);
        vm.expectEmit(address(rail));
        emit PayoutSettled(id, keccak256("alipay-tx"));
        rail.settle(id, keccak256("alipay-tx"));
        vm.expectRevert(PayoutRail.InvalidState.selector);
        rail.settle(id, keccak256("again"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(partner), 1_200e6);
    }

    function test_failRefundsTheAccountOnlyBeforeWithdraw() public {
        uint256 id = _pay(1_200e6);
        vm.expectEmit(address(rail));
        emit PayoutFailed(id, "MERCHANT_CLOSED");
        vm.prank(partner);
        rail.fail(id, "MERCHANT_CLOSED");
        assertEq(usdc.balanceOf(account), 5_000e6);
        vm.prank(partner);
        vm.expectRevert(PayoutRail.InvalidState.selector);
        rail.withdraw(id);

        uint256 id2 = _pay(100e6);
        vm.startPrank(partner);
        rail.withdraw(id2);
        vm.expectRevert(PayoutRail.InvalidState.selector);
        rail.fail(id2, "LATE");
        vm.stopPrank();
    }

    function test_onlyThatPartner() public {
        uint256 id = _pay(1e6);
        vm.startPrank(other);
        vm.expectRevert(PayoutRail.OnlyPartner.selector);
        rail.withdraw(id);
        vm.expectRevert(PayoutRail.OnlyPartner.selector);
        rail.settle(id, "x");
        vm.expectRevert(PayoutRail.OnlyPartner.selector);
        rail.fail(id, "x");
        vm.stopPrank();
    }

    function test_payoutView() public {
        uint256 id = _pay(7e6);
        PayoutRail.Payout memory p = rail.payoutOf(id);
        assertEq(p.account, account);
        assertEq(p.partner, partner);
        assertEq(p.amount, 7e6);
        assertEq(p.merchantRef, mref);
        assertEq(uint8(p.state), uint8(PayoutRail.State.REQUESTED));
    }
}
