// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Execution, IERC7579Account, MODE_SINGLE, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";

/// ERC-7579 calldata builders shared by the tests.
library Calls {
    function single(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Account.execute, (MODE_SINGLE, abi.encodePacked(target, value, data)));
    }

    function batch(Execution[] memory xs) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Account.execute, (MODE_BATCH, abi.encode(xs)));
    }

    function withMode(bytes32 mode, bytes memory exec) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Account.execute, (mode, exec));
    }

    function two(Execution memory a, Execution memory b) internal pure returns (Execution[] memory xs) {
        xs = new Execution[](2);
        xs[0] = a;
        xs[1] = b;
    }

    function one(Execution memory a) internal pure returns (Execution[] memory xs) {
        xs = new Execution[](1);
        xs[0] = a;
    }
}
