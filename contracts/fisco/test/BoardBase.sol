// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {BaseOutbox} from "../src/BaseOutbox.sol";
import {AgentStatus} from "../src/AgentStatus.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {SanctionsList} from "../src/SanctionsList.sol";
import {JurisdictionRules} from "../src/JurisdictionRules.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {AuditLog} from "../src/AuditLog.sol";

/// FISCO consortium under test: block.timestamp in milliseconds like FISCO, members with separate FISCO accounts
/// and Base signer keys, the Base domain of the golden vectors (Praetor-test, 0x...DeaDBeef).
abstract contract BoardBase is Test {
    address internal constant TEST_HOOK = 0x00000000000000000000000000000000DeaDBeef;
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 internal constant NOW_MS = 1_800_000_000_000;

    uint256 internal bankSignerPk = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // vector keys (Q13)
    uint256 internal regSignerPk = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal opSignerPk = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 internal strangerPk = uint256(keccak256("stranger"));
    address internal bankFisco = makeAddr("bank fisco");
    address internal regFisco = makeAddr("regulator fisco");
    address internal opFisco = makeAddr("operator fisco");
    address internal relayer = makeAddr("relayer");
    address internal router = makeAddr("wecross router");

    MemberRegistry internal registry;
    BaseOutbox internal outbox;
    AgentStatus internal status;
    AssetRegistry internal assets;
    SanctionsList internal sanctions;
    JurisdictionRules internal juris;
    AttesterRegistry internal attesters;
    MandateRegistry internal mandates;
    AuditLog internal audit;

    function setUp() public virtual {
        vm.warp(NOW_MS);
        registry = new MemberRegistry();
        MemberRegistry.Member[3] memory m;
        m[0] = MemberRegistry.Member(bankFisco, vm.addr(bankSignerPk), "");
        m[1] = MemberRegistry.Member(regFisco, vm.addr(regSignerPk), "");
        m[2] = MemberRegistry.Member(opFisco, vm.addr(opSignerPk), "");
        registry.bootstrap(m, TEST_HOOK, "Praetor-test", router, relayer);
        outbox = new BaseOutbox(address(registry));
        status = new AgentStatus(address(registry), address(outbox));
        assets = new AssetRegistry(address(registry), address(outbox));
        sanctions = new SanctionsList(address(registry), address(outbox));
        juris = new JurisdictionRules(address(registry), address(outbox));
        attesters = new AttesterRegistry(address(registry), address(outbox));
        mandates = new MandateRegistry(address(registry), address(outbox), address(assets), USDC);
        audit = new AuditLog(address(registry), address(outbox));
        address[7] memory boards = [address(status), address(assets), address(sanctions), address(juris), address(attesters), address(mandates), address(audit)];
        for (uint256 i; i < boards.length; ++i) outbox.addBoard(boards[i]);
        outbox.seal();
    }

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp / 1000 + 3600);
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return P.digest(P.domainSeparator("Praetor-test", TEST_HOOK), structHash);
    }

    function _sig(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }
}
