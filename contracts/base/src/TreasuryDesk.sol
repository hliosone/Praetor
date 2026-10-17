// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITreasuryDeskEvents} from "@praetor/protocol/PraetorEvents.sol";
import {PriceOracle} from "./PriceOracle.sol";
import {IdentityRegistry} from "./tokens/IdentityRegistry.sol";

interface IMetalToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

/// @notice Swaps USDC <-> tXAU/tXAG at the oracle price +/- spread (spec 03). The only way the desk moves anyone's
/// tokens is `transferFrom(msg.sender)`. Buying mints metal; selling burns what the desk takes back.
/// Owner = the bank's desk operator: spread, reserves, pause, listed metals.
contract TreasuryDesk is Ownable, ITreasuryDeskEvents {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SPREAD_BPS = 1000;

    address public immutable usdc;
    PriceOracle public immutable oracle;
    IdentityRegistry public immutable identityRegistry;
    uint16 public spreadBps = 30;
    bool public paused;
    mapping(address token => bool) public isMetal;

    error InvalidPair();
    error InvalidAmount();
    error StalePrice();
    error Slippage();
    error NotVerified();
    error DeskPaused();
    error InvalidSpread();

    event SpreadSet(uint16 spreadBps);
    event MetalSet(address indexed token, bool listed);
    event PausedSet(bool paused);

    constructor(address owner_, address usdc_, address oracle_, address registry_) Ownable(owner_) {
        usdc = usdc_;
        oracle = PriceOracle(oracle_);
        identityRegistry = IdentityRegistry(registry_);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        if (paused) revert DeskPaused();
        if (!identityRegistry.isVerified(msg.sender)) revert NotVerified();
        uint256 price8;
        (amountOut, price8) = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn == usdc) {
            IMetalToken(tokenOut).mint(msg.sender, amountOut);
        } else {
            IMetalToken(tokenIn).burn(address(this), amountIn);
            IERC20(usdc).safeTransfer(msg.sender, amountOut);
        }
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, price8);
    }

    /// amountOut at the current oracle price including the spread, and that price.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut, uint256 price8) {
        bool buy = tokenIn == usdc && isMetal[tokenOut];
        bool sell = tokenOut == usdc && isMetal[tokenIn];
        if (!buy && !sell) revert InvalidPair();
        if (amountIn == 0 || amountIn > 2 ** 128) revert InvalidAmount();
        address metal = buy ? tokenOut : tokenIn;
        if (!oracle.isFresh(metal)) revert StalePrice();
        (int256 p,) = oracle.getPrice(metal);
        price8 = uint256(p);
        // USDC has 6 decimals, metals 18, prices 8: 1e20 = 1e18 * 1e8 / 1e6.
        amountOut = buy
            ? amountIn * 1e20 * 10_000 / (price8 * (10_000 + spreadBps))
            : amountIn * price8 * (10_000 - spreadBps) / (1e20 * 10_000);
    }

    function setSpread(uint16 bps) external onlyOwner {
        if (bps > MAX_SPREAD_BPS) revert InvalidSpread();
        spreadBps = bps;
        emit SpreadSet(bps);
    }

    function setMetal(address token, bool listed) external onlyOwner {
        isMetal[token] = listed;
        emit MetalSet(token, listed);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function withdrawReserve(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
