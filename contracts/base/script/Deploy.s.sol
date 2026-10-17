// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {PraetorDeployer} from "./PraetorDeployer.sol";
import {TestDollar} from "../src/tokens/TestDollar.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast (driven by scripts/deploy/contracts.sh).
/// Env: DEPLOY_ENV (fork | base-sepolia | sandbox), DOMAIN_NAME, DEPLOYER_KEY, BANK/REGULATOR/OPERATOR_BASE_SIGNER_KEY,
/// ORACLE_FEEDER_KEY, DESK_OPERATOR_KEY, PAYMASTER_SIGNER_KEY (the keys of that environment's set, D1),
/// PAYMASTER_DEPOSIT_WEI, FORK_BLOCK (fork only), TREASURY_KEY (sandbox: owner of pUSD). Writes infra/deployments/<env>.json. Members are always the
/// environment's own Base signer keys; anvil test keys never are.
contract Deploy is Script, PraetorDeployer {
    address internal constant CIRCLE_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        string memory env = vm.envString("DEPLOY_ENV");
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        Config memory c = Config({
            deployer: vm.addr(deployerKey),
            bank: vm.addr(vm.envUint("BANK_BASE_SIGNER_KEY")),
            regulator: vm.addr(vm.envUint("REGULATOR_BASE_SIGNER_KEY")),
            operator: vm.addr(vm.envUint("OPERATOR_BASE_SIGNER_KEY")),
            feeder: vm.addr(vm.envUint("ORACLE_FEEDER_KEY")),
            deskOperator: vm.addr(vm.envUint("DESK_OPERATOR_KEY")),
            paymasterSigner: vm.addr(vm.envUint("PAYMASTER_SIGNER_KEY")),
            usdc: CIRCLE_USDC,
            domainName: vm.envString("DOMAIN_NAME"),
            soterCounterStrict: vm.envOr("SOTER_COUNTER_STRICT", true),
            paymasterDeposit: vm.envOr("PAYMASTER_DEPOSIT_WEI", uint256(0))
        });
        vm.startBroadcast(deployerKey);
        // The judges' sandbox runs on our own labelled test dollar (Q31).
        if (keccak256(bytes(env)) == keccak256("sandbox")) c.usdc = address(new TestDollar(vm.addr(vm.envUint("TREASURY_KEY"))));
        uint256 startBlock = block.number;
        Deployment memory d = _deployAll(c);
        vm.stopBroadcast();
        _write(env, c, d, startBlock);
    }

    function _write(string memory env, Config memory c, Deployment memory d, uint256 startBlock) internal {
        string memory k = "deployment";
        vm.serializeString(k, "env", env);
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeString(k, "domainName", c.domainName);
        vm.serializeUint(k, "deployBlock", startBlock);
        if (keccak256(bytes(env)) == keccak256("fork")) vm.serializeUint(k, "forkBlock", vm.envUint("FORK_BLOCK"));
        vm.serializeAddress(k, "entryPoint", ENTRY_POINT);
        vm.serializeAddress(k, "safe7579Adapter", 0x7579EE8307284F293B1927136486880611F20002);
        vm.serializeAddress(k, "safe7579Launchpad", 0x7579011aB74c46090561ea277Ba79D510c6C00ff);
        vm.serializeAddress(k, "usdc", c.usdc);
        vm.serializeAddress(k, "bank", c.bank);
        vm.serializeAddress(k, "regulator", c.regulator);
        vm.serializeAddress(k, "operator", c.operator);
        vm.serializeAddress(k, "noOwner", address(d.noOwner));
        vm.serializeAddress(k, "priceOracle", address(d.oracle));
        vm.serializeAddress(k, "mandateHook", address(d.hook));
        vm.serializeAddress(k, "passkeyValidator", address(d.passkeyValidator));
        vm.serializeAddress(k, "agentKeyValidator", address(d.agentKeyValidator));
        vm.serializeAddress(k, "standingOrders", address(d.standingOrders));
        vm.serializeAddress(k, "identityRegistry", address(d.identityRegistry));
        vm.serializeAddress(k, "compliance", address(d.compliance));
        vm.serializeAddress(k, "txau", address(d.txau));
        vm.serializeAddress(k, "txag", address(d.txag));
        vm.serializeAddress(k, "treasuryDesk", address(d.desk));
        vm.serializeAddress(k, "payoutRail", address(d.payoutRail));
        vm.serializeAddress(k, "refusalLog", address(d.refusalLog));
        vm.serializeAddress(k, "anchor", address(d.anchor));
        vm.serializeAddress(k, "paymaster", address(d.paymaster));
        string memory out = vm.serializeAddress(k, "wecrossInbox", address(d.wecrossInbox));
        // Tests deploy to their own file (DEPLOY_OUT) so the stack's deployment stays the one services use.
        vm.writeJson(out, string.concat(vm.projectRoot(), "/../../infra/deployments/", vm.envOr("DEPLOY_OUT", env), ".json"));
    }
}
