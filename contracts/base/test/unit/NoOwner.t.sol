// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NoOwner} from "../../src/NoOwner.sol";

contract NoOwnerTest is Test {
    NoOwner internal o = new NoOwner();

    /// I1, I16: the Safe's only owner can never produce a valid ERC-1271 signature, whatever it is given.
    function testFuzz_neverSigns(bytes32 h, bytes calldata sig, bytes calldata data) public view {
        assertEq(o.isValidSignature(h, sig), bytes4(0xffffffff));
        assertEq(o.isValidSignature(data, sig), bytes4(0xffffffff));
    }
}
