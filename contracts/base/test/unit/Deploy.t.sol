// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PraetorDeployer} from "../../script/PraetorDeployer.sol";
import {TestDollar} from "../../src/tokens/TestDollar.sol";
import {Modules} from "../../src/hook/HookTypes.sol";

/// The deployment order and wiring of spec 03, without a chain fork.
contract DeployTest is Test, PraetorDeployer {
    function _config(address usdc) internal returns (Config memory c) {
        c = Config({
            deployer: makeAddr("deployer"), bank: makeAddr("bank"), regulator: makeAddr("regulator"), operator: makeAddr("operator"),
            feeder: makeAddr("feeder"), deskOperator: makeAddr("deskOperator"), paymasterSigner: makeAddr("pmSigner"), usdc: usdc,
            domainName: "Praetor-test", soterCounterStrict: true, paymasterDeposit: 0
        });
    }

    function test_deploysAndWiresEverything() public {
        TestDollar pusd = new TestDollar(makeAddr("treasury"));
        Config memory c = _config(address(pusd));
        vm.startPrank(c.deployer);
        Deployment memory d = _deployAll(c);
        vm.stopPrank();
        Modules memory m = d.hook.modules();
        assertEq(m.passkeyValidator, address(d.passkeyValidator));
        assertEq(m.agentKeyValidator, address(d.agentKeyValidator));
        assertEq(m.standingOrders, address(d.standingOrders));
        assertEq(m.usdc, address(pusd));
        assertEq(m.desk, address(d.desk));
        assertEq(m.payoutRail, address(d.payoutRail));
        assertEq(m.oracle, address(d.oracle));
        (address b, address r, address o) = d.hook.members();
        assertEq(b, c.bank);
        assertEq(r, c.regulator);
        assertEq(o, c.operator);
        assertEq(d.hook.domainName(), "Praetor-test");
        assertEq(address(d.passkeyValidator.hook()), address(d.hook));
        assertEq(address(d.agentKeyValidator.hook()), address(d.hook));
        assertEq(address(d.standingOrders.hook()), address(d.hook));
        assertTrue(d.txau.isMinter(address(d.desk)));
        assertTrue(d.txau.isAgent(c.deskOperator));
        assertTrue(d.identityRegistry.isVerified(address(d.desk)));
        assertTrue(d.identityRegistry.isVerified(address(d.payoutRail)));
        assertFalse(d.identityRegistry.isAgent(c.deployer));
        assertTrue(d.identityRegistry.isAgent(c.deskOperator));
        assertEq(d.desk.owner(), c.deskOperator);
        assertEq(d.oracle.owner(), c.deskOperator);
        assertEq(d.oracle.feeder(), c.feeder);
        assertEq(d.paymaster.signer(), c.paymasterSigner);
        assertTrue(d.desk.isMetal(address(d.txag)));
        assertTrue(d.compliance.countryAllowed("HK"));
    }

    function test_testDollarIsLabelledAndOwnerMinted() public {
        TestDollar pusd = new TestDollar(address(this));
        assertEq(pusd.symbol(), "pUSD");
        assertEq(pusd.name(), "Praetor test dollar");
        assertEq(pusd.decimals(), 6);
        pusd.mint(makeAddr("judge"), 100e6);
        vm.prank(makeAddr("judge"));
        vm.expectRevert();
        pusd.mint(makeAddr("judge"), 1);
    }
}
