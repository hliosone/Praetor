// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TreasuryDesk} from "../../src/TreasuryDesk.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {IdentityRegistry} from "../../src/tokens/IdentityRegistry.sol";
import {Compliance} from "../../src/tokens/Compliance.sol";
import {PraetorToken} from "../../src/tokens/PraetorToken.sol";
import {ITreasuryDeskEvents} from "@praetor/protocol/PraetorEvents.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

contract TreasuryDeskTest is Test, ITreasuryDeskEvents {
    MockUSDC internal usdc;
    PriceOracle internal oracle;
    IdentityRegistry internal reg;
    Compliance internal comp;
    PraetorToken internal xau;
    TreasuryDesk internal desk;
    address internal operator = makeAddr("deskOperator");
    address internal feeder = makeAddr("feeder");
    address internal lin = makeAddr("lin");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        oracle = new PriceOracle(address(this), feeder, address(usdc));
        reg = new IdentityRegistry(address(this));
        comp = new Compliance(address(this), address(reg));
        xau = new PraetorToken("Praetor Gold", "tXAU", address(this), address(reg), address(comp));
        desk = new TreasuryDesk(operator, address(usdc), address(oracle), address(reg));
        xau.setMinter(address(desk), true);
        reg.addAgent(address(this));
        comp.setCountryAllowed("HK", true);
        reg.registerIdentity(lin, keccak256("lin"), "HK");
        reg.registerIdentity(address(desk), keccak256("desk"), "HK");
        vm.prank(operator);
        desk.setMetal(address(xau), true);
        vm.prank(feeder);
        oracle.setPrice(address(xau), 2000e8, uint64(block.timestamp), 0);
        usdc.mint(address(desk), 100_000e6);
        usdc.mint(lin, 10_000e6);
        vm.prank(lin);
        usdc.approve(address(desk), type(uint256).max);
        vm.prank(lin);
        xau.approve(address(desk), type(uint256).max);
    }

    function test_buyMetalAtPricePlusSpread() public {
        // 2000 USDC at 2000 * 1.003 per ounce = 0.997008973... oz
        uint256 expected = uint256(2000e6) * 1e20 * 10_000 / (2000e8 * 10_030);
        vm.expectEmit(address(desk));
        emit Swapped(lin, address(usdc), address(xau), 2000e6, expected, 2000e8);
        vm.prank(lin);
        uint256 out = desk.swap(address(usdc), address(xau), 2000e6, expected);
        assertEq(out, expected);
        assertEq(xau.balanceOf(lin), expected);
        assertEq(usdc.balanceOf(lin), 8000e6);
    }

    function test_sellMetalAtPriceMinusSpreadAndBurn() public {
        vm.prank(address(desk));
        xau.mint(lin, 1 ether);
        uint256 supply = xau.totalSupply();
        vm.prank(lin);
        uint256 out = desk.swap(address(xau), address(usdc), 0.5 ether, 0);
        assertEq(out, uint256(0.5 ether) * 2000e8 * 9970 / (1e20 * 10_000));
        assertEq(out, 997e6);
        assertEq(xau.totalSupply(), supply - 0.5 ether, "desk burns what it buys back");
        assertEq(xau.balanceOf(address(desk)), 0);
    }

    function test_minOutEnforced() public {
        vm.prank(lin);
        vm.expectRevert(TreasuryDesk.Slippage.selector);
        desk.swap(address(usdc), address(xau), 2000e6, 1 ether);
    }

    function test_refusesStalePriceUnknownPairsAndUnverifiedSender() public {
        vm.startPrank(lin);
        vm.expectRevert(TreasuryDesk.InvalidPair.selector);
        desk.swap(address(usdc), address(usdc), 1e6, 0);
        vm.expectRevert(TreasuryDesk.InvalidPair.selector);
        desk.swap(address(usdc), makeAddr("unknownMetal"), 1e6, 0);
        vm.expectRevert(TreasuryDesk.InvalidAmount.selector);
        desk.swap(address(usdc), address(xau), 0, 0);
        vm.stopPrank();
        vm.warp(block.timestamp + 4 days + 1);
        vm.prank(lin);
        vm.expectRevert(TreasuryDesk.StalePrice.selector);
        desk.swap(address(usdc), address(xau), 1e6, 0);
        vm.prank(stranger);
        vm.expectRevert(TreasuryDesk.NotVerified.selector);
        desk.swap(address(usdc), address(xau), 1e6, 0);
    }

    function test_operatorControls() public {
        vm.startPrank(operator);
        desk.setSpread(50);
        assertEq(desk.spreadBps(), 50);
        vm.expectRevert(TreasuryDesk.InvalidSpread.selector);
        desk.setSpread(1001);
        desk.withdrawReserve(address(usdc), operator, 1_000e6);
        desk.setPaused(true);
        vm.stopPrank();
        assertEq(usdc.balanceOf(operator), 1_000e6);
        vm.prank(lin);
        vm.expectRevert(TreasuryDesk.DeskPaused.selector);
        desk.swap(address(usdc), address(xau), 1e6, 0);
        vm.prank(stranger);
        vm.expectRevert();
        desk.setSpread(0);
    }

    function test_quoteMatchesSwap() public {
        (uint256 q,) = desk.quote(address(usdc), address(xau), 500e6);
        vm.prank(lin);
        assertEq(desk.swap(address(usdc), address(xau), 500e6, q), q);
    }
}
