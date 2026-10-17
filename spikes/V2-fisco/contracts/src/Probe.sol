// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// Measures the FISCO EVM facts our contracts depend on: hash function behind keccak256 (SM3 in Guomi
/// mode), timestamp unit, chain id, ecrecover, and event delivery through eth_getLogs.
contract Probe {
    uint256 public x;
    event Stored(uint256 indexed v, address indexed by);

    function k() external pure returns (bytes32) { return keccak256("abc"); }
    function ts() external view returns (uint256) { return block.timestamp; }
    function cid() external view returns (uint256) { return block.chainid; }
    function rec(bytes32 h, uint8 v, bytes32 r, bytes32 s) external pure returns (address) { return ecrecover(h, v, r, s); }

    function store(uint256 v) external {
        x = v;
        emit Stored(v, msg.sender);
    }
}
