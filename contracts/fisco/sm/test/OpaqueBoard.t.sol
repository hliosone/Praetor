// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {MemberRegistry} from "../build/src/MemberRegistry.sol";
import {BaseOutbox} from "../build/src/BaseOutbox.sol";
import {Board} from "../build/src/Board.sol";
import {AgentStatus} from "../build/src/AgentStatus.sol";
import {AssetRegistry} from "../build/src/AssetRegistry.sol";
import {MandateRegistry} from "../build/src/MandateRegistry.sol";
import {AuditLog} from "../build/src/AuditLog.sol";

/// The Guomi profile build (spec 04): boards store member signatures as opaque bytes, attributed to the submitting
/// member's FISCO account under its registered Base signer, because an SM chain cannot compute the Base digest.
/// Everything else (nonces, thresholds, sorting, Ready, outbox) is the main profile's code.
contract OpaqueBoardTest is Test {
    address internal constant HOOK = 0x00000000000000000000000000000000DeaDBeef;
    uint256 internal constant NOW_MS = 1_800_000_000_000;

    uint256 internal bankPk = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // vector keys (Q13)
    uint256 internal regPk = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal opPk = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    address internal bankFisco = makeAddr("bank fisco");
    address internal regFisco = makeAddr("regulator fisco");
    address internal opFisco = makeAddr("operator fisco");

    MemberRegistry internal registry;
    BaseOutbox internal outbox;
    AgentStatus internal status;
    MandateRegistry internal mandates;
    AuditLog internal audit;

    function setUp() public {
        vm.warp(NOW_MS);
        registry = new MemberRegistry();
        MemberRegistry.Member[3] memory m;
        m[0] = MemberRegistry.Member(bankFisco, vm.addr(bankPk), hex"b1");
        m[1] = MemberRegistry.Member(regFisco, vm.addr(regPk), hex"b2");
        m[2] = MemberRegistry.Member(opFisco, vm.addr(opPk), hex"b3");
        registry.bootstrap(m, HOOK, "Praetor-test", makeAddr("router"), makeAddr("relayer"));
        outbox = new BaseOutbox(address(registry));
        status = new AgentStatus(address(registry), address(outbox));
        AssetRegistry assets = new AssetRegistry(address(registry), address(outbox));
        mandates = new MandateRegistry(address(registry), address(outbox), address(assets), makeAddr("usdc"));
        audit = new AuditLog(address(registry), address(outbox));
        outbox.addBoard(address(status));
        outbox.addBoard(address(mandates));
        outbox.addBoard(address(audit));
        outbox.seal();
    }

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp / 1000 + 3600);
    }

    /// The member's real Base signature (what its service submits): the off-chain EIP-712 digest under the Base domain.
    function _sig(uint256 pk, bytes memory fields) internal pure returns (bytes memory) {
        bytes32 d = P.digest(P.domainSeparator("Praetor-test", HOOK), P.hash(abi.decode(fields, (P.StatusAttestation))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _split(bytes memory sig) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    function _open(address by, address account, uint8 st) internal returns (uint256 id, bytes memory fields) {
        vm.prank(by);
        id = status.openStatus(account, st, _dl());
        fields = status.proposal(id).fields;
    }

    function test_memberSignatureIsStoredUnderItsBaseSignerAndEnqueued() public {
        address account = makeAddr("account");
        (uint256 id, bytes memory fields) = _open(regFisco, account, 2);
        bytes memory sig = _sig(regPk, fields);
        vm.prank(regFisco);
        status.sign(id, sig);
        Board.Proposal memory p = status.proposal(id);
        assertEq(uint8(p.status), uint8(Board.Status.READY));
        assertEq(p.signers.length, 1);
        assertEq(p.signers[0], vm.addr(regPk));
        assertEq(p.sigs[0], sig);
        assertEq(status.statusOf(account), 2);
        (, BaseOutbox.Message[] memory msgs) = outbox.pending(0, 10);
        assertEq(msgs.length, 1);
        assertEq(msgs[0].payload, fields);
        assertEq(msgs[0].sigs[0], sig);
    }

    /// Spec 04: no on-chain verification on FISCO in this profile. Base refuses such a message; the member service
    /// checks its own signature before submitting.
    function test_signatureBytesAreNotVerifiedOnFisco() public {
        (uint256 id,) = _open(regFisco, makeAddr("account"), 2);
        bytes memory junk = abi.encodePacked(keccak256("not"), keccak256("a signature"), uint8(27));
        vm.prank(regFisco);
        status.sign(id, junk);
        assertEq(status.proposal(id).sigs[0], junk);
        assertEq(status.proposal(id).signers[0], vm.addr(regPk));
    }

    function test_onlyAMemberFiscoAccountSubmits() public {
        (uint256 id, bytes memory fields) = _open(regFisco, makeAddr("account"), 2);
        bytes memory sig = _sig(regPk, fields);
        vm.expectRevert(Board.NotMember.selector);
        status.sign(id, sig); // a relayer: the main profile accepts it (ecrecover), this one cannot attribute it
        vm.prank(vm.addr(regPk));
        vm.expectRevert(Board.NotMember.selector);
        status.sign(id, sig); // a Base signer key is not a FISCO account
    }

    function test_aMemberSubmitsOnceAnd65BytesOnly() public {
        // Status 0 on a fresh account is not a tightening: 2 signatures needed, so the first leaves it open.
        (uint256 id, bytes memory fields) = _open(bankFisco, makeAddr("account"), 0);
        vm.prank(bankFisco);
        vm.expectRevert(Board.BadSignature.selector);
        status.sign(id, new bytes(64));
        vm.prank(bankFisco);
        status.sign(id, _sig(bankPk, fields));
        vm.prank(bankFisco);
        vm.expectRevert(Board.AlreadySigned.selector);
        status.sign(id, _sig(bankPk, fields));
    }

    function test_looseningNeedsTwoMembersAndKeepsEachSignatureWithItsSigner() public {
        address account = makeAddr("account");
        (uint256 freeze, bytes memory f1) = _open(regFisco, account, 2);
        vm.prank(regFisco);
        status.sign(freeze, _sig(regPk, f1));
        (uint256 id, bytes memory fields) = _open(bankFisco, account, 0);
        // Submit in descending Base signer order so the board has to move the second one in front.
        (address hiFisco, uint256 hiPk, address loFisco, uint256 loPk) =
            vm.addr(bankPk) > vm.addr(opPk) ? (bankFisco, bankPk, opFisco, opPk) : (opFisco, opPk, bankFisco, bankPk);
        vm.prank(hiFisco);
        status.sign(id, _sig(hiPk, fields));
        assertEq(uint8(status.proposal(id).status), uint8(Board.Status.OPEN));
        vm.prank(loFisco);
        status.sign(id, _sig(loPk, fields));
        Board.Proposal memory p = status.proposal(id);
        assertEq(uint8(p.status), uint8(Board.Status.READY));
        assertLt(uint160(p.signers[0]), uint160(p.signers[1]));
        bytes32 d = P.digest(P.domainSeparator("Praetor-test", HOOK), P.hash(abi.decode(fields, (P.StatusAttestation))));
        for (uint256 i; i < 2; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = _split(p.sigs[i]);
            assertEq(ecrecover(d, v, r, s), p.signers[i], "signature i is signer i's");
        }
        assertEq(status.statusOf(account), 0);
    }

    function test_bankOnlyTypesWaitForTheBank() public {
        vm.prank(bankFisco);
        uint256 id = mandates.openCaps(2, 5_000e6, 10_000e6, 50_000e6, _dl());
        vm.prank(opFisco); // a member, but caps need the bank
        mandates.sign(id, new bytes(65));
        assertEq(uint8(mandates.proposal(id).status), uint8(Board.Status.OPEN));
        vm.prank(bankFisco);
        mandates.sign(id, new bytes(65));
        assertEq(uint8(mandates.proposal(id).status), uint8(Board.Status.READY));
    }

    function test_noEip712ComputationOnChain() public {
        (, bytes memory fields) = _open(regFisco, makeAddr("account"), 2);
        vm.expectRevert(Board.DigestOffChain.selector);
        status.digestOf(fields, 0);
        vm.expectRevert(MemberRegistry.DomainOffChain.selector);
        registry.domainSeparator();
        // The Base domain inputs stay readable for the member services.
        assertEq(registry.baseHook(), HOOK);
        assertEq(registry.domainName(), "Praetor-test");
    }

    function test_theAuditChainAndBindingsAreUnchanged() public {
        vm.prank(opFisco);
        audit.append(keccak256("entry"), 1, makeAddr("account"), bytes32(0), bytes32(0));
        (uint64 seq, bytes32 head) = audit.latest();
        assertEq(seq, 1);
        assertEq(head, keccak256(abi.encode(bytes32(0), keccak256("entry"))));
        assertEq(registry.memberOf(1).sm2Binding, hex"b2");
    }
}
