// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @notice ERC-3643 identity registry, own implementation (T-REX is GPL and is not used). Deviation from the
/// standard, documented: no ONCHAINID claims; the bank registers the holder's WeIdentity KYC credential hash and an
/// ISO 3166-1 alpha-2 country. Only hashes and a country code are stored (I19).
contract IdentityRegistry is Ownable {
    struct Identity {
        bytes32 identityHash;
        bytes2 country;
    }

    mapping(address wallet => Identity) internal identities;
    mapping(address agent => bool) public isAgent;

    error OnlyAgent();
    error InvalidIdentity();

    event IdentityRegistered(address indexed wallet, bytes32 identityHash, bytes2 country);
    event IdentityRemoved(address indexed wallet);
    event AgentSet(address indexed agent, bool enabled);

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyAgent() {
        if (!isAgent[msg.sender]) revert OnlyAgent();
        _;
    }

    function addAgent(address agent) external onlyOwner {
        isAgent[agent] = true;
        emit AgentSet(agent, true);
    }

    function removeAgent(address agent) external onlyOwner {
        isAgent[agent] = false;
        emit AgentSet(agent, false);
    }

    function registerIdentity(address wallet, bytes32 identityHash_, bytes2 country) external onlyAgent {
        if (wallet == address(0) || identityHash_ == bytes32(0) || country == bytes2(0)) revert InvalidIdentity();
        identities[wallet] = Identity(identityHash_, country);
        emit IdentityRegistered(wallet, identityHash_, country);
    }

    function deleteIdentity(address wallet) external onlyAgent {
        delete identities[wallet];
        emit IdentityRemoved(wallet);
    }

    function isVerified(address wallet) external view returns (bool) {
        return identities[wallet].identityHash != bytes32(0);
    }

    function identityHash(address wallet) external view returns (bytes32) {
        return identities[wallet].identityHash;
    }

    function investorCountry(address wallet) external view returns (bytes2) {
        return identities[wallet].country;
    }
}
