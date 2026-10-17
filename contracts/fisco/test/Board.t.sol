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
        assertEq(msgs[0].enqueuedAt, NOW_MS / 1000, "the relayer watchdog needs the enqueue time (seconds)");
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

    /// Signatures stay attached to their signers when the board re-sorts them (Base checks each one).
    function test_sortedSignaturesStillRecoverToTheirSigners() public {
        vm.prank(regFisco);
        uint256 id = status.openStatus(makeAddr("account"), 0, _dl());
        bytes32 d = status.digestOf(status.proposal(id).fields, 0);
        // Sign in descending address order so the board has to move the second signature in front of the first.
        (uint256 hi, uint256 lo) = vm.addr(regSignerPk) > vm.addr(opSignerPk) ? (regSignerPk, opSignerPk) : (opSignerPk, regSignerPk);
        status.sign(id, _sig(hi, d));
        status.sign(id, _sig(lo, d));
        Board.Proposal memory p = status.proposal(id);
        assertEq(uint8(p.status), uint8(Board.Status.READY));
        for (uint256 i; i < 2; ++i) {
            (uint8 v, bytes32 r, bytes32 s_) = _split(p.sigs[i]);
            assertEq(ecrecover(d, v, r, s_), p.signers[i], "signature i recovers to signer i");
        }
        assertLt(uint160(p.signers[0]), uint160(p.signers[1]));
    }

    function _split(bytes memory sig) internal pure returns (uint8 v, bytes32 r, bytes32 s_) {
        assembly {
            r := mload(add(sig, 32))
            s_ := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
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

contract BoardReissueTest is BoardBase {
    function _freezeReady(address who) internal returns (uint256 id) {
        vm.prank(regFisco);
        id = status.openStatus(who, 2, _dl());
        status.sign(id, _sig(regSignerPk, status.digestOf(status.proposal(id).fields, 0)));
    }

    /// A Ready message that missed its Base deadline is issued again with the same nonce, so the key never sticks.
    function test_reissueAnUndeliveredExpiredMessageWithTheSameNonce() public {
        address who = makeAddr("account");
        uint256 id = _freezeReady(who);
        vm.warp(block.timestamp + 3601 * 1000);
        vm.prank(opFisco);
        uint256 again = status.reissue(id, _dl());
        P.StatusAttestation memory a = abi.decode(status.proposal(again).fields, (P.StatusAttestation));
        assertEq(a.nonce, 1);
        assertEq(a.deadline, _dl());
        assertEq(uint8(status.proposal(id).status), uint8(Board.Status.CLOSED));
        status.sign(again, _sig(regSignerPk, status.digestOf(status.proposal(again).fields, 0)));
        assertEq(uint8(status.proposal(again).status), uint8(Board.Status.READY));
    }

    function test_reissueRefusedWhenDeliveredNotExpiredOrSuperseded() public {
        address who = makeAddr("account");
        uint256 id = _freezeReady(who);
        vm.prank(opFisco);
        vm.expectRevert(Board.NotExpired.selector);
        status.reissue(id, _dl());
        vm.prank(relayer);
        outbox.markDelivered(0, keccak256("tx"), 0);
        vm.warp(block.timestamp + 3601 * 1000);
        vm.prank(opFisco);
        vm.expectRevert(Board.AlreadyDelivered.selector);
        status.reissue(id, _dl());

        address other = makeAddr("other");
        uint256 first = _freezeReady(other);
        vm.prank(bankFisco);
        uint256 second = status.openStatus(other, 0, _dl());
        status.sign(second, _sig(bankSignerPk, status.digestOf(status.proposal(second).fields, 0)));
        status.sign(second, _sig(regSignerPk, status.digestOf(status.proposal(second).fields, 0)));
        vm.warp(block.timestamp + 3601 * 1000);
        vm.prank(opFisco);
        vm.expectRevert(Board.Superseded.selector);
        status.reissue(first, _dl());
        vm.expectRevert(Board.NotMember.selector);
        status.reissue(second, _dl());
    }
}
