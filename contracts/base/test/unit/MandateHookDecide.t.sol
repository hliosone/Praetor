// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Execution} from "../../src/interfaces/IERC7579.sol";
import {MandateHook} from "../../src/MandateHook.sol";
import {PayoutRail} from "../../src/PayoutRail.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {Calls} from "../utils/Calls.sol";

/// The decision order of spec 03, rule by rule and each rule against its neighbour (the earlier reason wins),
/// through check(), which shares the evaluator with preCheck.
contract MandateHookDecideTest is LinScenario {
    uint8 constant T0 = 0;
    uint8 constant T1 = 1;
    uint8 constant T2 = 2;

    function _expect(Execution memory x, P.Reason reason, uint8 tier) internal view {
        (uint8 r, uint8 t) = _check(x);
        assertEq(r, uint8(reason), "reason");
        assertEq(t, tier, "tier");
    }

    function _policyWith(function (P.Policy memory) internal pure mut) internal {
        P.Policy memory p = _linPolicy();
        mut(p);
        _setPolicy(p);
    }

    // ---------------------------------------------------------------- baseline and rules 1 to 5

    function test_baselinePaymentIsAutonomous() public view {
        _expect(_transfer(landlord, 150e6), P.Reason.OK, T1);
    }

    function test_rule1_frozenWinsOverEverything() public {
        _status(account, 2, _pks(regPk));
        _expect(_transfer(makeAddr("unknown"), 0), P.Reason.FROZEN, T0);
        _status(account, 0, _pks(bankPk, regPk));
        _status(address(0), 2, _pks(opPk));
        _expect(_transfer(landlord, 150e6), P.Reason.FROZEN, T0);
    }

    function test_rule2_noPolicy() public {
        address fresh = makeAddr("fresh");
        (uint8 r,,) = hook.check(fresh, address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1e6));
        assertEq(r, _r(P.Reason.NO_POLICY));
        _status(fresh, 2, _pks(regPk));
        (r,,) = hook.check(fresh, address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1e6));
        assertEq(r, _r(P.Reason.FROZEN), "neighbour: FROZEN before NO_POLICY");
    }

    function test_rule3_kyaRevokedOrExpired() public {
        _kya(account, agent, 0, 2, "HK", uint64(block.timestamp + 365 days));
        _expect(_transfer(landlord, 150e6), P.Reason.KYA_INVALID, T0);
        _kya(account, agent, 2, 2, "HK", uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2);
        _expect(_transfer(landlord, 150e6), P.Reason.KYA_INVALID, T0);
    }

    function test_rule4_sessionExpired() public {
        _policyWith(_shortPolicy);
        vm.warp(block.timestamp + 11 days);
        _expect(_transfer(landlord, 150e6), P.Reason.SESSION_EXPIRED, T0);
        _kya(account, agent, 0, 2, "HK", uint64(block.timestamp + 365 days));
        _expect(_transfer(landlord, 150e6), P.Reason.KYA_INVALID, T0); // neighbour
    }

    function _shortPolicy(P.Policy memory p) internal pure {
        p.validUntil = uint64(1_800_000_000 + 10 days);
    }

    function test_rule5_hiddenCalls() public {
        Execution memory x = _transfer(landlord, 150e6);
        x.value = 1;
        _expect(x, P.Reason.HIDDEN_CALL, T0);
        _expect(Execution(account, 0, ""), P.Reason.HIDDEN_CALL, T0);
        _expect(Execution(account, 0, abi.encodeWithSelector(0x9517e29f, uint256(4), address(hook), "")), P.Reason.HIDDEN_CALL, T0);
    }

    // ---------------------------------------------------------------- classification (rule 6, I2, Q17)

    function test_unknownTargetRefused() public {
        _expect(Execution(makeAddr("random"), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1)), P.Reason.TARGET_NOT_ALLOWED, T0);
        _expect(Execution(address(oracle), 0, hex"12345678"), P.Reason.TARGET_NOT_ALLOWED, T0);
    }

    function test_usdcSelectorsOutsideThePatternRefused() public {
        address u = address(usdc);
        bytes[] memory ds = new bytes[](8);
        ds[0] = abi.encodeWithSignature("transferFrom(address,address,uint256)", account, landlord, 1);
        ds[1] = abi.encodeWithSignature("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", account, landlord, 1, 1, 27, 0, 0);
        ds[2] = abi.encodeWithSignature("permit(address,address,uint256,uint256,bytes)", account, landlord, 1, 1, "");
        ds[3] = abi.encodeWithSignature("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)", account, landlord, 1, 0, 1, 0, "");
        ds[4] = abi.encodeWithSignature("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)", account, landlord, 1, 0, 1, 0, 27, 0, 0);
        ds[5] = abi.encodeWithSignature("receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)", account, landlord, 1, 0, 1, 0, "");
        ds[6] = abi.encodeWithSignature("increaseAllowance(address,uint256)", landlord, 1);
        ds[7] = hex"a9";
        for (uint256 i; i < ds.length; ++i) _expect(Execution(u, 0, ds[i]), P.Reason.SELECTOR_NOT_ALLOWED, T0);
    }

    function test_nonCanonicalTransferEncodingsRefused() public {
        bytes memory extra = abi.encodePacked(abi.encodeWithSelector(0xa9059cbb, landlord, 150e6), uint256(0));
        _expect(Execution(address(usdc), 0, extra), P.Reason.SELECTOR_NOT_ALLOWED, T0);
        bytes memory dirty = abi.encodeWithSelector(0xa9059cbb, uint256(uint160(landlord)) | (1 << 200), 150e6);
        _expect(Execution(address(usdc), 0, dirty), P.Reason.SELECTOR_NOT_ALLOWED, T0);
        bytes memory short = abi.encodeWithSelector(0xa9059cbb, landlord);
        _expect(Execution(address(usdc), 0, short), P.Reason.SELECTOR_NOT_ALLOWED, T0);
    }

    function test_metalTransfersAndOtherTokenSelectorsRefused() public {
        _expect(Execution(address(xau), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1)), P.Reason.SELECTOR_NOT_ALLOWED, T0);
        _expect(Execution(address(desk), 0, abi.encodeWithSignature("setSpread(uint16)", 0)), P.Reason.SELECTOR_NOT_ALLOWED, T0);
        _expect(Execution(address(rail), 0, abi.encodeWithSignature("withdraw(uint256)", 1)), P.Reason.SELECTOR_NOT_ALLOWED, T0);
    }

    // ---------------------------------------------------------------- A: payments

    function test_A1_invalidAmount() public {
        _expect(_transfer(landlord, 0), P.Reason.INVALID_AMOUNT, T0);
        _expect(_transfer(landlord, 2 ** 128 + 1), P.Reason.INVALID_AMOUNT, T0);
        _expect(_transfer(landlord, type(uint256).max), P.Reason.INVALID_AMOUNT, T0);
    }

    function test_A2_sanctionedPayee() public {
        _sanction(landlord, true, _pks(regPk));
        _expect(_transfer(landlord, 150e6), P.Reason.SANCTIONED, T0);
        _expect(_transfer(landlord, 0), P.Reason.INVALID_AMOUNT, T0); // neighbour
    }

    function test_A5_overHardCapPolicyOrBank() public {
        _expect(_transfer(landlord, 2_000e6 + 1), P.Reason.OVER_HARD_CAP, T0);
        _caps(uint8(P.RiskProfile.BALANCED), 1_000e6, 10_000e6, 50_000e6);
        _expect(_transfer(landlord, 1_500e6), P.Reason.OVER_HARD_CAP, T0);
        _sanction(landlord, true, _pks(regPk));
        _expect(_transfer(landlord, 1_500e6), P.Reason.SANCTIONED, T0); // neighbour
    }

    /// I8: a human approval never lifts a bank cap.
    function test_A6_bankDailyCapIsT0EvenWithApproval() public {
        _caps(uint8(P.RiskProfile.BALANCED), 5_000e6, 1_000e6, 50_000e6);
        Execution memory x = _transfer(landlord, 1_500e6);
        _expect(x, P.Reason.BUDGET_EXCEEDED, T0);
        _approveCall(x);
        _expect(x, P.Reason.BUDGET_EXCEEDED, T0);
        _caps(uint8(P.RiskProfile.BALANCED), 5_000e6, 10_000e6, 1_000e6);
        _expect(x, P.Reason.BUDGET_EXCEEDED, T0);
    }

    function test_A6_missingCapsDenyByDefault() public {
        _kya(account, agent, 2, uint8(P.RiskProfile.GROWTH), "HK", uint64(block.timestamp + 365 days));
        _expect(_transfer(landlord, 1e6), P.Reason.OVER_HARD_CAP, T0);
    }

    function test_A7_restrictedPausedOrRecoveryPending() public {
        _status(account, 1, _pks(opPk));
        _expect(_transfer(landlord, 150e6), P.Reason.RESTRICTED, T2);
        _expect(_transfer(landlord, 2_001e6), P.Reason.OVER_HARD_CAP, T0); // neighbour: T0 group first
        _status(account, 0, _pks(bankPk, opPk));
        _ownerAction(uint8(P.OwnerActionKind.PAUSE_AGENT), "", false);
        _expect(_transfer(landlord, 150e6), P.Reason.RESTRICTED, T2);
        _ownerAction(uint8(P.OwnerActionKind.RESUME_AGENT), "", false);
        Passkey memory fresh = _passkey("fresh");
        bytes memory payload = abi.encode(fresh.credIdHash, fresh.x, fresh.y);
        (P.OwnerAction memory a, bytes32 d) = _ownerActionMsg(uint8(P.OwnerActionKind.SET_OWNER_KEY), payload);
        hook.scheduleRecovery(a, payload, _bankSig(d));
        _expect(_transfer(landlord, 150e6), P.Reason.RESTRICTED, T2);
    }

    function test_A8_staleHeartbeat() public {
        vm.warp(block.timestamp + 181);
        _expect(_transfer(landlord, 150e6), P.Reason.STALE_STATUS, T2);
        _status(account, 1, _pks(opPk));
        _expect(_transfer(landlord, 150e6), P.Reason.RESTRICTED, T2); // neighbour
    }

    function test_A9_unknownPayee() public {
        _expect(_transfer(makeAddr("stranger"), 150e6), P.Reason.UNKNOWN_PAYEE, T2);
        vm.warp(block.timestamp + 181);
        _expect(_transfer(makeAddr("stranger"), 150e6), P.Reason.STALE_STATUS, T2); // neighbour
    }

    function test_A10_overAutoCap() public {
        _expect(_transfer(landlord, 250e6), P.Reason.OVER_AUTO_CAP, T2);
        _expect(_transfer(makeAddr("stranger"), 250e6), P.Reason.UNKNOWN_PAYEE, T2); // neighbour
    }

    function test_A11_userBudgetsCumulativeInABatch() public {
        Execution[] memory xs = new Execution[](3);
        xs[0] = _transfer(landlord, 200e6);
        xs[1] = _transfer(utilities, 200e6);
        xs[2] = _transfer(cafe, 150e6);
        (uint8[] memory r, uint8[] memory t) = _checkBatch(xs);
        assertEq(r[0], 0);
        assertEq(r[1], 0);
        assertEq(r[2], _r(P.Reason.BUDGET_EXCEEDED));
        assertEq(t[2], T2);
    }

    function test_A11_monthlyBudget() public {
        _policyWith(_lowMonthly);
        _expect(_transfer(landlord, 150e6), P.Reason.BUDGET_EXCEEDED, T2);
        _expect(_transfer(landlord, 250e6), P.Reason.OVER_AUTO_CAP, T2); // neighbour
    }

    function _lowMonthly(P.Policy memory p) internal pure {
        p.dailyBudget = 100e6;
        p.monthlyBudget = 100e6;
    }

    function test_A12_dailyCount() public {
        _policyWith(_oneAPay);
        Execution[] memory xs = Calls.two(_transfer(landlord, 10e6), _transfer(cafe, 10e6));
        (uint8[] memory r,) = _checkBatch(xs);
        assertEq(r[0], 0);
        assertEq(r[1], _r(P.Reason.COUNT_EXCEEDED));
    }

    function _oneAPay(P.Policy memory p) internal pure {
        p.dailyCount = 1;
    }

    function test_A13_buffer() public {
        _policyWith(_bigBuffer);
        _expect(_transfer(landlord, 150e6), P.Reason.BUFFER_BREACH, T2);
        _expect(_transfer(landlord, 250e6), P.Reason.OVER_AUTO_CAP, T2); // neighbour
    }

    function _bigBuffer(P.Policy memory p) internal pure {
        p.bufferUsdc = 5_200e6;
    }

    function test_T2ApprovalLiftsAndIsBoundToTheCall() public {
        Execution memory x = _transfer(landlord, 250e6);
        _approveCall(_transfer(landlord, 251e6));
        _expect(x, P.Reason.OVER_AUTO_CAP, T2);
        _approveCall(x);
        _expect(x, P.Reason.OK, T2);
        _expect(_transfer(makeAddr("stranger"), 250e6), P.Reason.UNKNOWN_PAYEE, T2);
    }

    function test_oneApprovalCoversOneCallInABatch() public {
        Execution memory x = _transfer(landlord, 250e6);
        _approveCall(x);
        (uint8[] memory r, uint8[] memory t) = _checkBatch(Calls.two(x, x));
        assertEq(r[0], 0);
        assertEq(t[0], T2);
        assertEq(r[1], _r(P.Reason.OVER_AUTO_CAP));
    }

    function test_approvalNeverLiftsFrozen() public {
        Execution memory x = _transfer(landlord, 250e6);
        _approveCall(x);
        _status(account, 2, _pks(regPk));
        _expect(x, P.Reason.FROZEN, T0);
    }

    // ---------------------------------------------------------------- D: payouts and B: approve pattern

    function test_payoutBelowAutoCapWithItsApprove() public view {
        (uint8[] memory r, uint8[] memory t) = _checkBatch(Calls.two(_approve(address(usdc), address(rail), 150e6), _pay(150e6, MERCHANT_REF)));
        assertEq(r[0], 0);
        assertEq(r[1], 0);
        assertEq(t[0], T1);
        assertEq(t[1], T1);
    }

    function test_rentPayoutNeedsAHumanThenPasses() public {
        Execution memory pay = _pay(1_200e6, MERCHANT_REF);
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(rail), 1_200e6), pay);
        (uint8[] memory r, uint8[] memory t) = _checkBatch(xs);
        assertEq(r[1], _r(P.Reason.OVER_AUTO_CAP));
        assertEq(r[0], r[1], "approve inherits the decision of its pair");
        assertEq(t[0], T2);
        _approveCall(pay);
        (r, t) = _checkBatch(xs);
        assertEq(r[0], 0);
        assertEq(r[1], 0);
        assertEq(t[1], T2);
    }

    function test_D3_partnerNotActive() public {
        _asset(partner, 2, 2, 0, _pks(regPk));
        _expect(_pay(150e6, MERCHANT_REF), P.Reason.COUNTERPARTY_NOT_APPROVED, T0);
        _sanction(partner, true, _pks(regPk));
        _expect(_pay(150e6, MERCHANT_REF), P.Reason.SANCTIONED, T0); // neighbour
    }

    function test_D4_jurisdictionBlocked() public {
        _jurisdiction("HK", true, _pks(regPk));
        _expect(_pay(150e6, MERCHANT_REF), P.Reason.JURISDICTION_BLOCKED, T0);
        _expect(_transfer(landlord, 150e6), P.Reason.OK, T1); // direct USDC payments are not payouts
        _asset(partner, 2, 2, 0, _pks(regPk));
        _expect(_pay(150e6, MERCHANT_REF), P.Reason.COUNTERPARTY_NOT_APPROVED, T0); // neighbour
    }

    function test_D9_unknownMerchant() public {
        _expect(_pay(150e6, keccak256("OTHER-MERCHANT")), P.Reason.UNKNOWN_PAYEE, T2);
    }

    function test_payoutDirectRailRefused() public {
        Execution memory x = Execution(address(rail), 0, abi.encodeCall(PayoutRail.pay, (partner, 150e6, 0, MERCHANT_REF, bytes32(0))));
        _expect(x, P.Reason.SELECTOR_NOT_ALLOWED, T0);
        x.callData = abi.encodeWithSelector(PayoutRail.pay.selector, partner, 150e6, uint256(257), MERCHANT_REF, bytes32(0));
        _expect(x, P.Reason.SELECTOR_NOT_ALLOWED, T0);
    }

    function test_B1_approveOnlyPairedWithTheMatchingCall() public view {
        _expect(_approve(address(usdc), address(rail), 150e6), P.Reason.SELECTOR_NOT_ALLOWED, T0);
        (uint8[] memory r,) = _checkBatch(Calls.two(_approve(address(usdc), address(rail), 100e6), _pay(150e6, MERCHANT_REF)));
        assertEq(r[0], _r(P.Reason.SELECTOR_NOT_ALLOWED));
        (r,) = _checkBatch(Calls.two(_approve(address(xau), address(rail), 150e6), _pay(150e6, MERCHANT_REF)));
        assertEq(r[0], _r(P.Reason.SELECTOR_NOT_ALLOWED));
        (r,) = _checkBatch(Calls.two(_approve(address(usdc), landlord, 150e6), _transfer(landlord, 150e6)));
        assertEq(r[0], _r(P.Reason.SELECTOR_NOT_ALLOWED));
        (r,) = _checkBatch(Calls.two(_approve(address(usdc), address(desk), 100e6), _swap(address(usdc), address(xau), 200e6, 0)));
        assertEq(r[0], _r(P.Reason.SELECTOR_NOT_ALLOWED));
        (r,) = _checkBatch(Calls.two(_approve(address(usdc), address(rail), 1), _approve(address(usdc), address(rail), 1)));
        assertEq(r[0], _r(P.Reason.SELECTOR_NOT_ALLOWED));
    }

    // ---------------------------------------------------------------- C: rebalancing

    function _buy(uint256 usdcIn) internal view returns (Execution[] memory) {
        return Calls.two(_approve(address(usdc), address(desk), usdcIn), _swap(address(usdc), address(xau), usdcIn, _minOutBuy(usdcIn, XAU_PRICE, 100)));
    }

    function _swapReason(Execution[] memory xs) internal view returns (uint8 r, uint8 t) {
        (uint8[] memory rs, uint8[] memory ts) = _checkBatch(xs);
        assertEq(rs[0], rs[1], "approve inherits");
        return (rs[1], ts[1]);
    }

    function test_rebalanceInsideTheBandsIsAutonomous() public view {
        (uint8 r, uint8 t) = _swapReason(_buy(200e6));
        assertEq(r, 0);
        assertEq(t, T1);
        uint256 xauIn = 0.03 ether;
        (r, t) = _swapReason(Calls.two(_approve(address(xau), address(desk), xauIn),
            _swap(address(xau), address(usdc), xauIn, _minOutSell(xauIn, XAU_PRICE, 100))));
        assertEq(r, 0);
        assertEq(t, T1);
    }

    function test_C1_invalidAmount() public view {
        (uint8 r,) = _swapReason(Calls.two(_approve(address(usdc), address(desk), 0), _swap(address(usdc), address(xau), 0, 0)));
        assertEq(r, _r(P.Reason.INVALID_AMOUNT));
    }

    function test_C2_deskNotActive() public {
        _asset(address(desk), 1, 2, 0, _pks(regPk));
        (uint8 r,) = _swapReason(_buy(200e6));
        assertEq(r, _r(P.Reason.COUNTERPARTY_NOT_APPROVED));
    }

    function test_C3_assetRules() public {
        (uint8 r,) = _swapReason(Calls.two(_approve(address(xau), address(desk), 1e15), _swap(address(xau), address(xag), 1e15, 0)));
        assertEq(r, _r(P.Reason.ASSET_NOT_APPROVED), "neither side USDC");
        (r,) = _swapReason(Calls.two(_approve(address(usdc), address(desk), 1e6), _swap(address(usdc), address(usdc), 1e6, 0)));
        assertEq(r, _r(P.Reason.ASSET_NOT_APPROVED), "same token");
        _asset(address(xau), 0, 2, 4000, _pks(regPk)); // SUSPENDED: no buys, sells allowed
        (r,) = _swapReason(_buy(200e6));
        assertEq(r, _r(P.Reason.ASSET_NOT_APPROVED), "buy suspended");
        uint256 xauIn = 0.03 ether;
        Execution[] memory sell = Calls.two(_approve(address(xau), address(desk), xauIn), _swap(address(xau), address(usdc), xauIn, _minOutSell(xauIn, XAU_PRICE, 100)));
        (r,) = _swapReason(sell);
        assertEq(r, 0, "sell suspended allowed");
        _asset(address(xau), 0, 3, 4000, _pks(regPk)); // DELISTED
        (r,) = _swapReason(sell);
        assertEq(r, _r(P.Reason.ASSET_NOT_APPROVED), "sell delisted");
    }

    function test_C3_tokenOutsideThePolicyBands() public {
        _policyWith(_noSilver);
        (uint8 r,) = _swapReason(Calls.two(_approve(address(usdc), address(desk), 100e6), _swap(address(usdc), address(xag), 100e6, 0)));
        assertEq(r, _r(P.Reason.ASSET_NOT_APPROVED));
    }

    function _noSilver(P.Policy memory p) internal pure {
        P.Band[] memory b = new P.Band[](2);
        b[0] = P.Band(p.bands[0].token, 4000, 6500, 8000);
        b[1] = P.Band(p.bands[1].token, 2000, 3500, 4000);
        p.bands = b;
    }

    function test_C4_stalePrice() public {
        vm.warp(block.timestamp + 4 days + 1);
        _heartbeat(180);
        (uint8 r, uint8 t) = _swapReason(_buy(200e6));
        assertEq(r, _r(P.Reason.STALE_PRICE));
        assertEq(t, T0);
    }

    function test_C5_slippage() public view {
        (uint8 r,) = _swapReason(Calls.two(_approve(address(usdc), address(desk), 200e6), _swap(address(usdc), address(xau), 200e6, 0)));
        assertEq(r, _r(P.Reason.SLIPPAGE));
        (r,) = _swapReason(Calls.two(_approve(address(usdc), address(desk), 200e6),
            _swap(address(usdc), address(xau), 200e6, _minOutBuy(200e6, XAU_PRICE, 101))));
        assertEq(r, _r(P.Reason.SLIPPAGE));
    }

    /// Bank limit: projected weight above assets[token].maxWeightBps is T0, an approval does not lift it.
    function test_C6_bankMaxWeightIsT0() public {
        Execution[] memory xs = _buy(900e6);
        (uint8 r, uint8 t) = _swapReason(xs);
        assertEq(r, _r(P.Reason.BAND_BREACH));
        assertEq(t, T0);
        _approveCall(xs[1]);
        (r, t) = _swapReason(xs);
        assertEq(r, _r(P.Reason.BAND_BREACH));
        assertEq(t, T0);
    }

    function test_C9_rebalanceLimit() public {
        uint256 xagIn = 1001e6 * 1e20 / uint256(XAG_PRICE);
        (uint8 r, uint8 t) = _swapReason(Calls.two(_approve(address(xag), address(desk), xagIn), _swap(address(xag), address(usdc), xagIn, _minOutSell(xagIn, XAG_PRICE, 100))));
        assertEq(r, _r(P.Reason.REBALANCE_LIMIT));
        assertEq(t, T2);
        _status(account, 1, _pks(opPk));
        (r,) = _swapReason(_buy(200e6));
        assertEq(r, _r(P.Reason.RESTRICTED), "C7");
    }

    function test_C9_secondSwapInABatchOverTheDailyCount() public view {
        Execution[] memory xs = new Execution[](4);
        Execution[] memory a = _buy(100e6);
        Execution[] memory b = _buy(100e6);
        (xs[0], xs[1], xs[2], xs[3]) = (a[0], a[1], b[0], b[1]);
        (uint8[] memory r,) = _checkBatch(xs);
        assertEq(r[1], 0);
        assertEq(r[3], _r(P.Reason.REBALANCE_LIMIT));
    }

    /// I15 projection: leaving a band without moving closer to its target needs a human.
    function test_C10_bandBreachNeedsAHuman() public {
        Execution[] memory xs = _buy(500e6);
        (uint8 r, uint8 t) = _swapReason(xs);
        assertEq(r, _r(P.Reason.BAND_BREACH));
        assertEq(t, T2);
        _approveCall(xs[1]);
        (r, t) = _swapReason(xs);
        assertEq(r, 0);
        assertEq(t, T2);
    }

    function test_C11_bufferAfterTheTrade() public {
        _policyWith(_bufferForSwap);
        (uint8 r, uint8 t) = _swapReason(_buy(200e6));
        assertEq(r, _r(P.Reason.BUFFER_BREACH));
        assertEq(t, T2);
    }

    function _bufferForSwap(P.Policy memory p) internal pure {
        p.bufferUsdc = 5_200e6;
    }

    // ---------------------------------------------------------------- never reverts (I12)

    function test_checkBeforeModulesAreSet() public {
        MandateHook fresh = new MandateHook(bank, regulator, operator, "Praetor-test", true);
        (uint8 r,,) = fresh.check(account, address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1));
        assertEq(r, _r(P.Reason.NO_POLICY));
    }

    function testFuzz_checkNeverReverts(address target, uint256 value, bytes calldata data) public view {
        (uint8 r, uint8 t,) = hook.check(account, target, value, data);
        assertLe(r, 27);
        assertLe(t, 4);
    }

    function testFuzz_checkNeverRevertsOnKnownTargets(uint8 which, bytes4 sel, uint256 a, uint256 b, uint256 c, uint256 d) public view {
        address[5] memory targets = [address(usdc), address(desk), address(rail), address(xau), address(xag)];
        address target = targets[which % 5];
        (uint8 r,,) = hook.check(account, target, 0, abi.encodeWithSelector(sel, a, b, c, d));
        assertLe(r, 27);
        (r,,) = hook.check(account, address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, address(uint160(a)), b));
        assertLe(r, 27);
        (r,,) = hook.check(account, address(desk), 0, abi.encodeWithSelector(desk.swap.selector, address(usdc), address(xau), b, c));
        assertLe(r, 27);
        (r,,) = hook.check(account, address(desk), 0, abi.encodeWithSelector(desk.swap.selector, address(xau), address(usdc), b, c));
        assertLe(r, 27);
    }

    function testFuzz_checkBatchNeverReverts(bytes calldata d0, bytes calldata d1, uint8 pick) public view {
        Execution[] memory xs = new Execution[](2);
        xs[0] = Execution(pick % 2 == 0 ? address(usdc) : address(desk), 0, d0);
        xs[1] = Execution(pick % 3 == 0 ? address(rail) : address(usdc), 0, d1);
        (uint8[] memory r,,) = hook.checkBatch(account, xs);
        assertEq(r.length, 2);
    }
}
