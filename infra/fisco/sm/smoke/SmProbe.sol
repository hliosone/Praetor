// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

/// FISCO BCOS 3.x crypto precompile (the console's Crypto.sol, address 0x100a).
interface ICrypto {
    function sm3(bytes memory data) external view returns (bytes32);
    function keccak256Hash(bytes memory data) external view returns (bytes32);
    function sm2Verify(bytes32 message, bytes memory publicKey, bytes32 r, bytes32 s) external view returns (bool, address);
}

/// Guomi smoke probe (M15): records what an SM chain computes, so SMOKE.md states facts, not assumptions. Not part of
/// Praetor's contracts and never deployed outside the smoke.
contract SmProbe {
    ICrypto internal constant CRYPTO = ICrypto(address(0x100a));

    /// The SHA3 opcode (SM3 on an SM chain).
    function sha3Of(bytes calldata data) external pure returns (bytes32) {
        return keccak256(data);
    }

    function precompileKeccak(bytes calldata data) external view returns (bytes32) {
        return CRYPTO.keccak256Hash(data);
    }

    function precompileSm3(bytes calldata data) external view returns (bytes32) {
        return CRYPTO.sm3(data);
    }

    /// The secp256k1 recovery precompile (0x01), what the main profile's boards rely on.
    function recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) external pure returns (address) {
        return ecrecover(digest, v, r, s);
    }

    function sm2Check(bytes32 message, bytes calldata publicKey, bytes32 r, bytes32 s) external view returns (bool, address) {
        return CRYPTO.sm2Verify(message, publicKey, r, s);
    }
}
