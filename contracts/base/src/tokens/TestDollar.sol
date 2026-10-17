// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @notice "pUSD", the labelled test dollar of the judges' sandbox (Q31): judges cannot each get faucet USDC.
/// 6 decimals like USDC; only the sandbox treasury mints. Never used on the main deployment.
contract TestDollar is ERC20, Ownable {
    constructor(address owner_) ERC20("Praetor test dollar", "pUSD") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
