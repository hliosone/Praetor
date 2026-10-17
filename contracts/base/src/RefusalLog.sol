// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IRefusalLogEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution} from "./interfaces/IERC7579.sol";

interface IMandateCheck {
    function check(address account, address target, uint256 value, bytes calldata data)
        external
        view
        returns (uint8 reason, uint8 tier, bytes32 callHash);
    function checkBatch(address account, Execution[] calldata calls)
        external
        view
        returns (uint8[] memory reasons, uint8[] memory tiers, bytes32[] memory callHashes);
}

/// @notice On-chain record of refused userOps (Safe7579 turns hook reverts into ExecutionFailed()). The reason is
/// computed here by the hook's check(), never declared by the reporter (I11). The link to userOpHash is the
/// reporter's claim (documented caveat: the bundler logs right after the failed op).
contract RefusalLog is IRefusalLogEvents {
    IMandateCheck public immutable hook;

    error NotRefused();

    constructor(address hook_) {
        hook = IMandateCheck(hook_);
    }

    function log(bytes32 userOpHash, address account, address target, uint256 value, bytes calldata data) external {
        (uint8 reason, uint8 tier, bytes32 callHash) = hook.check(account, target, value, data);
        if (reason == 0) revert NotRefused();
        emit Refused(userOpHash, account, callHash, reason, tier, target, msg.sender);
    }

    function logBatch(bytes32 userOpHash, address account, Execution[] calldata calls) external {
        (uint8[] memory reasons, uint8[] memory tiers, bytes32[] memory callHashes) = hook.checkBatch(account, calls);
        for (uint256 i; i < reasons.length; ++i) {
            if (reasons[i] != 0) {
                emit Refused(userOpHash, account, callHashes[i], reasons[i], tiers[i], calls[i].target, msg.sender);
                return;
            }
        }
        revert NotRefused();
    }
}
