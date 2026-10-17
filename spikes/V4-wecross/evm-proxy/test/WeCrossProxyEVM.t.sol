// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {WeCrossProxyEVM} from "../src/WeCrossProxyEVM.sol";

// Stand-in for WeCrossInbox: the string[] f(string[]) shape WeCross delivers to.
contract DummyInbox {
    uint256 public calls;
    string public lastType;

    function deliver(string[] memory args) public returns (string[] memory r) {
        calls++;
        lastType = args[0];
        r = new string[](2);
        r[0] = "ok";
        r[1] = args[0];
    }

    function peek(string[] memory args) public pure returns (string[] memory r) {
        r = new string[](1);
        r[0] = args[0];
    }
}

contract Stranger {
    function trySetPath(WeCrossProxyEVM p, address t) external returns (bool ok) {
        (ok,) = address(p).call(abi.encodeWithSelector(WeCrossProxyEVM.setPath.selector, "inbox", t));
    }
}

// No forge-std: plain require-based assertions keep the spike free of vendored libraries.
contract WeCrossProxyEVMTest {
    WeCrossProxyEVM proxy;
    DummyInbox inbox;

    function setUp() public {
        proxy = new WeCrossProxyEVM();
        inbox = new DummyInbox();
        proxy.setPath("inbox", address(inbox));
    }

    function _args() internal pure returns (string[] memory a) {
        a = new string[](2);
        a[0] = "Status";
        a[1] = "0xabcdef";
    }

    function test_sendTransactionRoutesByName() public {
        bytes memory out = proxy.sendTransaction("uid-1", "inbox", abi.encodeWithSignature("deliver(string[])", _args()));
        string[] memory r = abi.decode(out, (string[]));
        require(keccak256(bytes(r[0])) == keccak256("ok") && keccak256(bytes(r[1])) == keccak256("Status"), "result");
        require(inbox.calls() == 1, "calls");
    }

    function test_sameUidIsNotDeliveredTwice() public {
        bytes memory data = abi.encodeWithSignature("deliver(string[])", _args());
        proxy.sendTransaction("uid-1", "inbox", data);
        proxy.sendTransaction("uid-1", "inbox", data);
        require(inbox.calls() == 1, "replayed");
    }

    function test_constantCall() public {
        bytes memory out = proxy.constantCall("inbox", abi.encodeWithSignature("peek(string[])", _args()));
        require(keccak256(bytes(abi.decode(out, (string[]))[0])) == keccak256("Status"), "peek");
    }

    function test_unknownNameReverts() public {
        (bool ok,) = address(proxy).call(
            abi.encodeWithSelector(WeCrossProxyEVM.sendTransaction.selector, "uid-2", "nope", abi.encodeWithSignature("deliver(string[])", _args()))
        );
        require(!ok, "unknown name accepted");
    }

    function test_onlyOwnerSetsPaths() public {
        require(!new Stranger().trySetPath(proxy, address(0xBEEF)), "stranger set a path");
    }

    function test_linkBfsParsesAddressAndReadlinkAnswers() public {
        proxy.linkBFS("payment.base.inbox2", "0x00000000000000000000000000000000DeaDBeef", "[]");
        (string memory v, string memory a,) = proxy.readlink("inbox2");
        require(keccak256(bytes(v)) == keccak256("latest"), "version");
        require(keccak256(bytes(a)) == keccak256("0x00000000000000000000000000000000deadbeef"), a);
    }

    function test_xaStateIsNullForAnUnlockedResource() public view {
        // The router calls getXATransactionState(<target path>) on the target chain's proxy before delivering.
        require(keccak256(bytes(proxy.getXATransactionState("payment.base.inbox"))) == keccak256("null"), "xa state");
    }
}
