// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Execution, MODE_SINGLE, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";
import {MandateHook} from "../../src/MandateHook.sol";
import {TreasuryDesk} from "../../src/TreasuryDesk.sol";
import {PayoutRail} from "../../src/PayoutRail.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {MockAccount} from "../utils/MockAccount.sol";

/// Drives the account through random payments, payouts, swaps, approvals, freezes, cap changes and time.
contract HookHandler is Test {
    LinScenarioView internal v;
    MandateHook internal hook;
    address internal account;
    address[4] internal payees;

    uint256 public calls;
    uint256 public allowedPayments;
    bool public capBreach;
    bool public frozenLeak;
    bool public bandBreach;
    mapping(uint256 day => uint256) public paidOn;

    constructor(LinScenarioView v_) {
        v = v_;
        hook = MandateHook(v.hookAddr());
        account = v.accountAddr();
        payees = [v.payee(0), v.payee(1), v.payee(2), makeAddr("stranger")];
    }

    function pay(uint256 who, uint256 amount) external {
        Execution memory x = Execution(v.usdcAddr(), 0, abi.encodeWithSelector(0xa9059cbb, payees[who % 4], bound(amount, 0, 3_000e6)));
        _run(MODE_SINGLE, abi.encodePacked(x.target, uint256(0), x.callData), true, bound(amount, 0, 3_000e6), false);
    }

    function payout(uint256 amount) external {
        amount = bound(amount, 1, 3_000e6);
        Execution[] memory xs = new Execution[](2);
        xs[0] = Execution(v.usdcAddr(), 0, abi.encodeWithSelector(0x095ea7b3, v.railAddr(), amount));
        xs[1] = Execution(v.railAddr(), 0, abi.encodeCall(PayoutRail.pay, (v.partnerAddr(), amount, 1, v.merchantRef(), keccak256(abi.encode(calls)))));
        _run(MODE_BATCH, abi.encode(xs), true, amount, false);
    }

    function swap(bool buy, bool gold, uint256 amount) external {
        address metal = gold ? v.xauAddr() : v.xagAddr();
        (address tin, address tout) = buy ? (v.usdcAddr(), metal) : (metal, v.usdcAddr());
        amount = buy ? bound(amount, 1e6, 1_500e6) : bound(amount, 1e15, 5 ether);
        uint256 minOut;
        try TreasuryDesk(v.deskAddr()).quote(tin, tout, amount) returns (uint256 q, uint256) {
            minOut = q;
        } catch {
            return;
        }
        Execution[] memory xs = new Execution[](2);
        xs[0] = Execution(tin, 0, abi.encodeWithSelector(0x095ea7b3, v.deskAddr(), amount));
        xs[1] = Execution(v.deskAddr(), 0, abi.encodeCall(TreasuryDesk.swap, (tin, tout, amount, minOut)));
        _run(MODE_BATCH, abi.encode(xs), false, 0, true);
    }

    function freeze(bool global) external {
        v.applyStatus(global ? address(0) : account, 2);
    }

    function unfreeze(bool global) external {
        v.applyStatus(global ? address(0) : account, 0);
    }

    function setCaps(uint256 perTx, uint256 daily, uint256 monthly) external {
        v.applyCaps(bound(perTx, 0, 6_000e6), bound(daily, 0, 12_000e6), bound(monthly, 0, 60_000e6));
    }

    function approve(uint256 amount) external {
        v.approvePayment(payees[0], bound(amount, 201e6, 3_000e6));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        v.refresh();
    }

    function _run(bytes32 mode, bytes memory exec, bool isPayment, uint256 amount, bool isSwap) internal {
        ++calls;
        (uint8 eff,,,) = hook.statusOf(account);
        uint256[3] memory before = v.balances();
        (uint256[] memory wBefore, bool okB) = v.weights();
        vm.prank(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
        try MockAccount(account).execute(mode, exec) {
            if (isPayment) {
                ++allowedPayments;
                paidOn[block.timestamp / 1 days] += amount;
                (uint256 perTx, uint256 daily, uint256 monthly) = hook.capsOf(uint8(P.RiskProfile.BALANCED));
                (uint256 sd, uint256 sm,,) = hook.spentOf(account);
                if (amount > perTx || sd > daily || sm > monthly) capBreach = true;
            }
            if (isSwap && okB && !v.bandsFine(wBefore)) bandBreach = true;
        } catch {}
        uint256[3] memory afterB = v.balances();
        if (eff == 2) for (uint256 i; i < 3; ++i) if (afterB[i] < before[i]) frozenLeak = true;
    }
}

/// What the handler reads from the scenario (keeps the handler independent of the test contract).
interface LinScenarioView {
    function hookAddr() external view returns (address);
    function accountAddr() external view returns (address);
    function usdcAddr() external view returns (address);
    function xauAddr() external view returns (address);
    function xagAddr() external view returns (address);
    function deskAddr() external view returns (address);
    function railAddr() external view returns (address);
    function partnerAddr() external view returns (address);
    function merchantRef() external view returns (bytes32);
    function payee(uint256 i) external view returns (address);
    function balances() external view returns (uint256[3] memory);
    function weights() external view returns (uint256[] memory, bool);
    function bandsFine(uint256[] memory before) external view returns (bool);
    function applyStatus(address who, uint8 st) external;
    function applyCaps(uint256 perTx, uint256 daily, uint256 monthly) external;
    function approvePayment(address to, uint256 amount) external;
    function refresh() external;
}

contract HookInvariantsTest is LinScenario {
    HookHandler internal handler;

    function setUp() public override {
        super.setUp();
        vm.etch(account, address(new MockAccount()).code);
        MockAccount(account).init(address(hook), standingOrders);
        handler = new HookHandler(LinScenarioView(address(this)));
        targetContract(address(handler));
    }

    /// I8: no allowed payment ever exceeds the bank caps in force.
    function invariant_I8_bankCapsNeverExceeded() public view {
        assertFalse(handler.capBreach());
    }

    /// I14: while FROZEN nothing leaves the account.
    function invariant_I14_nothingLeavesWhileFrozen() public view {
        assertFalse(handler.frozenLeak());
    }

    /// I15: an autonomous rebalance never leaves a band without moving closer to its target.
    function invariant_I15_bands() public view {
        assertFalse(handler.bandBreach());
    }

    /// The hook's spend counter equals the sum of allowed payments today.
    function invariant_spentEqualsAllowedPayments() public view {
        (uint256 day,,,) = hook.spentOf(account);
        assertEq(day, handler.paidOn(block.timestamp / 1 days));
    }

    /// Guards against vacuous invariants: the handler really gets payments and swaps through.
    function test_handlerProducesAllowedActions() public {
        handler.pay(0, 150e6);
        assertEq(handler.allowedPayments(), 1);
        handler.payout(150e6);
        assertEq(handler.allowedPayments(), 2);
        (,,, uint256 rebBefore) = hook.spentOf(account);
        handler.swap(false, false, 0.5 ether); // tXAG drifted above its band after the payments: sell it back
        (,,, uint256 rebAfter) = hook.spentOf(account);
        assertEq(rebAfter, rebBefore + 1);
        handler.freeze(false);
        handler.pay(0, 150e6);
        assertEq(handler.allowedPayments(), 2);
        assertFalse(handler.frozenLeak());
    }

    // ---------------------------------------------------------------- LinScenarioView

    function hookAddr() external view returns (address) { return address(hook); }
    function accountAddr() external view returns (address) { return account; }
    function usdcAddr() external view returns (address) { return address(usdc); }
    function xauAddr() external view returns (address) { return address(xau); }
    function xagAddr() external view returns (address) { return address(xag); }
    function deskAddr() external view returns (address) { return address(desk); }
    function railAddr() external view returns (address) { return address(rail); }
    function partnerAddr() external view returns (address) { return partner; }
    function merchantRef() external pure returns (bytes32) { return MERCHANT_REF; }

    function payee(uint256 i) external view returns (address) {
        return [landlord, utilities, cafe][i];
    }

    function balances() external view returns (uint256[3] memory b) {
        b = [usdc.balanceOf(account), xau.balanceOf(account), xag.balanceOf(account)];
    }

    function weights() public view returns (uint256[] memory w, bool ok) {
        (int256 pa,) = oracle.getPrice(address(xau));
        (int256 pg,) = oracle.getPrice(address(xag));
        uint256[3] memory val = [usdc.balanceOf(account), xau.balanceOf(account) * uint256(pa) / 1e20, xag.balanceOf(account) * uint256(pg) / 1e20];
        uint256 total = val[0] + val[1] + val[2];
        w = new uint256[](3);
        if (total == 0) return (w, false);
        for (uint256 i; i < 3; ++i) w[i] = val[i] * 10_000 / total;
        ok = true;
    }

    function bandsFine(uint256[] memory before) external view returns (bool) {
        (uint256[] memory w,) = weights();
        P.Policy memory p = hook.policyOf(account);
        for (uint256 j; j < 3; ++j) {
            P.Band memory b = p.bands[j];
            if (w[j] >= b.minBps && w[j] <= b.maxBps) continue;
            uint256 dA = w[j] > b.targetBps ? w[j] - b.targetBps : b.targetBps - w[j];
            uint256 dB = before[j] > b.targetBps ? before[j] - b.targetBps : b.targetBps - before[j];
            // One basis point of slack: weights here are recomputed with integer division.
            if (dA > dB + 1) return false;
        }
        return true;
    }

    function applyStatus(address who, uint8 st) external {
        (uint8 eff, uint8 acc, uint8 glob,) = hook.statusOf(account);
        uint8 cur = who == address(0) ? glob : acc;
        if (eff == 255) return;
        if (cur == st) return;
        _status(who, st, st > cur ? _pks(regPk) : _pks(bankPk, regPk));
    }

    function applyCaps(uint256 perTx, uint256 daily, uint256 monthly) external {
        _caps(uint8(P.RiskProfile.BALANCED), perTx, daily, monthly);
    }

    function approvePayment(address to, uint256 amount) external {
        Execution memory x = _transfer(to, amount);
        bytes32 ch = P.callHash(account, x.target, 0, x.callData);
        (uint64 exp, bool consumed) = hook.approvalOf(account, ch);
        if (exp > block.timestamp && !consumed) return;
        _approveCall(x);
    }

    function refresh() external {
        _heartbeat(180);
        vm.startPrank(feeder);
        (int256 pa,) = oracle.getPrice(address(xau));
        (int256 pg,) = oracle.getPrice(address(xag));
        oracle.setPrice(address(xau), pa, uint64(block.timestamp), 0);
        oracle.setPrice(address(xag), pg, uint64(block.timestamp), 0);
        vm.stopPrank();
    }
}
