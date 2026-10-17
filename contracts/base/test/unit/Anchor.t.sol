// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IAnchorEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Anchor} from "../../src/Anchor.sol";
import {ConsortiumLib} from "../../src/hook/ConsortiumLib.sol";
import {HookBase} from "../utils/HookBase.sol";

contract AnchorTest is HookBase, IAnchorEvents {
    Anchor internal anchorC;

    function setUp() public override {
        super.setUp();
        anchorC = new Anchor(address(hook));
    }

    function _msg(uint64 seq) internal view returns (P.AnchorAttestation memory) {
        return P.AnchorAttestation(seq, keccak256(abi.encode("head", seq)), 100 + seq, _deadline());
    }

    function test_twoMembersAnchorInSequence() public {
        P.AnchorAttestation memory a = _msg(1);
        vm.expectEmit(address(anchorC));
        emit Anchored(1, a.head, 101);
        anchorC.anchor(a, _sigs(_d(P.hash(a)), _pks(bankPk, opPk)));
        (uint64 seq, bytes32 head, uint64 fb) = anchorC.latest();
        assertEq(seq, 1);
        assertEq(head, a.head);
        assertEq(fb, 101);
        assertEq(anchorC.headAt(1), a.head);
    }

    function test_oneMemberIsNotEnough() public {
        P.AnchorAttestation memory a = _msg(1);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        anchorC.anchor(a, _sigs(_d(P.hash(a)), _pks(regPk)));
    }

    /// I18: seq must be stored + 1.
    function test_sequenceAndDeadline() public {
        P.AnchorAttestation memory a = _msg(2);
        vm.expectRevert(Anchor.BadSequence.selector);
        anchorC.anchor(a, _sigs(_d(P.hash(a)), _pks(bankPk, opPk)));
        a = _msg(1);
        a.deadline = uint64(block.timestamp - 1);
        vm.expectRevert(Anchor.Expired.selector);
        anchorC.anchor(a, _sigs(_d(P.hash(a)), _pks(bankPk, opPk)));
    }

    function test_nonMemberRefused() public {
        P.AnchorAttestation memory a = _msg(1);
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        anchorC.anchor(a, _sigs(_d(P.hash(a)), _pks(bankPk, strangerPk)));
    }
}
