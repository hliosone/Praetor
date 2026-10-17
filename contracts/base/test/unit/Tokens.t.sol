// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/tokens/IdentityRegistry.sol";
import {Compliance} from "../../src/tokens/Compliance.sol";
import {PraetorToken} from "../../src/tokens/PraetorToken.sol";

contract TokensTest is Test {
    IdentityRegistry internal reg;
    Compliance internal comp;
    PraetorToken internal xau;
    address internal bank = makeAddr("bankAgent");
    address internal desk = makeAddr("desk");
    address internal lin = makeAddr("lin");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        reg = new IdentityRegistry(address(this));
        comp = new Compliance(address(this), address(reg));
        xau = new PraetorToken("Praetor Gold", "tXAU", address(this), address(reg), address(comp));
        reg.addAgent(bank);
        xau.addAgent(bank);
        xau.setMinter(desk, true);
        comp.setCountryAllowed("HK", true);
        vm.startPrank(bank);
        reg.registerIdentity(lin, keccak256("lin-kyc"), "HK");
        reg.registerIdentity(bob, keccak256("bob-kyc"), "HK");
        reg.registerIdentity(desk, keccak256("desk"), "HK");
        vm.stopPrank();
        vm.prank(desk);
        xau.mint(lin, 10 ether);
    }

    // ---------------------------------------------------------------- IdentityRegistry

    function test_registryOnlyAgentsRegisterAndDelete() public {
        vm.expectRevert(IdentityRegistry.OnlyAgent.selector);
        reg.registerIdentity(stranger, keccak256("x"), "HK");
        vm.prank(bank);
        reg.deleteIdentity(bob);
        assertFalse(reg.isVerified(bob));
        assertTrue(reg.isVerified(lin));
        assertEq(reg.identityHash(lin), keccak256("lin-kyc"));
        assertEq(reg.investorCountry(lin), bytes2("HK"));
    }

    function test_registryRejectsZeroIdentity() public {
        vm.prank(bank);
        vm.expectRevert(IdentityRegistry.InvalidIdentity.selector);
        reg.registerIdentity(stranger, bytes32(0), "HK");
    }

    // ---------------------------------------------------------------- Compliance

    function test_complianceNeedsVerifiedHoldersInAllowedCountries() public {
        assertTrue(comp.canTransfer(lin, bob, 1));
        assertFalse(comp.canTransfer(lin, stranger, 1));
        assertFalse(comp.canTransfer(stranger, lin, 1));
        vm.prank(bank);
        reg.registerIdentity(stranger, keccak256("s"), "CN");
        assertFalse(comp.canTransfer(lin, stranger, 1), "country not allowed");
        comp.setCountryAllowed("CN", true);
        assertTrue(comp.canTransfer(lin, stranger, 1));
    }

    function test_complianceOnlyOwnerSetsCountries() public {
        vm.prank(stranger);
        vm.expectRevert();
        comp.setCountryAllowed("US", true);
    }

    // ---------------------------------------------------------------- token transfers

    function test_tokenHas18DecimalsAndTransfersBetweenVerified() public {
        assertEq(xau.decimals(), 18);
        vm.prank(lin);
        xau.transfer(bob, 1 ether);
        assertEq(xau.balanceOf(bob), 1 ether);
    }

    function test_transferToUnverifiedRefused() public {
        vm.prank(lin);
        vm.expectRevert(PraetorToken.TransferNotCompliant.selector);
        xau.transfer(stranger, 1 ether);
    }

    function test_frozenAddressCannotSendOrReceive() public {
        vm.prank(bank);
        xau.setAddressFrozen(lin, true);
        vm.prank(lin);
        vm.expectRevert(PraetorToken.AddressFrozen.selector);
        xau.transfer(bob, 1);
        vm.prank(bob);
        vm.expectRevert(PraetorToken.AddressFrozen.selector);
        xau.transfer(lin, 0);
    }

    function test_partialFreezeLimitsFreeBalance() public {
        vm.prank(bank);
        xau.freezePartialTokens(lin, 9 ether);
        assertEq(xau.getFrozenTokens(lin), 9 ether);
        vm.startPrank(lin);
        vm.expectRevert(PraetorToken.InsufficientFreeBalance.selector);
        xau.transfer(bob, 2 ether);
        xau.transfer(bob, 1 ether);
        vm.stopPrank();
        vm.prank(bank);
        xau.unfreezePartialTokens(lin, 9 ether);
        assertEq(xau.getFrozenTokens(lin), 0);
    }

    function test_pauseStopsTransfers() public {
        vm.prank(bank);
        xau.pause();
        vm.prank(lin);
        vm.expectRevert(PraetorToken.TokenPaused.selector);
        xau.transfer(bob, 1);
        vm.prank(bank);
        xau.unpause();
        vm.prank(lin);
        xau.transfer(bob, 1);
    }

    function test_transferFromRespectsTheSameRules() public {
        vm.prank(lin);
        xau.approve(desk, 5 ether);
        vm.prank(desk);
        xau.transferFrom(lin, desk, 5 ether);
        assertEq(xau.balanceOf(desk), 5 ether);
        vm.prank(lin);
        xau.approve(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(PraetorToken.TransferNotCompliant.selector);
        xau.transferFrom(lin, stranger, 1 ether);
    }

    // ---------------------------------------------------------------- roles

    function test_minterMintsToVerifiedOnlyAndBurnsItsOwnBalance() public {
        vm.startPrank(desk);
        vm.expectRevert(PraetorToken.TransferNotCompliant.selector);
        xau.mint(stranger, 1);
        xau.mint(desk, 2 ether);
        xau.burn(desk, 1 ether);
        vm.expectRevert(PraetorToken.OnlyAgent.selector);
        xau.burn(lin, 1 ether);
        vm.expectRevert(PraetorToken.OnlyAgent.selector);
        xau.setAddressFrozen(lin, true);
        vm.stopPrank();
        assertEq(xau.balanceOf(desk), 1 ether);
    }

    function test_strangerHasNoRole() public {
        vm.startPrank(stranger);
        vm.expectRevert(PraetorToken.OnlyMinterOrAgent.selector);
        xau.mint(lin, 1);
        vm.expectRevert(PraetorToken.OnlyAgent.selector);
        xau.pause();
        vm.expectRevert(PraetorToken.OnlyAgent.selector);
        xau.forcedTransfer(lin, bob, 1);
        vm.stopPrank();
    }

    /// Known risk (spec 08): the bank's agent key can force-transfer and burn any holder's metal tokens.
    function test_agentForcedTransferBurnAndRecovery() public {
        vm.startPrank(bank);
        xau.setAddressFrozen(lin, true);
        xau.forcedTransfer(lin, bob, 2 ether);
        xau.burn(lin, 1 ether);
        xau.recoveryAddress(lin, bob);
        vm.stopPrank();
        assertEq(xau.balanceOf(lin), 0);
        assertEq(xau.balanceOf(bob), 9 ether);
    }

    function test_forcedTransferUnfreezesPartialTokensWhenNeeded() public {
        vm.startPrank(bank);
        xau.freezePartialTokens(lin, 10 ether);
        xau.forcedTransfer(lin, bob, 4 ether);
        vm.stopPrank();
        assertEq(xau.getFrozenTokens(lin), 6 ether);
    }

    function test_onlyOwnerManagesRoles() public {
        vm.prank(stranger);
        vm.expectRevert();
        xau.addAgent(stranger);
        vm.prank(stranger);
        vm.expectRevert();
        xau.setMinter(stranger, true);
    }
}
