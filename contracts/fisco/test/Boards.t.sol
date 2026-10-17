// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "../src/Board.sol";
import {BaseOutbox} from "../src/BaseOutbox.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {AuditLog} from "../src/AuditLog.sol";
import {BoardBase} from "./BoardBase.sol";

contract BoardsTest is BoardBase {
    using stdJson for string;

    address internal xau = makeAddr("tXAU");

    function _signAll(Board b, uint256 id, uint256[] memory pks) internal {
        Board.Proposal memory p = b.proposal(id);
        bytes32 d = b.digestOf(p.fields, p.kind);
        for (uint256 i; i < pks.length; ++i) b.sign(id, _sig(pks[i], d));
    }

    function _one(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function _ready(Board b, uint256 id) internal view returns (bool) {
        return b.proposal(id).status == Board.Status.READY;
    }

    // ---------------------------------------------------------------- assets

    function test_assetActivationNeedsTheBankSuspensionAnyone() public {
        vm.prank(regFisco);
        uint256 id = assets.openAsset(xau, 0, 1, 3500, _dl());
        _signAll(assets, id, _two(regSignerPk, opSignerPk));
        assertFalse(_ready(assets, id), "two non-bank signatures cannot activate");
        _signAll(assets, id, _one(bankSignerPk));
        assertTrue(_ready(assets, id));
        assertTrue(assets.isActive(xau));
        vm.prank(opFisco);
        uint256 s = assets.openAsset(xau, 0, 2, 3000, _dl());
        _signAll(assets, s, _one(opSignerPk));
        assertTrue(_ready(assets, s), "suspend and lower: any one member");
        assertEq(assets.list(0, 10).length, 1);
    }

    function test_sanctionsAndJurisdictions() public {
        address bad = makeAddr("sanctioned");
        vm.prank(regFisco);
        uint256 id = sanctions.openSanctions(bad, true, _dl());
        _signAll(sanctions, id, _one(regSignerPk));
        assertTrue(sanctions.isListed(bad));
        vm.prank(bankFisco);
        uint256 d = sanctions.openSanctions(bad, false, _dl());
        _signAll(sanctions, d, _one(bankSignerPk));
        assertFalse(_ready(sanctions, d), "delisting needs two");
        _signAll(sanctions, d, _one(regSignerPk));
        assertFalse(sanctions.isListed(bad));
        vm.prank(regFisco);
        uint256 j = juris.openJurisdiction("CN", true, _dl());
        _signAll(juris, j, _one(regSignerPk));
        assertTrue(juris.isPayoutBlocked("CN"));
    }

    function test_attesterActivationNeedsTheBank() public {
        address at = makeAddr("attester");
        vm.prank(opFisco);
        uint256 id = attesters.openAttester(at, keccak256("m"), true, _dl());
        _signAll(attesters, id, _two(opSignerPk, regSignerPk));
        assertFalse(_ready(attesters, id));
        _signAll(attesters, id, _one(bankSignerPk));
        (, bool active) = attesters.attesterOf(at);
        assertTrue(active);
    }

    // ---------------------------------------------------------------- mandates

    function test_capsAndKyaAreBankOnly() public {
        vm.prank(regFisco);
        vm.expectRevert(Board.OnlyBank.selector);
        mandates.openCaps(2, 5_000e6, 10_000e6, 50_000e6, _dl());
        vm.prank(bankFisco);
        uint256 id = mandates.openCaps(2, 5_000e6, 10_000e6, 50_000e6, _dl());
        _signAll(mandates, id, _one(regSignerPk));
        assertFalse(_ready(mandates, id));
        _signAll(mandates, id, _one(bankSignerPk));
        (uint256 perTx,,) = mandates.capsOf(2);
        assertEq(perTx, 5_000e6);
        P.KYAAttestation memory k;
        (k.account, k.agentKey, k.kycLevel, k.riskProfile, k.jurisdiction, k.validUntil, k.deadline) =
            (makeAddr("account"), makeAddr("agent"), 2, 2, "HK", uint64(block.timestamp / 1000 + 365 days), _dl());
        vm.prank(bankFisco);
        uint256 kid = mandates.openKYA(k);
        _signAll(mandates, kid, _one(bankSignerPk));
        assertEq(mandates.kyaOf(k.account).agentKey, k.agentKey);
        assertEq(mandates.kyaOf(k.account).nonce, 1);
    }

    function _policy() internal view returns (P.Policy memory p) {
        (p.autoCap, p.hardCap, p.dailyBudget, p.monthlyBudget, p.dailyCount, p.bufferUsdc) = (200e6, 2_000e6, 500e6, 3_000e6, 10, 1_000e6);
        p.bands = new P.Band[](2);
        p.bands[0] = P.Band(USDC, 4000, 6500, 8000);
        p.bands[1] = P.Band(xau, 2000, 3500, 3500);
        (p.maxRebalancesPerDay, p.maxTradeUsd, p.maxSlippageBps, p.validUntil) = (1, 1_000e6, 100, uint64(block.timestamp / 1000 + 365 days));
    }

    function _activate(address asset, uint16 maxW) internal {
        vm.prank(bankFisco);
        uint256 id = assets.openAsset(asset, 0, 1, maxW, _dl());
        _signAll(assets, id, _one(bankSignerPk));
    }

    function test_submitPolicyChecksCapsAndAssets() public {
        vm.prank(bankFisco);
        uint256 id = mandates.openCaps(2, 5_000e6, 10_000e6, 50_000e6, _dl());
        _signAll(mandates, id, _one(bankSignerPk));
        P.Policy memory p = _policy();
        vm.startPrank(bankFisco);
        (bool ok, uint8 rule) = mandates.submitPolicy(makeAddr("account"), p, 2);
        assertFalse(ok);
        assertEq(rule, mandates.RULE_ASSET_NOT_ACTIVE());
        vm.stopPrank();
        _activate(USDC, 10_000);
        _activate(xau, 3000);
        vm.prank(bankFisco);
        (, rule) = mandates.submitPolicy(makeAddr("account"), p, 2);
        assertEq(rule, mandates.RULE_OVER_MAX_WEIGHT());
        p.bands[1].maxBps = 3000;
        p.bands[1].targetBps = 3000;
        p.bands[0].targetBps = 7000;
        vm.prank(bankFisco);
        vm.expectEmit(address(mandates));
        emit MandateRegistry.MandateChecked(makeAddr("account"), P.policyHash(p), true, 0);
        mandates.submitPolicy(makeAddr("account"), p, 2);
        p.hardCap = 6_000e6;
        vm.prank(bankFisco);
        (, rule) = mandates.submitPolicy(makeAddr("account"), p, 2);
        assertEq(rule, mandates.RULE_HARD_CAP());
        p.hardCap = 2_000e6;
        p.autoCap = 3_000e6;
        vm.prank(bankFisco);
        (, rule) = mandates.submitPolicy(makeAddr("account"), p, 2);
        assertEq(rule, mandates.RULE_INVALID_POLICY());
    }

    function test_bankRecordsSuccessorsAndOwnerActions() public {
        vm.startPrank(bankFisco);
        vm.expectEmit(address(mandates));
        emit MandateRegistry.SuccessorLinked(makeAddr("a"), keccak256("old"), keccak256("new"));
        mandates.linkSuccessor(makeAddr("a"), keccak256("old"), keccak256("new"));
        mandates.recordOwnerAction(makeAddr("a"), 0, keccak256("p"), keccak256("d"));
        vm.stopPrank();
        vm.expectRevert(Board.OnlyBank.selector);
        mandates.recordOwnerAction(makeAddr("a"), 0, keccak256("p"), keccak256("d"));
    }

    // ---------------------------------------------------------------- audit log

    /// The FISCO chain head matches the golden vector chain (spec 02).
    function test_auditChainMatchesTheVectors() public {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/../../packages/protocol/vectors/audit-chain.json"));
        vm.startPrank(opFisco);
        for (uint256 i; i < 5; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            audit.append(j.readBytes32(string.concat(k, ".entryHash")), 1, makeAddr("account"), bytes32(0), bytes32(0));
            assertEq(audit.head(), j.readBytes32(string.concat(k, ".head")));
        }
        vm.stopPrank();
        (uint64 s, bytes32 h) = audit.latest();
        assertEq(s, 5);
        assertEq(audit.headAt(5), h);
    }

    function test_onlyTheOperatorAppends() public {
        vm.prank(bankFisco);
        vm.expectRevert(AuditLog.OnlyOperator.selector);
        audit.append(keccak256("e"), 1, address(0), 0, 0);
    }

    function test_anchorTakesTheLogHeadAndNeedsTwoMembers() public {
        vm.prank(opFisco);
        audit.append(keccak256("e"), 1, address(0), 0, 0);
        vm.prank(opFisco);
        uint256 id = audit.openAnchor(_dl());
        P.AnchorAttestation memory a = abi.decode(audit.proposal(id).fields, (P.AnchorAttestation));
        assertEq(a.seq, 1);
        assertEq(a.head, audit.head());
        _signAll(audit, id, _one(opSignerPk));
        assertFalse(_ready(audit, id));
        _signAll(audit, id, _one(bankSignerPk));
        assertTrue(_ready(audit, id));
    }

    // ---------------------------------------------------------------- registry and outbox

    function test_registryBootstrapOnceAndChangesNeedTwoMembers() public {
        MemberRegistry.Member[3] memory m;
        vm.expectRevert(MemberRegistry.AlreadyBootstrapped.selector);
        registry.bootstrap(m, address(1), "x", address(0), address(0));
        vm.prank(bankFisco);
        uint256 id = registry.proposeChange(2, abi.encode("Praetor-local"));
        assertEq(registry.domainName(), "Praetor-test");
        vm.prank(bankFisco);
        vm.expectRevert(MemberRegistry.AlreadyApproved.selector);
        registry.approveChange(id);
        vm.prank(regFisco);
        registry.approveChange(id);
        assertEq(registry.domainName(), "Praetor-local");
        vm.expectRevert(MemberRegistry.NotMember.selector);
        registry.proposeChange(1, abi.encode(address(2)));
    }

    function test_outboxOnlyBoardsEnqueueOnlyTransportsMarkFirstWriteWins() public {
        vm.expectRevert(BaseOutbox.OnlyBoard.selector);
        outbox.enqueue(0, 1, "", new bytes[](0));
        vm.expectRevert(BaseOutbox.Sealed.selector);
        outbox.addBoard(makeAddr("late board"));
        vm.prank(regFisco);
        uint256 id = status.openStatus(makeAddr("account"), 2, _dl());
        _signAll(status, id, _one(regSignerPk));
        vm.expectRevert(BaseOutbox.OnlyTransport.selector);
        outbox.markDelivered(0, keccak256("tx"), 0);
        vm.prank(relayer);
        outbox.markDelivered(0, keccak256("tx"), 0);
        vm.prank(router);
        vm.expectRevert(BaseOutbox.AlreadyDelivered.selector);
        outbox.markDelivered(0, keccak256("tx2"), 1);
        (uint256[] memory ids,) = outbox.pending(0, 10);
        assertEq(ids.length, 0);
        assertEq(outbox.message(0).baseTx, keccak256("tx"));
    }
}
