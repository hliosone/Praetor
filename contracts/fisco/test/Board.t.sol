// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "../src/Board.sol";
import {BaseOutbox} from "../src/BaseOutbox.sol";
import {BoardBase} from "./BoardBase.sol";

/// The message-board pattern (spec 04): proposal allocates id and nonce, members sign, threshold -> Ready + outbox.
contract BoardTest is BoardBase {
    using stdJson for string;

    function _openFreeze(address who) internal returns (uint256 id, P.StatusAttestation memory a) {
        vm.prank(regFisco);
        id = status.openStatus(who, 2, _dl());
        a = abi.decode(status.proposal(id).fields, (P.StatusAttestation));
    }

    function test_openAllocatesIdNonceAndFiscoRef() public {
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(makeAddr("account"));
        assertEq(id, 1);
        assertEq(a.nonce, 1);
        assertEq(a.fiscoRef, keccak256(abi.encode(address(status), id)));
        assertEq(a.deadline, _dl());
    }

    function test_oneSignatureTightensAndGoesToTheOutbox() public {
        address account = makeAddr("account");
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(account);
        bytes memory sig = _sig(regSignerPk, _digest(P.hash(a)));
        vm.expectEmit(address(status));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;
        emit Board.Ready(0, id, abi.encode(a), sigs);
        status.sign(id, sig);
        assertEq(uint8(status.proposal(id).status), uint8(Board.Status.READY));
        assertEq(status.statusOf(account), 2);
        (uint256[] memory ids, BaseOutbox.Message[] memory msgs) = outbox.pending(0, 10);
        assertEq(ids.length, 1);
        assertEq(msgs[0].kind, 0);
        assertEq(msgs[0].payload, abi.encode(a));
        assertEq(msgs[0].sigs.length, 1);
    }

    function test_looseningNeedsTwoAndSignaturesAreSortedBySigner() public {
        address account = makeAddr("account");
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(account);
        status.sign(id, _sig(regSignerPk, _digest(P.hash(a))));
        vm.prank(bankFisco);
        uint256 id2 = status.openStatus(account, 0, _dl());
        P.StatusAttestation memory b = abi.decode(status.proposal(id2).fields, (P.StatusAttestation));
        assertEq(b.nonce, 2);
        status.sign(id2, _sig(opSignerPk, _digest(P.hash(b))));
        assertEq(uint8(status.proposal(id2).status), uint8(Board.Status.OPEN));
        status.sign(id2, _sig(bankSignerPk, _digest(P.hash(b))));
        Board.Proposal memory p = status.proposal(id2);
        assertEq(uint8(p.status), uint8(Board.Status.READY));
        assertLt(uint160(p.signers[0]), uint160(p.signers[1]));
        assertEq(status.statusOf(account), 0);
    }

    function test_signatureRules() public {
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(makeAddr("account"));
        bytes32 d = _digest(P.hash(a));
        vm.expectRevert(Board.NotMember.selector);
        status.sign(id, _sig(strangerPk, d));
        vm.expectRevert(Board.BadSignature.selector);
        status.sign(id, hex"0102");
        vm.expectRevert(Board.NotMember.selector);
        status.sign(id, _sig(regSignerPk, keccak256("other digest")));
    }

    function test_duplicateSignerRefused() public {
        vm.prank(bankFisco);
        uint256 id = status.openStatus(makeAddr("account"), 0, _dl());
        bytes memory s = _sig(bankSignerPk, _digest(P.hash(abi.decode(status.proposal(id).fields, (P.StatusAttestation)))));
        status.sign(id, s);
        vm.expectRevert(Board.AlreadySigned.selector);
        status.sign(id, s);
    }

    function test_onlyMembersOpen() public {
        vm.expectRevert(Board.NotMember.selector);
        status.openStatus(makeAddr("account"), 2, _dl());
    }

    function test_oneOpenProposalPerKeyAndExpiredOnesReleaseTheirNonce() public {
        address account = makeAddr("account");
        _openFreeze(account);
        vm.prank(opFisco);
        vm.expectRevert(abi.encodeWithSelector(Board.ProposalOpen.selector, uint256(1)));
        status.openStatus(account, 1, _dl());
        vm.warp(block.timestamp + 3601 * 1000);
        vm.prank(opFisco);
        uint256 id2 = status.openStatus(account, 1, _dl());
        assertEq(uint8(status.proposal(1).status), uint8(Board.Status.CLOSED));
        assertEq(abi.decode(status.proposal(id2).fields, (P.StatusAttestation)).nonce, 1, "released nonce reused");
    }

    function test_signingAfterTheDeadlineFails() public {
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(makeAddr("account"));
        vm.warp(block.timestamp + 3601 * 1000);
        bytes memory s = _sig(regSignerPk, _digest(P.hash(a)));
        vm.expectRevert(Board.Expired.selector);
        status.sign(id, s);
        status.close(id);
        assertEq(uint8(status.proposal(id).status), uint8(Board.Status.CLOSED));
    }

    /// Signature parity with Base: the digest the board verifies is the golden vector's digest.
    function test_digestMatchesTheGoldenVector() public view {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/../../packages/protocol/vectors/status-attestation.json"));
        P.StatusAttestation memory v = abi.decode(j.readBytes(".encoded"), (P.StatusAttestation));
        assertEq(status.digestOf(abi.encode(v), 0), j.readBytes32(".digest"));
    }

    function test_heartbeatEpochOneSignature() public {
        vm.prank(opFisco);
        uint256 id = status.openHeartbeat(uint64(block.timestamp / 1000 + 180), _dl());
        P.HeartbeatAttestation memory h = abi.decode(status.proposal(id).fields, (P.HeartbeatAttestation));
        assertEq(h.epoch, 1);
        status.sign(id, _sig(opSignerPk, _digest(P.hash(h))));
        assertEq(uint8(status.proposal(id).status), uint8(Board.Status.READY));
        vm.prank(opFisco);
        uint256 id2 = status.openHeartbeat(uint64(block.timestamp / 1000 + 180), _dl());
        assertEq(abi.decode(status.proposal(id2).fields, (P.HeartbeatAttestation)).epoch, 2);
    }

    /// FISCO stamps blocks in milliseconds; boards convert to the seconds attestations carry.
    function test_chainTimeIsInSeconds() public view {
        assertEq(status.chainTimeSeconds(), NOW_MS / 1000);
    }

    function test_globalStatus() public {
        vm.prank(regFisco);
        uint256 id = status.openStatus(address(0), 2, _dl());
        P.StatusAttestation memory a = abi.decode(status.proposal(id).fields, (P.StatusAttestation));
        status.sign(id, _sig(regSignerPk, _digest(P.hash(a))));
        assertEq(status.statusOf(address(0)), 2);
    }
}
