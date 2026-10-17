// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPayoutRailEvents} from "@praetor/protocol/PraetorEvents.sol";

/// The hook's asset registry, read for the partner's status.
interface IPartnerRegistry {
    function assetOf(address asset) external view returns (uint8 kind, uint8 status, uint16 maxWeightBps, uint64 nonce);
}

/// @notice Escrow for Alipay+ / WeChat Pay payouts through a licensed payout partner (mocked PSP, spec 00).
/// The account pays USDC in (its own `pay`, which the hook checks); only the named partner withdraws, settles or
/// fails (refund) a payout. On-chain: addresses, amounts and hashes only (merchantRef, paymentRef; I19).
contract PayoutRail is IPayoutRailEvents {
    using SafeERC20 for IERC20;

    enum State { NONE, REQUESTED, SETTLED, FAILED }

    struct Payout {
        address account;
        address partner;
        uint256 amount;
        uint8 rail;
        bytes32 merchantRef;
        bytes32 paymentRef;
        bool withdrawn;
        State state;
    }

    uint8 internal constant KIND_PAYOUT_PARTNER = 2;
    uint8 internal constant STATUS_ACTIVE = 1;
    uint8 internal constant RAIL_ALIPAY_PLUS = 1;
    uint8 internal constant RAIL_WECHAT_PAY = 2;

    IPartnerRegistry public immutable registry;
    IERC20 public immutable usdc;
    uint256 public count;
    mapping(uint256 id => Payout) internal payouts;

    error InvalidRail();
    error InvalidAmount();
    error PartnerNotActive();
    error OnlyPartner();
    error InvalidState();

    constructor(address registry_, address usdc_) {
        registry = IPartnerRegistry(registry_);
        usdc = IERC20(usdc_);
    }

    function pay(address partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef) external returns (uint256 id) {
        if (rail != RAIL_ALIPAY_PLUS && rail != RAIL_WECHAT_PAY) revert InvalidRail();
        if (amount == 0) revert InvalidAmount();
        (uint8 kind, uint8 status,,) = registry.assetOf(partner);
        if (kind != KIND_PAYOUT_PARTNER || status != STATUS_ACTIVE) revert PartnerNotActive();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        id = ++count;
        payouts[id] = Payout(msg.sender, partner, amount, rail, merchantRef, paymentRef, false, State.REQUESTED);
        emit PayoutRequested(id, msg.sender, partner, amount, rail, merchantRef, paymentRef);
    }

    function withdraw(uint256 id) external {
        Payout storage p = _own(id);
        if (p.withdrawn || p.state == State.FAILED) revert InvalidState();
        p.withdrawn = true;
        usdc.safeTransfer(p.partner, p.amount);
    }

    function settle(uint256 id, bytes32 settlementRef) external {
        Payout storage p = _own(id);
        if (p.state != State.REQUESTED) revert InvalidState();
        p.state = State.SETTLED;
        emit PayoutSettled(id, settlementRef);
    }

    function fail(uint256 id, bytes32 code) external {
        Payout storage p = _own(id);
        if (p.withdrawn || p.state != State.REQUESTED) revert InvalidState();
        p.state = State.FAILED;
        usdc.safeTransfer(p.account, p.amount);
        emit PayoutFailed(id, code);
    }

    function payoutOf(uint256 id) external view returns (Payout memory) {
        return payouts[id];
    }

    function _own(uint256 id) internal view returns (Payout storage p) {
        p = payouts[id];
        if (p.partner != msg.sender) revert OnlyPartner();
    }
}
