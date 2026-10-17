// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @notice ERC-3643 compliance, own implementation: both sides verified and registered in an allowed country.
contract Compliance is Ownable {
    IdentityRegistry public immutable registry;
    mapping(bytes2 country => bool) public countryAllowed;

    event CountryAllowed(bytes2 indexed country, bool allowed);

    constructor(address owner_, address registry_) Ownable(owner_) {
        registry = IdentityRegistry(registry_);
    }

    function setCountryAllowed(bytes2 country, bool allowed) external onlyOwner {
        countryAllowed[country] = allowed;
        emit CountryAllowed(country, allowed);
    }

    /// `from == 0` is a mint and `to == 0` a burn: only the real holder side is checked.
    function canTransfer(address from, address to, uint256) external view returns (bool) {
        return (from == address(0) || _ok(from)) && (to == address(0) || _ok(to));
    }

    function _ok(address wallet) internal view returns (bool) {
        return registry.isVerified(wallet) && countryAllowed[registry.investorCountry(wallet)];
    }
}
