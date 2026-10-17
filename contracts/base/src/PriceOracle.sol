// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IPriceOracleEvents} from "@praetor/protocol/PraetorEvents.sol";

/// @notice USD prices with 8 decimals for tXAU and tXAG, pushed by oracle-feeder from Pyth Hermes (or a demo shock,
/// flagged source = DEMO). USDC is pinned at 1e8. The feeder is untrusted within its deviation bound: at most
/// 25% per update (spec 01, 03). The owner (deployer, then the bank's desk-operator key) sets the max age.
contract PriceOracle is Ownable, IPriceOracleEvents {
    struct Price {
        int256 price8;
        uint64 publishTime;
    }

    int256 public constant USDC_PRICE8 = 1e8;
    uint256 public constant MAX_DEVIATION_BPS = 2500;

    address public immutable usdc;
    address public feeder;
    uint64 public maxPriceAge = 4 days;
    mapping(address token => Price) internal prices;

    error OnlyFeeder();
    error InvalidPrice();
    error InvalidTime();
    error DeviationTooLarge();

    event FeederSet(address feeder);
    event MaxPriceAgeSet(uint64 maxPriceAge);

    constructor(address owner_, address feeder_, address usdc_) Ownable(owner_) {
        feeder = feeder_;
        usdc = usdc_;
    }

    function setPrice(address token, int256 price8, uint64 publishTime, uint8 source) external {
        if (msg.sender != feeder) revert OnlyFeeder();
        if (price8 <= 0 || token == usdc || uint256(price8) >= 2 ** 128) revert InvalidPrice();
        Price memory last = prices[token];
        if (publishTime < last.publishTime || publishTime > block.timestamp) revert InvalidTime();
        if (last.price8 > 0) {
            uint256 diff = uint256(price8 > last.price8 ? price8 - last.price8 : last.price8 - price8);
            if (diff * 10_000 > uint256(last.price8) * MAX_DEVIATION_BPS) revert DeviationTooLarge();
        }
        prices[token] = Price(price8, publishTime);
        emit PriceUpdated(token, price8, publishTime, source);
    }

    function getPrice(address token) public view returns (int256 price8, uint64 publishTime) {
        if (token == usdc) return (USDC_PRICE8, uint64(block.timestamp));
        Price memory p = prices[token];
        return (p.price8, p.publishTime);
    }

    function isFresh(address token) external view returns (bool) {
        (int256 p, uint64 t) = getPrice(token);
        return p > 0 && block.timestamp - t <= maxPriceAge;
    }

    function setMaxPriceAge(uint64 age) external onlyOwner {
        maxPriceAge = age;
        emit MaxPriceAgeSet(age);
    }

    function setFeeder(address feeder_) external onlyOwner {
        feeder = feeder_;
        emit FeederSet(feeder_);
    }
}
