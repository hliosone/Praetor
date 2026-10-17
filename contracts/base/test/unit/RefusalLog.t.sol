// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IRefusalLogEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution} from "../../src/interfaces/IERC7579.sol";
import {RefusalLog} from "../../src/RefusalLog.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {Calls} from "../utils/Calls.sol";

/// I11: the reason in RefusalLog is computed by the hook's check(); the reporter only claims the userOpHash.
contract RefusalLogTest is LinScenario, IRefusalLogEvents {
    RefusalLog internal refusals;
    address internal bundler = makeAddr("bundler");

    function setUp() public override {
        super.setUp();
        refusals = new RefusalLog(address(hook));
    }

    function test_logsTheReasonTheHookComputes() public {
        Execution memory x = _transfer(makeAddr("stranger"), 150e6);
        bytes32 ch = P.callHash(account, x.target, 0, x.callData);
        vm.expectEmit(address(refusals));
        emit Refused(keccak256("op"), account, ch, uint8(P.Reason.UNKNOWN_PAYEE), 2, address(usdc), bundler);
        vm.prank(bundler);
        refusals.log(keccak256("op"), account, x.target, 0, x.callData);
    }

    function test_refusesToLogAnAllowedCall() public {
        Execution memory x = _transfer(landlord, 150e6);
        vm.expectRevert(RefusalLog.NotRefused.selector);
        refusals.log(keccak256("op"), account, x.target, 0, x.callData);
    }

    function test_batchLogsTheFirstRefusedCall() public {
        Execution[] memory xs = Calls.two(_transfer(landlord, 150e6), _transfer(landlord, 2_500e6));
        bytes32 ch = P.callHash(account, xs[1].target, 0, xs[1].callData);
        vm.expectEmit(address(refusals));
        emit Refused(keccak256("op"), account, ch, uint8(P.Reason.OVER_HARD_CAP), 0, address(usdc), address(this));
        refusals.logBatch(keccak256("op"), account, xs);
        vm.expectRevert(RefusalLog.NotRefused.selector);
        refusals.logBatch(keccak256("op"), account, Calls.one(_transfer(landlord, 1e6)));
    }

    function testFuzz_reasonAlwaysMatchesCheck(uint256 amount, address to) public {
        Execution memory x = _transfer(to, amount);
        (uint8 r, uint8 t, bytes32 ch) = hook.check(account, x.target, 0, x.callData);
        if (r == 0) {
            vm.expectRevert(RefusalLog.NotRefused.selector);
        } else {
            vm.expectEmit(address(refusals));
            emit Refused(bytes32(0), account, ch, r, t, x.target, address(this));
        }
        refusals.log(bytes32(0), account, x.target, 0, x.callData);
    }
}
