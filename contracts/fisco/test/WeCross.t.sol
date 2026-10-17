// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {BaseOutbox} from "../src/BaseOutbox.sol";
import {BoardBase} from "./BoardBase.sol";

/// Records interchain requests like WeCrossHub.interchainInvoke (spec 04, V4).
contract HubMock {
    string[] public lastArgs;
    string public lastPath;
    string public lastMethod;
    string public lastCallbackPath;
    string public lastCallbackMethod;
    uint256 public calls;

    function interchainInvoke(string calldata path, string calldata method, string[] calldata args, string calldata callbackPath, string calldata callbackMethod)
        external
        returns (string memory)
    {
        lastPath = path;
        lastMethod = method;
        delete lastArgs;
        for (uint256 i; i < args.length; ++i) lastArgs.push(args[i]);
        lastCallbackPath = callbackPath;
        lastCallbackMethod = callbackMethod;
        ++calls;
        return "uid-1";
    }

    function argsLength() external view returns (uint256) {
        return lastArgs.length;
    }
}

contract WeCrossTest is BoardBase {
    HubMock internal hub;
    address internal fiscoProxy = makeAddr("fisco WeCrossProxy");

    function setUp() public override {
        super.setUp();
        hub = new HubMock();
        outbox.setHub(address(hub), fiscoProxy);
    }

    function _openFreeze(address who) internal returns (uint256 id, P.StatusAttestation memory a) {
        vm.prank(regFisco);
        id = status.openStatus(who, 2, _dl());
        a = abi.decode(status.proposal(id).fields, (P.StatusAttestation));
    }

    function _readyFreeze() internal returns (P.StatusAttestation memory a, bytes memory sig) {
        uint256 id;
        (id, a) = _openFreeze(makeAddr("account"));
        sig = _sig(regSignerPk, _digest(P.hash(a)));
        status.sign(id, sig);
    }

    function test_theRouterRequestsDeliveryOfAPendingMessageThroughTheHub() public {
        (P.StatusAttestation memory a, bytes memory sig) = _readyFreeze();
        vm.prank(router);
        outbox.requestWeCross(0);
        assertEq(hub.lastPath(), "payment.base.inbox");
        assertEq(hub.lastMethod(), "deliver");
        assertEq(hub.lastCallbackPath(), "payment.fisco.outbox");
        assertEq(hub.lastCallbackMethod(), "onDelivered");
        assertEq(hub.argsLength(), 3);
        assertEq(hub.lastArgs(0), "Status");
        // What WeCrossInbox.deliver decodes on Base: abi.encode(attestation, bytes[] sigs), as hex.
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;
        assertEq(hub.lastArgs(1), vm.toString(abi.encode(a, sigs)));
        assertEq(hub.lastArgs(2), "0");
    }

    function test_onlyTheRouterAccountRequests_onceAndNeverForADeliveredMessage() public {
        _readyFreeze();
        vm.expectRevert(BaseOutbox.OnlyRouter.selector);
        outbox.requestWeCross(0);
        vm.prank(router);
        outbox.requestWeCross(0);
        vm.prank(router);
        vm.expectRevert(BaseOutbox.AlreadyRequested.selector);
        outbox.requestWeCross(0);
        _readyFreezeAgain();
        vm.prank(relayer);
        outbox.markDelivered(1, bytes32(uint256(1)), 0);
        vm.prank(router);
        vm.expectRevert(BaseOutbox.AlreadyDelivered.selector);
        outbox.requestWeCross(1);
    }

    function _readyFreezeAgain() internal {
        (uint256 id, P.StatusAttestation memory a) = _openFreeze(makeAddr("account 2"));
        status.sign(id, _sig(regSignerPk, _digest(P.hash(a))));
    }

    function test_theHubIsSetOnceByTheDeployer_andTheCallbackComesOnlyFromTheFiscoProxy() public {
        vm.expectRevert(BaseOutbox.HubSet.selector);
        outbox.setHub(address(1), address(2));
        vm.prank(makeAddr("anyone"));
        vm.expectRevert(BaseOutbox.OnlyDeployer.selector);
        outbox.setHub(address(1), address(2));
        string[] memory result = new string[](2);
        result[0] = "ok";
        result[1] = "1";
        vm.expectRevert(BaseOutbox.OnlyHubProxy.selector);
        outbox.onDelivered(true, result);
        vm.prank(fiscoProxy);
        string[] memory out = outbox.onDelivered(true, result);
        assertEq(out[0], "ok");
    }

    function test_withoutAHubThereIsNoWeCrossRequest() public {
        BaseOutbox bare = new BaseOutbox(address(registry));
        vm.prank(router);
        vm.expectRevert(BaseOutbox.NoHub.selector);
        bare.requestWeCross(0);
    }
}
