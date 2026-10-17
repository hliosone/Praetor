// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC1271_INVALID} from "./interfaces/IERC7579.sol";

/// @notice The Safe's only native owner. It never signs, so `execTransaction` and Safe7579's owner-signature
/// fallbacks (nonce key 0, unknown validator) always fail, and every execution has to go through the hook (I1, I16).
/// Written for Praetor; Rhinestone's GPL NoSafeOwner is not used.
contract NoOwner {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_INVALID;
    }

    function isValidSignature(bytes calldata, bytes calldata) external pure returns (bytes4) {
        return ERC1271_INVALID;
    }
}
