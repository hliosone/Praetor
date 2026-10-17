// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IAnchorEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Ctx} from "./hook/HookTypes.sol";
import {ConsortiumLib} from "./hook/ConsortiumLib.sol";

interface IHookMembers {
    function members() external view returns (address, address, address);
    function domainSeparator() external view returns (bytes32);
}

/// @notice Heads of the consortium's FISCO audit chain, anchored on Base by two members (spec 03, F8).
/// Members and the EIP-712 domain are the hook's; seq must be stored + 1 (I18).
contract Anchor is IAnchorEvents {
    struct Head {
        bytes32 head;
        uint64 fiscoBlock;
    }

    IHookMembers public immutable hook;
    uint64 public seq;
    mapping(uint64 => Head) internal heads;

    error BadSequence();
    error Expired();

    constructor(address hook_) {
        hook = IHookMembers(hook_);
    }

    function anchor(P.AnchorAttestation calldata a, bytes[] calldata sigs) external {
        if (block.timestamp > a.deadline) revert Expired();
        if (a.seq != seq + 1) revert BadSequence();
        (address bank, address regulator, address operator) = hook.members();
        Ctx memory c = Ctx(hook.domainSeparator(), bank, regulator, operator, false);
        (uint256 n,) = ConsortiumLib.countSigners(c, P.digest(c.domainSeparator, P.hash(a)), sigs);
        if (n < 2) revert ConsortiumLib.NotEnoughSigners();
        seq = a.seq;
        heads[a.seq] = Head(a.head, a.fiscoBlock);
        emit Anchored(a.seq, a.head, a.fiscoBlock);
    }

    function latest() external view returns (uint64, bytes32, uint64) {
        Head memory h = heads[seq];
        return (seq, h.head, h.fiscoBlock);
    }

    function headAt(uint64 s) external view returns (bytes32) {
        return heads[s].head;
    }
}
