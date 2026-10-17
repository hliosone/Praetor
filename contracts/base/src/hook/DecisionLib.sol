// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution} from "../interfaces/IERC7579.sol";
import {
    MandateState, Verdict, ApprovalRec, KyaRec, CapsRec, KIND_NONE, KIND_PAYMENT, KIND_APPROVE, KIND_SWAP, KIND_PAYOUT
} from "./HookTypes.sol";

/// @notice The decision order of spec 03 (port of BSA Sentry's decide.rs, extended). `evaluate` is the single
/// evaluator behind both `check()` and `preCheck`: a view returning one verdict per call plus what to record,
/// never reverting on any input (I12). A live approval lifts a reason only when its tier is T2 (I8).
library DecisionLib {
    bytes4 internal constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant APPROVE = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant SWAP = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    bytes4 internal constant PAY = bytes4(keccak256("pay(address,uint256,uint8,bytes32,bytes32)"));
    uint256 internal constant MAX = 2 ** 128;
    uint8 internal constant T0 = 0;
    uint8 internal constant T1 = 1;
    uint8 internal constant T2 = 2;

    struct Env {
        address account;
        address usdc;
        address desk;
        address rail;
        address oracle;
        bool executor;
        uint8 base;
        bool restricted;
        bool stale;
        bool payoutBlocked;
        uint256 day;
        uint256 month;
        uint256 epoch;
        uint256 perTx;
        uint256 dailyCap;
        uint256 monthlyCap;
        uint256 usdcBalance;
    }

    /// Running totals across the calls of one execution.
    struct Run {
        uint256 spentDay;
        uint256 spentMonth;
        uint256 count;
        uint256 rebalances;
        uint256 usdcPaid;
        int256[4] bandDelta;
        bytes32[] used;
        uint256 nUsed;
    }

    struct Trade {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        uint256 inIdx;
        uint256 outIdx;
        uint256 usdIn;
        uint256 oracleOut;
    }

    // ---------------------------------------------------------------- entry points

    function evaluate(MandateState storage s, address account, Execution[] memory calls, bool executor)
        public
        view
        returns (Verdict[] memory v)
    {
        Env memory e = _env(s, account, executor);
        Run memory run;
        run.spentDay = s.spentDay[account][e.day];
        run.spentMonth = s.spentMonth[account][e.month];
        run.count = s.countDay[account][e.day];
        run.rebalances = s.rebalancesDay[account][e.day];
        run.used = new bytes32[](calls.length);
        v = new Verdict[](calls.length);
        bool[] memory paired = new bool[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            Execution memory x = calls[i];
            v[i].target = x.target;
            v[i].callHash = P.callHash(account, x.target, x.value, x.callData);
            if (e.base != 0) {
                _set(v[i], e.base, T0);
            } else if (x.value != 0 || x.target == account) {
                _set(v[i], uint8(P.Reason.HIDDEN_CALL), T0);
            } else {
                paired[i] = _one(s, e, run, calls, i, v[i]);
            }
        }
        // An approve inherits the decision of the call it pairs with.
        for (uint256 i; i < calls.length; ++i) {
            if (paired[i]) _set(v[i], v[i + 1].reason, v[i + 1].tier);
        }
    }

    /// Records an allowed execution: spend counters, approvals consumed, one Decision event per call.
    function applyEffects(MandateState storage s, address account, Verdict[] memory v, bool executor) external {
        uint256 day = block.timestamp / 1 days;
        uint256 month = block.timestamp / 30 days;
        uint256 ep = s.epoch[account];
        for (uint256 i; i < v.length; ++i) {
            Verdict memory x = v[i];
            if (x.usesApproval) {
                s.approvals[account][ep][x.callHash].consumed = true;
                emit IMandateHookEvents.ApprovalConsumed(account, x.callHash);
            }
            if (x.kind == KIND_PAYMENT || x.kind == KIND_PAYOUT) {
                s.spentDay[account][day] += x.amount;
                s.spentMonth[account][month] += x.amount;
                if (!executor) s.countDay[account][day] += 1;
            } else if (x.kind == KIND_SWAP) {
                s.rebalancesDay[account][day] += 1;
            }
            emit IMandateHookEvents.Decision(account, x.callHash, 0, x.tier, x.target, x.valueUsd6);
        }
    }

    // ---------------------------------------------------------------- one call

    /// Returns true when call i is an approve validly paired with call i + 1.
    function _one(MandateState storage s, Env memory e, Run memory run, Execution[] memory calls, uint256 i, Verdict memory v)
        internal
        view
        returns (bool)
    {
        bytes memory d = calls[i].callData;
        (uint8 kind, uint8 reason) = _classify(s, e, calls[i].target, d);
        v.kind = kind;
        if (reason != 0) {
            _set(v, reason, T0);
        } else if (kind == KIND_APPROVE) {
            if (i + 1 < calls.length && _pairs(e, calls[i].target, d, calls[i + 1])) return true;
            _set(v, uint8(P.Reason.SELECTOR_NOT_ALLOWED), T0);
        } else if (kind == KIND_PAYMENT) {
            _payment(s, e, run, v, _addr(d, 0), _word(d, 1), false, bytes32(0));
        } else if (kind == KIND_PAYOUT) {
            _payment(s, e, run, v, _addr(d, 0), _word(d, 1), true, bytes32(_word(d, 3)));
        } else if (e.executor) {
            _set(v, uint8(P.Reason.SELECTOR_NOT_ALLOWED), T0);
        } else {
            Trade memory t;
            t.tokenIn = _addr(d, 0);
            t.tokenOut = _addr(d, 1);
            t.amountIn = _word(d, 2);
            t.minOut = _word(d, 3);
            _swap(s, e, run, v, t);
        }
        return false;
    }

    /// Default deny (I2): exact calldata lengths and canonical padding, else SELECTOR_NOT_ALLOWED on a known
    /// contract and TARGET_NOT_ALLOWED anywhere else.
    function _classify(MandateState storage s, Env memory e, address target, bytes memory d) internal view returns (uint8, uint8) {
        bool token = target == e.usdc
            || (s.assets[target].kind == uint8(P.AssetKind.TOKEN) && s.assets[target].status != uint8(P.AssetStatus.NONE));
        if (!token && target != e.desk && target != e.rail) return (KIND_NONE, uint8(P.Reason.TARGET_NOT_ALLOWED));
        uint8 no = uint8(P.Reason.SELECTOR_NOT_ALLOWED);
        if (d.length < 4) return (KIND_NONE, no);
        bytes4 sel = bytes4(d);
        if (target == e.usdc && sel == TRANSFER && d.length == 68 && _isAddr(d, 0)) return (KIND_PAYMENT, 0);
        if (token && sel == APPROVE && d.length == 68 && _isAddr(d, 0)) return (KIND_APPROVE, 0);
        if (target == e.desk && sel == SWAP && d.length == 132 && _isAddr(d, 0) && _isAddr(d, 1)) return (KIND_SWAP, 0);
        if (target == e.rail && sel == PAY && d.length == 164 && _isAddr(d, 0)) {
            uint256 rail = _word(d, 2);
            if (rail == uint8(P.Rail.ALIPAY_PLUS) || rail == uint8(P.Rail.WECHAT_PAY)) return (KIND_PAYOUT, 0);
        }
        return (KIND_NONE, no);
    }

    /// B1: approve(desk, amt) before desk.swap(token, ..., amt, ...), or approve(rail, amt) of USDC before rail.pay(.., amt, ..).
    function _pairs(Env memory e, address token, bytes memory d, Execution memory next) internal pure returns (bool) {
        address spender = _addr(d, 0);
        uint256 amt = _word(d, 1);
        bytes memory n = next.callData;
        if (next.value != 0 || n.length < 4) return false;
        if (spender == e.desk && next.target == e.desk && bytes4(n) == SWAP && n.length == 132) {
            return _word(n, 0) == uint256(uint160(token)) && _word(n, 2) == amt;
        }
        if (spender == e.rail && token == e.usdc && next.target == e.rail && bytes4(n) == PAY && n.length == 164) {
            return _word(n, 1) == amt;
        }
        return false;
    }

    // ---------------------------------------------------------------- A / D: payments and payouts

    function _payment(
        MandateState storage s,
        Env memory e,
        Run memory run,
        Verdict memory v,
        address to,
        uint256 amt,
        bool payout,
        bytes32 merchantRef
    ) internal view {
        v.amount = amt;
        v.valueUsd6 = amt;
        P.Policy storage pol = s.policy[e.account];
        if (amt == 0 || amt > MAX) return _set(v, uint8(P.Reason.INVALID_AMOUNT), T0);
        if (s.sanctioned[to].on) return _set(v, uint8(P.Reason.SANCTIONED), T0);
        if (payout) {
            if (s.assets[to].kind != uint8(P.AssetKind.PAYOUT_PARTNER) || s.assets[to].status != uint8(P.AssetStatus.ACTIVE)) {
                return _set(v, uint8(P.Reason.COUNTERPARTY_NOT_APPROVED), T0);
            }
            if (e.payoutBlocked) return _set(v, uint8(P.Reason.JURISDICTION_BLOCKED), T0);
        }
        uint256 hard = pol.hardCap < e.perTx ? pol.hardCap : e.perTx;
        if (amt > hard) return _set(v, uint8(P.Reason.OVER_HARD_CAP), T0);
        if (run.spentDay + amt > e.dailyCap || run.spentMonth + amt > e.monthlyCap) {
            return _set(v, uint8(P.Reason.BUDGET_EXCEEDED), T0);
        }
        uint8 r;
        if (!e.executor) r = _paymentT2(e, run, pol, to, amt, payout, merchantRef);
        _finish(s, e, run, v, r);
        if (v.reason == 0) {
            run.spentDay += amt;
            run.spentMonth += amt;
            if (!e.executor) run.count += 1;
            run.usdcPaid += amt;
        }
    }

    function _paymentT2(
        Env memory e,
        Run memory run,
        P.Policy storage pol,
        address to,
        uint256 amt,
        bool payout,
        bytes32 merchantRef
    ) internal view returns (uint8) {
        if (e.restricted) return uint8(P.Reason.RESTRICTED);
        if (e.stale) return uint8(P.Reason.STALE_STATUS);
        if (payout ? !_hasMerchant(pol, P.merchantKey(to, merchantRef)) : !_hasPayee(pol, to)) return uint8(P.Reason.UNKNOWN_PAYEE);
        if (amt > pol.autoCap) return uint8(P.Reason.OVER_AUTO_CAP);
        if (run.spentDay + amt > pol.dailyBudget || run.spentMonth + amt > pol.monthlyBudget) return uint8(P.Reason.BUDGET_EXCEEDED);
        if (run.count >= pol.dailyCount) return uint8(P.Reason.COUNT_EXCEEDED);
        if (_usdcAvailable(e, run) < amt + pol.bufferUsdc) return uint8(P.Reason.BUFFER_BREACH);
        return 0;
    }

    // ---------------------------------------------------------------- C: rebalancing

    function _swap(MandateState storage s, Env memory e, Run memory run, Verdict memory v, Trade memory t) internal view {
        v.amount = t.amountIn;
        P.Policy storage pol = s.policy[e.account];
        if (t.amountIn == 0 || t.amountIn > MAX) return _set(v, uint8(P.Reason.INVALID_AMOUNT), T0);
        if (s.assets[e.desk].kind != uint8(P.AssetKind.DESK) || s.assets[e.desk].status != uint8(P.AssetStatus.ACTIVE)) {
            return _set(v, uint8(P.Reason.COUNTERPARTY_NOT_APPROVED), T0);
        }
        if (!_assetsOk(s, e, pol, t)) return _set(v, uint8(P.Reason.ASSET_NOT_APPROVED), T0);
        uint8 r = _price(e, t);
        if (r != 0) return _set(v, r, T0);
        v.valueUsd6 = t.usdIn;
        if (t.minOut < t.oracleOut * (P.BPS - pol.maxSlippageBps) / P.BPS) return _set(v, uint8(P.Reason.SLIPPAGE), T0);
        (bool ok, uint256[] memory before, uint256[] memory afterV, uint256 total) = _project(e, run, pol, t);
        if (!ok) return _set(v, uint8(P.Reason.BAND_BREACH), T0);
        if (t.tokenOut != e.usdc && total != 0 && afterV[t.outIdx] * P.BPS / total > s.assets[t.tokenOut].maxWeightBps) {
            return _set(v, uint8(P.Reason.BAND_BREACH), T0);
        }
        r = _swapT2(e, run, pol, t, before, afterV, total);
        _finish(s, e, run, v, r);
        v.enforceBands = !v.usesApproval;
        if (v.reason == 0) {
            run.rebalances += 1;
            run.bandDelta[t.inIdx] -= int256(t.usdIn);
            run.bandDelta[t.outIdx] += int256(t.usdIn);
        }
    }

    function _swapT2(
        Env memory e,
        Run memory run,
        P.Policy storage pol,
        Trade memory t,
        uint256[] memory before,
        uint256[] memory afterV,
        uint256 total
    ) internal view returns (uint8) {
        if (e.restricted) return uint8(P.Reason.RESTRICTED);
        if (e.stale) return uint8(P.Reason.STALE_STATUS);
        if (t.usdIn > pol.maxTradeUsd || run.rebalances >= pol.maxRebalancesPerDay) return uint8(P.Reason.REBALANCE_LIMIT);
        if (!_bandsOk(pol, before, afterV, total)) return uint8(P.Reason.BAND_BREACH);
        // USDC is always band 0 (validatePolicy), and its USD value equals its amount.
        if (afterV[0] < pol.bufferUsdc) return uint8(P.Reason.BUFFER_BREACH);
        return 0;
    }

    /// I15: after the trade every band asset is inside [min, max], or strictly closer to its target than before.
    function _bandsOk(P.Policy storage pol, uint256[] memory before, uint256[] memory afterV, uint256 total)
        internal
        view
        returns (bool)
    {
        if (total == 0) return true;
        for (uint256 j; j < before.length; ++j) {
            P.Band memory b = pol.bands[j];
            uint256 wA = afterV[j] * P.BPS / total;
            if (wA >= b.minBps && wA <= b.maxBps) continue;
            uint256 wB = before[j] * P.BPS / total;
            if (_dist(wA, b.targetBps) >= _dist(wB, b.targetBps)) return false;
        }
        return true;
    }

    /// C3: one side USDC, the other a band token; bought token ACTIVE; sold token not DELISTED; both in the bands.
    function _assetsOk(MandateState storage s, Env memory e, P.Policy storage pol, Trade memory t) internal view returns (bool) {
        if (t.tokenIn == t.tokenOut || (t.tokenIn != e.usdc && t.tokenOut != e.usdc)) return false;
        if (t.tokenOut != e.usdc && s.assets[t.tokenOut].status != uint8(P.AssetStatus.ACTIVE)) return false;
        if (t.tokenIn != e.usdc) {
            uint8 st = s.assets[t.tokenIn].status;
            if (st != uint8(P.AssetStatus.ACTIVE) && st != uint8(P.AssetStatus.SUSPENDED)) return false;
        }
        bool inFound;
        bool outFound;
        for (uint256 j; j < pol.bands.length; ++j) {
            address tok = pol.bands[j].token;
            if (tok == t.tokenIn) (inFound, t.inIdx) = (true, j);
            if (tok == t.tokenOut) (outFound, t.outIdx) = (true, j);
        }
        return inFound && outFound;
    }

    /// C4 and the fair (no-spread) output at the oracle price.
    function _price(Env memory e, Trade memory t) internal view returns (uint8) {
        address metal = t.tokenIn == e.usdc ? t.tokenOut : t.tokenIn;
        (bool ok, uint256 p8, uint64 at) = _oraclePrice(e.oracle, metal);
        if (!ok || block.timestamp - at > _maxAge(e.oracle)) return uint8(P.Reason.STALE_PRICE);
        (bool okIn, uint8 decIn) = _decimals(e, t.tokenIn);
        (bool okOut, uint8 decOut) = _decimals(e, t.tokenOut);
        if (!okIn || !okOut) return uint8(P.Reason.ASSET_NOT_APPROVED);
        uint256 pIn = t.tokenIn == e.usdc ? 1e8 : p8;
        uint256 pOut = t.tokenOut == e.usdc ? 1e8 : p8;
        bool valid;
        (valid, t.usdIn) = P.valueUsd6(t.amountIn, pIn, decIn);
        if (!valid || t.usdIn > MAX) return uint8(P.Reason.INVALID_AMOUNT);
        t.oracleOut = t.usdIn * 10 ** (uint256(decOut) + 2) / pOut;
        return 0;
    }

    /// Band values in USD (6 dp) before and after the trade, including earlier calls of the same execution.
    function _project(Env memory e, Run memory run, P.Policy storage pol, Trade memory t)
        internal
        view
        returns (bool ok, uint256[] memory before, uint256[] memory afterV, uint256 total)
    {
        uint256 n = pol.bands.length;
        before = new uint256[](n);
        afterV = new uint256[](n);
        for (uint256 j; j < n; ++j) {
            (bool okV, uint256 val) = _bandValue(e, pol.bands[j].token);
            if (!okV) return (false, before, afterV, 0);
            int256 adj = int256(val) + run.bandDelta[j] - (j == 0 ? int256(run.usdcPaid) : int256(0));
            before[j] = adj > 0 ? uint256(adj) : 0;
            total += before[j];
            afterV[j] = before[j];
        }
        afterV[t.inIdx] = afterV[t.inIdx] > t.usdIn ? afterV[t.inIdx] - t.usdIn : 0;
        afterV[t.outIdx] += t.usdIn;
        ok = true;
    }

    function _bandValue(Env memory e, address token) internal view returns (bool, uint256) {
        (bool okB, uint256 bal) = _balanceOf(token, e.account);
        if (!okB) return (false, 0);
        if (token == e.usdc) return (bal <= MAX, bal);
        (bool okD, uint8 dec) = _decimals(e, token);
        (bool okP, uint256 p8,) = _oraclePrice(e.oracle, token);
        if (!okD) return (false, 0);
        if (!okP) return (true, 0);
        (bool okV, uint256 val) = P.valueUsd6(bal, p8, dec);
        return (okV, val);
    }

    /// Current USD value (6 dp) of each policy band token held by the account, for postCheck.
    function bandValues(MandateState storage s, address account) public view returns (bool ok, uint256[] memory values, uint256 total) {
        Env memory e;
        e.account = account;
        e.usdc = s.m.usdc;
        e.oracle = s.m.oracle;
        P.Band[] storage bands = s.policy[account].bands;
        values = new uint256[](bands.length);
        for (uint256 j; j < bands.length; ++j) {
            (bool okV, uint256 val) = _bandValue(e, bands[j].token);
            if (!okV) return (false, values, 0);
            values[j] = val;
            total += val;
        }
        ok = true;
    }

    // ---------------------------------------------------------------- shared

    /// T2 result: a live approval for this callHash, not yet used in this execution, turns it into OK.
    function _finish(MandateState storage s, Env memory e, Run memory run, Verdict memory v, uint8 r) internal view {
        if (r == 0) return _set(v, 0, T1);
        ApprovalRec memory a = s.approvals[e.account][e.epoch][v.callHash];
        if (a.expiresAt > block.timestamp && !a.consumed && !_used(run, v.callHash)) {
            run.used[run.nUsed++] = v.callHash;
            v.usesApproval = true;
            return _set(v, 0, T2);
        }
        _set(v, r, T2);
    }

    function _env(MandateState storage s, address account, bool executor) internal view returns (Env memory e) {
        e.account = account;
        e.executor = executor;
        e.usdc = s.m.usdc;
        e.desk = s.m.desk;
        e.rail = s.m.payoutRail;
        e.oracle = s.m.oracle;
        uint8 acc = s.status[account].status;
        uint8 glob = s.globalStatus.status;
        uint8 st = acc > glob ? acc : glob;
        KyaRec storage k = s.kya[account];
        if (st == uint8(P.Status.FROZEN)) e.base = uint8(P.Reason.FROZEN);
        else if (s.policyHash[account] == bytes32(0)) e.base = uint8(P.Reason.NO_POLICY);
        else if (k.nonce == 0 || k.kycLevel == 0 || k.validUntil < block.timestamp) e.base = uint8(P.Reason.KYA_INVALID);
        else if (s.policy[account].validUntil < block.timestamp) e.base = uint8(P.Reason.SESSION_EXPIRED);
        if (e.base != 0) return e;
        e.restricted = st == uint8(P.Status.RESTRICTED) || s.paused[account] || s.recovery[account].executableAt != 0;
        e.stale = s.hbValidUntil < block.timestamp;
        e.day = block.timestamp / 1 days;
        e.month = block.timestamp / 30 days;
        e.epoch = s.epoch[account];
        CapsRec storage c = s.caps[k.riskProfile];
        e.perTx = c.perTxCap;
        e.dailyCap = c.dailyCap;
        e.monthlyCap = c.monthlyCap;
        e.payoutBlocked = s.jurisdictions[k.jurisdiction].on;
        (, e.usdcBalance) = _balanceOf(e.usdc, account);
    }

    function _usdcAvailable(Env memory e, Run memory run) internal pure returns (uint256) {
        int256 avail = int256(e.usdcBalance > MAX ? MAX : e.usdcBalance) - int256(run.usdcPaid) + run.bandDelta[0];
        return avail > 0 ? uint256(avail) : 0;
    }

    function _hasPayee(P.Policy storage pol, address to) internal view returns (bool) {
        for (uint256 i; i < pol.payees.length; ++i) if (pol.payees[i] == to) return true;
        return false;
    }

    function _hasMerchant(P.Policy storage pol, bytes32 key) internal view returns (bool) {
        for (uint256 i; i < pol.merchants.length; ++i) if (pol.merchants[i] == key) return true;
        return false;
    }

    function _used(Run memory run, bytes32 h) internal pure returns (bool) {
        for (uint256 i; i < run.nUsed; ++i) if (run.used[i] == h) return true;
        return false;
    }

    function _set(Verdict memory v, uint8 reason, uint8 tier) internal pure {
        v.reason = reason;
        v.tier = tier;
    }

    function _dist(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // ---------------------------------------------------------------- calldata and guarded reads

    function _word(bytes memory d, uint256 i) internal pure returns (uint256 w) {
        assembly ("memory-safe") {
            w := mload(add(add(d, 36), mul(i, 32)))
        }
    }

    function _addr(bytes memory d, uint256 i) internal pure returns (address) {
        return address(uint160(_word(d, i)));
    }

    function _isAddr(bytes memory d, uint256 i) internal pure returns (bool) {
        return _word(d, i) >> 160 == 0;
    }

    function _static(address target, bytes memory data) internal view returns (bool ok, uint256 w) {
        if (target.code.length == 0) return (false, 0);
        bytes memory ret;
        (ok, ret) = target.staticcall(data);
        if (!ok || ret.length < 32) return (false, 0);
        assembly ("memory-safe") {
            w := mload(add(ret, 32))
        }
    }

    function _balanceOf(address token, address who) internal view returns (bool, uint256) {
        return _static(token, abi.encodeWithSelector(0x70a08231, who));
    }

    function _decimals(Env memory e, address token) internal view returns (bool, uint8) {
        if (token == e.usdc) return (true, 6);
        (bool ok, uint256 w) = _static(token, abi.encodeWithSelector(0x313ce567));
        if (!ok || w > P.MAX_DECIMALS) return (false, 0);
        return (true, uint8(w));
    }

    /// PriceOracle.getPrice(token) -> (int256 price8, uint64 publishTime); ok only for 0 < price < 2^128.
    function _oraclePrice(address oracle, address token) internal view returns (bool, uint256, uint64) {
        if (oracle.code.length == 0) return (false, 0, 0);
        (bool ok, bytes memory ret) = oracle.staticcall(abi.encodeWithSignature("getPrice(address)", token));
        if (!ok || ret.length < 64) return (false, 0, 0);
        (int256 p, uint256 at) = abi.decode(ret, (int256, uint256));
        if (p <= 0 || uint256(p) >= MAX || at > block.timestamp) return (false, 0, 0);
        return (true, uint256(p), uint64(at));
    }

    function _maxAge(address oracle) internal view returns (uint256) {
        (bool ok, uint256 w) = _static(oracle, abi.encodeWithSignature("maxPriceAge()"));
        return ok ? w : 0;
    }
}
