// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution} from "../interfaces/IERC7579.sol";
import {MandateState, Verdict, KIND_APPROVE, KIND_SWAP} from "./HookTypes.sol";
import {DecisionLib} from "./DecisionLib.sol";

/// @notice What preCheck hands to postCheck, and the checks on the real outcome (spec 03): every approve of the
/// pattern leaves a zero allowance (B2); after a swap the bought token is within the bank's max weight, and unless
/// a human approved a band breach, every band moved inside or closer to its target (I15).
library PostCheckLib {
    uint8 internal constant POST_EXEC = 1;

    struct Post {
        address[] tokens;
        address[] spenders;
        address[] outs;
        uint256[] before;
        uint256 totalBefore;
        bool enforce;
    }

    function prepare(MandateState storage s, address account, Execution[] memory calls, Verdict[] memory v)
        external
        view
        returns (bytes memory)
    {
        Post memory p;
        uint256 nA;
        uint256 nS;
        for (uint256 i; i < v.length; ++i) {
            if (v[i].kind == KIND_APPROVE) ++nA;
            if (v[i].kind == KIND_SWAP) ++nS;
        }
        p.tokens = new address[](nA);
        p.spenders = new address[](nA);
        p.outs = new address[](nS);
        p.enforce = true;
        (nA, nS) = (0, 0);
        for (uint256 i; i < v.length; ++i) {
            bytes memory d = calls[i].callData;
            if (v[i].kind == KIND_APPROVE) {
                p.tokens[nA] = calls[i].target;
                p.spenders[nA++] = address(uint160(_word(d, 0)));
            } else if (v[i].kind == KIND_SWAP) {
                p.outs[nS++] = address(uint160(_word(d, 1)));
                if (!v[i].enforceBands) p.enforce = false;
            }
        }
        if (nS != 0) (, p.before, p.totalBefore) = DecisionLib.bandValues(s, account);
        return abi.encodePacked(POST_EXEC, abi.encode(p));
    }

    function check(MandateState storage s, address account, bytes calldata data) external view {
        Post memory p = abi.decode(data, (Post));
        for (uint256 i; i < p.tokens.length; ++i) {
            (bool ok, bytes memory ret) = p.tokens[i].staticcall(abi.encodeWithSelector(0xdd62ed3e, account, p.spenders[i]));
            if (!ok || ret.length < 32 || abi.decode(ret, (uint256)) != 0) _refuse(P.Reason.SELECTOR_NOT_ALLOWED);
        }
        if (p.outs.length == 0) return;
        (bool okV, uint256[] memory afterV, uint256 totalAfter) = DecisionLib.bandValues(s, account);
        if (!okV || totalAfter == 0) _refuse(P.Reason.BAND_BREACH);
        P.Band[] storage bands = s.policy[account].bands;
        for (uint256 k; k < p.outs.length; ++k) {
            if (p.outs[k] == s.m.usdc) continue;
            for (uint256 j; j < bands.length; ++j) {
                if (bands[j].token == p.outs[k] && afterV[j] * P.BPS / totalAfter > s.assets[p.outs[k]].maxWeightBps) {
                    _refuse(P.Reason.BAND_BREACH);
                }
            }
        }
        if (!p.enforce || p.totalBefore == 0) return;
        for (uint256 j; j < bands.length; ++j) {
            uint256 wA = afterV[j] * P.BPS / totalAfter;
            if (wA >= bands[j].minBps && wA <= bands[j].maxBps) continue;
            uint256 wB = p.before[j] * P.BPS / p.totalBefore;
            if (_dist(wA, bands[j].targetBps) >= _dist(wB, bands[j].targetBps)) _refuse(P.Reason.BAND_BREACH);
        }
    }

    function _refuse(P.Reason r) internal pure {
        revert IMandateHookEvents.MandateRefused(uint8(r), bytes32(0));
    }

    function _dist(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _word(bytes memory d, uint256 i) internal pure returns (uint256 w) {
        assembly ("memory-safe") {
            w := mload(add(add(d, 36), mul(i, 32)))
        }
    }
}
