// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {WeCrossProxyEVM} from "../src/vendor/wecross/WeCrossProxyEVM.sol";
import {NoOwner} from "../src/NoOwner.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {MandateHook} from "../src/MandateHook.sol";
import {Modules} from "../src/hook/HookTypes.sol";
import {PasskeyValidator} from "../src/PasskeyValidator.sol";
import {AgentKeyValidator} from "../src/AgentKeyValidator.sol";
import {StandingOrders} from "../src/StandingOrders.sol";
import {IdentityRegistry} from "../src/tokens/IdentityRegistry.sol";
import {Compliance} from "../src/tokens/Compliance.sol";
import {PraetorToken} from "../src/tokens/PraetorToken.sol";
import {TreasuryDesk} from "../src/TreasuryDesk.sol";
import {PayoutRail} from "../src/PayoutRail.sol";
import {RefusalLog} from "../src/RefusalLog.sol";
import {Anchor} from "../src/Anchor.sol";
import {PraetorPaymaster} from "../src/PraetorPaymaster.sol";
import {WeCrossInbox} from "../src/WeCrossInbox.sol";

/// Deployment order of spec 03, shared by script/Deploy.s.sol (broadcast) and the fork tests (prank).
/// The caller must be the deployer for every call (broadcast or startPrank).
abstract contract PraetorDeployer {
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    struct Config {
        address deployer;
        address bank;
        address regulator;
        address operator;
        address feeder;
        address deskOperator;
        address paymasterSigner;
        address usdc;
        string domainName;
        bool soterCounterStrict;
        uint256 paymasterDeposit;
    }

    struct Deployment {
        NoOwner noOwner;
        PriceOracle oracle;
        MandateHook hook;
        PasskeyValidator passkeyValidator;
        AgentKeyValidator agentKeyValidator;
        StandingOrders standingOrders;
        IdentityRegistry identityRegistry;
        Compliance compliance;
        PraetorToken txau;
        PraetorToken txag;
        TreasuryDesk desk;
        PayoutRail payoutRail;
        RefusalLog refusalLog;
        Anchor anchor;
        PraetorPaymaster paymaster;
        WeCrossInbox wecrossInbox;
        WeCrossProxyEVM wecrossProxy;
    }

    function _deployAll(Config memory c) internal returns (Deployment memory d) {
        d.noOwner = new NoOwner();
        d.oracle = new PriceOracle(c.deployer, c.feeder, c.usdc);
        d.hook = new MandateHook(c.bank, c.regulator, c.operator, c.domainName, c.soterCounterStrict);
        d.passkeyValidator = new PasskeyValidator(address(d.hook));
        d.agentKeyValidator = new AgentKeyValidator(address(d.hook));
        d.standingOrders = new StandingOrders(address(d.hook));
        d.identityRegistry = new IdentityRegistry(c.deployer);
        d.compliance = new Compliance(c.deployer, address(d.identityRegistry));
        d.txau = new PraetorToken("Praetor Gold", "tXAU", c.deployer, address(d.identityRegistry), address(d.compliance));
        d.txag = new PraetorToken("Praetor Silver", "tXAG", c.deployer, address(d.identityRegistry), address(d.compliance));
        d.desk = new TreasuryDesk(c.deployer, c.usdc, address(d.oracle), address(d.identityRegistry));
        d.payoutRail = new PayoutRail(address(d.hook), c.usdc);
        d.refusalLog = new RefusalLog(address(d.hook));
        d.anchor = new Anchor(address(d.hook));
        d.paymaster = new PraetorPaymaster(ENTRY_POINT, c.deployer, c.paymasterSigner);
        if (c.paymasterDeposit != 0) d.paymaster.deposit{value: c.paymasterDeposit}();
        d.wecrossInbox = new WeCrossInbox(address(d.hook), address(d.anchor));
        // WeCross reaches Base through its proxy, by resource name (D42).
        d.wecrossProxy = new WeCrossProxyEVM();
        d.wecrossProxy.setPath("inbox", address(d.wecrossInbox));
        _configure(c, d);
        // Last, once, by the deployer (spec 03).
        d.hook.setModules(Modules({
            passkeyValidator: address(d.passkeyValidator),
            agentKeyValidator: address(d.agentKeyValidator),
            standingOrders: address(d.standingOrders),
            usdc: c.usdc,
            desk: address(d.desk),
            payoutRail: address(d.payoutRail),
            oracle: address(d.oracle)
        }));
    }

    /// Roles: the desk mints; the bank's desk-operator key is the token and registry agent and owns the desk and
    /// the oracle settings; desk and payout rail are verified holders (spec 03).
    function _configure(Config memory c, Deployment memory d) internal {
        d.identityRegistry.addAgent(c.deployer);
        d.identityRegistry.registerIdentity(address(d.desk), keccak256("praetor:desk"), "HK");
        d.identityRegistry.registerIdentity(address(d.payoutRail), keccak256("praetor:payout-rail"), "HK");
        d.identityRegistry.removeAgent(c.deployer);
        d.identityRegistry.addAgent(c.deskOperator);
        d.compliance.setCountryAllowed("HK", true);
        d.txau.setMinter(address(d.desk), true);
        d.txag.setMinter(address(d.desk), true);
        d.txau.addAgent(c.deskOperator);
        d.txag.addAgent(c.deskOperator);
        d.desk.setMetal(address(d.txau), true);
        d.desk.setMetal(address(d.txag), true);
        d.desk.transferOwnership(c.deskOperator);
        d.oracle.transferOwnership(c.deskOperator);
        d.compliance.transferOwnership(c.deskOperator);
        d.identityRegistry.transferOwnership(c.deskOperator);
        d.txau.transferOwnership(c.deskOperator);
        d.txag.transferOwnership(c.deskOperator);
    }
}
