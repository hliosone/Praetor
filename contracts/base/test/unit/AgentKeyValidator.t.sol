// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {AgentKeyValidator} from "../../src/AgentKeyValidator.sol";
import {PackedUserOperation, packValidationData} from "../../src/interfaces/IERC4337.sol";
import {Execution, IERC7579Account} from "../../src/interfaces/IERC7579.sol";
import {Calls} from "../utils/Calls.sol";

contract AgentKeyValidatorTest is Test {
    AgentKeyValidator internal v;
    address internal hook = makeAddr("hook");
    address internal account = makeAddr("account");
    address internal usdc = makeAddr("usdc");
    uint256 internal agentPk = uint256(keccak256("agent"));
    address internal agent = vm.addr(agentPk);
    uint48 internal until = uint48(block.timestamp + 1 days);
    bytes32 internal h = keccak256("userOpHash");

    function setUp() public {
        v = new AgentKeyValidator(hook);
        vm.prank(account);
        v.onInstall("");
        vm.prank(hook);
        v.setKey(account, agent, until);
    }

    function _op(bytes memory callData, uint256 pk) internal view returns (PackedUserOperation memory op) {
        op.sender = account;
        op.callData = callData;
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(h));
        op.signature = abi.encodePacked(r, s, vv);
    }

    function _validate(bytes memory callData, uint256 pk) internal returns (uint256) {
        vm.prank(account);
        return v.validateUserOp(_op(callData, pk), h);
    }

    function test_executeSignedByAgentPassesWithExpiry() public {
        assertEq(_validate(Calls.single(usdc, 0, hex"a9059cbb"), agentPk), packValidationData(false, until, 0));
    }

    function test_batchToOtherTargetsPasses() public {
        Execution[] memory xs = Calls.two(Execution(usdc, 0, hex"095ea7b3"), Execution(makeAddr("desk"), 0, hex"12345678"));
        assertEq(_validate(Calls.batch(xs), agentPk), packValidationData(false, until, 0));
    }

    /// I7: the agent key can never send module management calls.
    function test_refusesInstallAndUninstallModule() public {
        assertEq(_validate(abi.encodeCall(IERC7579Account.installModule, (4, address(1), "")), agentPk), 1);
        assertEq(_validate(abi.encodeCall(IERC7579Account.uninstallModule, (4, address(1), "")), agentPk), 1);
    }

    /// I7 + Q14: a module change is execute(self.installModule); the agent may never target the account itself.
    function test_refusesExecuteTargetingTheAccount() public {
        bytes memory inner = abi.encodeCall(IERC7579Account.uninstallModule, (4, hook, ""));
        assertEq(_validate(Calls.single(account, 0, inner), agentPk), 1);
        Execution[] memory xs = Calls.two(Execution(usdc, 0, hex"a9059cbb"), Execution(account, 0, inner));
        assertEq(_validate(Calls.batch(xs), agentPk), 1);
    }

    function test_refusesOtherCallTypes() public {
        bytes memory exec = abi.encodePacked(usdc, uint256(0), hex"a9059cbb");
        assertEq(_validate(Calls.withMode(bytes32(bytes1(0xff)), exec), agentPk), 1, "delegatecall");
        assertEq(_validate(Calls.withMode(bytes32(bytes1(0xfe)), exec), agentPk), 1, "staticcall");
    }

    function test_refusesShortAndUnknownCalldata() public {
        assertEq(_validate(hex"e9ae5c", agentPk), 1);
        assertEq(_validate(hex"deadbeef", agentPk), 1);
        assertEq(_validate(abi.encodeWithSelector(0xd9ed0e8f), agentPk), 1, "setupSafe is passkey only");
    }

    function test_refusesWrongSignerRevokedAndMissingKey() public {
        assertEq(_validate(Calls.single(usdc, 0, ""), uint256(keccak256("other"))), 1);
        vm.prank(hook);
        v.revoke(account);
        assertEq(_validate(Calls.single(usdc, 0, ""), agentPk), 1);
        address fresh = makeAddr("fresh");
        PackedUserOperation memory op = _op(Calls.single(usdc, 0, ""), agentPk);
        vm.prank(fresh);
        assertEq(v.validateUserOp(op, h), 1);
    }

    function test_refusesMalformedSignature() public {
        PackedUserOperation memory op = _op(Calls.single(usdc, 0, ""), agentPk);
        op.signature = hex"01";
        vm.prank(account);
        assertEq(v.validateUserOp(op, h), 1);
    }

    function test_onlyHookSetsAndRevokes() public {
        vm.expectRevert(AgentKeyValidator.OnlyHook.selector);
        v.setKey(account, agent, until);
        vm.expectRevert(AgentKeyValidator.OnlyHook.selector);
        v.revoke(account);
    }

    function test_setKeyRejectsZeroKeyAndZeroExpiry() public {
        vm.startPrank(hook);
        vm.expectRevert(AgentKeyValidator.InvalidKey.selector);
        v.setKey(account, address(0), until);
        vm.expectRevert(AgentKeyValidator.InvalidKey.selector);
        v.setKey(account, agent, 0);
        vm.stopPrank();
    }

    function test_setKeyAfterRevokeRestores() public {
        vm.startPrank(hook);
        v.revoke(account);
        v.setKey(account, agent, until);
        vm.stopPrank();
        (address key, uint48 vu, bool revoked) = v.agentOf(account);
        assertEq(key, agent);
        assertEq(vu, until);
        assertFalse(revoked);
    }

    function test_uninstallClears() public {
        vm.prank(account);
        v.onUninstall("");
        (address key,,) = v.agentOf(account);
        assertEq(key, address(0));
        assertFalse(v.isInitialized(account));
    }

    function test_moduleType() public view {
        assertTrue(v.isModuleType(1));
        assertFalse(v.isModuleType(4));
        assertTrue(v.isInitialized(account));
    }

    /// I16: never a valid ERC-1271 signature.
    function testFuzz_erc1271AlwaysInvalid(address sender, bytes32 hash, bytes calldata data) public view {
        assertEq(v.isValidSignatureWithSender(sender, hash, data), bytes4(0xffffffff));
    }
}
