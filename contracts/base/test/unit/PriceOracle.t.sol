// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {IPriceOracleEvents} from "@praetor/protocol/PraetorEvents.sol";

contract PriceOracleTest is Test, IPriceOracleEvents {
    PriceOracle internal o;
    address internal feeder = makeAddr("feeder");
    address internal usdc = makeAddr("usdc");
    address internal xau = makeAddr("tXAU");

    function setUp() public {
        vm.warp(1_800_000_000);
        o = new PriceOracle(address(this), feeder, usdc);
    }

    function test_usdcIsPinnedAtOneDollarAndAlwaysFresh() public view {
        (int256 p, uint64 t) = o.getPrice(usdc);
        assertEq(p, 1e8);
        assertEq(t, block.timestamp);
    }

    function test_feederSetsAFirstPriceAndEmits() public {
        vm.expectEmit(address(o));
        emit PriceUpdated(xau, 2650e8, uint64(block.timestamp - 60), 0);
        vm.prank(feeder);
        o.setPrice(xau, 2650e8, uint64(block.timestamp - 60), 0);
        (int256 p, uint64 t) = o.getPrice(xau);
        assertEq(p, 2650e8);
        assertEq(t, block.timestamp - 60);
    }

    function test_unknownTokenHasNoPrice() public {
        (int256 p, uint64 t) = o.getPrice(makeAddr("other"));
        assertEq(p, 0);
        assertEq(t, 0);
    }

    function test_onlyFeeder() public {
        vm.expectRevert(PriceOracle.OnlyFeeder.selector);
        o.setPrice(xau, 1, uint64(block.timestamp), 0);
    }

    function test_rejectsNonPositivePriceFutureAndOlderTimestamps() public {
        vm.startPrank(feeder);
        vm.expectRevert(PriceOracle.InvalidPrice.selector);
        o.setPrice(xau, 0, uint64(block.timestamp), 0);
        vm.expectRevert(PriceOracle.InvalidPrice.selector);
        o.setPrice(xau, -1, uint64(block.timestamp), 0);
        vm.expectRevert(PriceOracle.InvalidPrice.selector);
        o.setPrice(xau, int256(2 ** 128), uint64(block.timestamp), 0); // valueUsd6 refuses >= 2^128 (D17)
        vm.expectRevert(PriceOracle.InvalidTime.selector);
        o.setPrice(xau, 1e8, uint64(block.timestamp + 1), 0);
        o.setPrice(xau, 1e8, uint64(block.timestamp - 10), 0);
        vm.expectRevert(PriceOracle.InvalidTime.selector);
        o.setPrice(xau, 1e8, uint64(block.timestamp - 11), 0);
        vm.expectRevert(PriceOracle.InvalidPrice.selector);
        o.setPrice(usdc, 1e8, uint64(block.timestamp), 0);
        vm.stopPrank();
    }

    /// The feeder is untrusted within its deviation bound (spec 01): at most 25% per update.
    function test_boundsDeviationPerUpdate() public {
        vm.startPrank(feeder);
        o.setPrice(xau, 2000e8, uint64(block.timestamp), 0);
        o.setPrice(xau, 2500e8, uint64(block.timestamp), 1);
        vm.expectRevert(PriceOracle.DeviationTooLarge.selector);
        o.setPrice(xau, 3125e8 + 1, uint64(block.timestamp), 0);
        o.setPrice(xau, 1875e8, uint64(block.timestamp), 0);
        vm.expectRevert(PriceOracle.DeviationTooLarge.selector);
        o.setPrice(xau, 1406e8, uint64(block.timestamp), 0);
        vm.stopPrank();
    }

    function test_maxPriceAgeDefaultsToFourDaysAndOwnerSetsIt() public {
        assertEq(o.maxPriceAge(), 4 days);
        o.setMaxPriceAge(1 days);
        assertEq(o.maxPriceAge(), 1 days);
        vm.prank(feeder);
        vm.expectRevert();
        o.setMaxPriceAge(10 days);
    }

    function test_isFresh() public {
        vm.prank(feeder);
        o.setPrice(xau, 2650e8, uint64(block.timestamp), 0);
        assertTrue(o.isFresh(xau));
        vm.warp(block.timestamp + 4 days + 1);
        assertFalse(o.isFresh(xau));
        assertTrue(o.isFresh(usdc));
        assertFalse(o.isFresh(makeAddr("other")));
    }

    function test_ownerRotatesFeeder() public {
        address next = makeAddr("next");
        o.setFeeder(next);
        vm.prank(next);
        o.setPrice(xau, 1e8, uint64(block.timestamp), 0);
    }

    function testFuzz_deviationRule(int256 first, int256 second) public {
        first = bound(first, 1, int256(uint256(type(uint128).max)));
        second = bound(second, 1, int256(uint256(type(uint128).max)));
        vm.startPrank(feeder);
        o.setPrice(xau, first, uint64(block.timestamp), 0);
        uint256 diff = uint256(second > first ? second - first : first - second);
        if (diff * 10_000 > uint256(first) * 2500) vm.expectRevert(PriceOracle.DeviationTooLarge.selector);
        o.setPrice(xau, second, uint64(block.timestamp), 0);
        vm.stopPrank();
    }
}
