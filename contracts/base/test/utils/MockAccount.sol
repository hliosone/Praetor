// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Execution, CALLTYPE_SINGLE, IERC7579Hook} from "../../src/interfaces/IERC7579.sol";

/// Minimal stand-in for a Safe7579 account in unit tests: runs the global hook around execute and
/// executeFromExecutor like the adapter does (msgData || caller). Fork tests use the real adapter.
contract MockAccount {
    address public hook;
    address public executor;

    function init(address hook_, address executor_) external {
        hook = hook_;
        executor = executor_;
    }

    function execute(bytes32 mode, bytes calldata exec) external {
        _run(mode, exec);
    }

    function executeFromExecutor(bytes32 mode, bytes calldata exec) external returns (bytes[] memory out) {
        require(msg.sender == executor, "not executor");
        _run(mode, exec);
        return out;
    }

    function _run(bytes32 mode, bytes calldata exec) internal {
        bytes memory hd = IERC7579Hook(hook).preCheck(msg.sender, msg.value, abi.encodePacked(msg.data, msg.sender));
        if (mode[0] == CALLTYPE_SINGLE) {
            _call(address(bytes20(exec[:20])), uint256(bytes32(exec[20:52])), exec[52:]);
        } else {
            Execution[] memory xs = abi.decode(exec, (Execution[]));
            for (uint256 i; i < xs.length; ++i) _call(xs[i].target, xs[i].value, xs[i].callData);
        }
        IERC7579Hook(hook).postCheck(hd);
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
