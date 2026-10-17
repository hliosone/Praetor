// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {PraetorPaymaster} from "../../src/PraetorPaymaster.sol";
import {PackedUserOperation, packValidationData, PostOpMode} from "../../src/interfaces/IERC4337.sol";
import {EntryPointMock} from "../utils/EntryPointMock.sol";

contract PraetorPaymasterTest is Test {
    EntryPointMock internal ep;
    PraetorPaymaster internal pm;
    uint256 internal signerPk = uint256(keccak256("paymaster signer"));
    address internal signer = vm.addr(signerPk);
    address internal owner = makeAddr("owner");

    function setUp() public {
        vm.warp(1_800_000_000);
        ep = new EntryPointMock();
        pm = new PraetorPaymaster(address(ep), owner, signer);
    }

    function _op(uint48 validUntil, uint48 validAfter, uint256 pk) internal returns (PackedUserOperation memory op) {
        op.sender = makeAddr("account");
        op.nonce = 7;
        op.callData = hex"e9ae5c53";
        op.accountGasLimits = bytes32(uint256(500_000) << 128 | 500_000);
        op.preVerificationGas = 60_000;
        op.gasFees = bytes32(uint256(1 gwei) << 128 | 2 gwei);
        op.paymasterAndData = abi.encodePacked(address(pm), uint128(100_000), uint128(50_000), validUntil, validAfter, new bytes(65));
        bytes32 h = pm.getHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(h));
        op.paymasterAndData = abi.encodePacked(address(pm), uint128(100_000), uint128(50_000), validUntil, validAfter, r, s, v);
    }

    function _validate(PackedUserOperation memory op) internal returns (uint256 vd) {
        vm.prank(address(ep));
        (, vd) = pm.validatePaymasterUserOp(op, bytes32(0), 1e15);
    }

    function test_sponsorsAnOpSignedByTheSigner() public {
        uint48 until = uint48(block.timestamp + 600);
        assertEq(_validate(_op(until, 0, signerPk)), packValidationData(false, until, 0));
    }

    function test_wrongSignerOrTamperedOpFails() public {
        uint48 until = uint48(block.timestamp + 600);
        assertEq(_validate(_op(until, 0, uint256(keccak256("other")))), packValidationData(true, until, 0));
        PackedUserOperation memory op = _op(until, 0, signerPk);
        op.callData = hex"e9ae5c54";
        assertEq(_validate(op) & 1, 1);
        op = _op(until, 0, signerPk);
        op.nonce = 8;
        assertEq(_validate(op) & 1, 1);
    }

    function test_hashBindsChainAndPaymaster() public {
        PackedUserOperation memory op = _op(0, 0, signerPk);
        bytes32 h = pm.getHash(op);
        vm.chainId(1);
        assertTrue(pm.getHash(op) != h);
    }

    function test_malformedPaymasterDataFails() public {
        PackedUserOperation memory op = _op(0, 0, signerPk);
        op.paymasterAndData = abi.encodePacked(address(pm), uint128(1), uint128(1));
        assertEq(_validate(op) & 1, 1);
    }

    function test_onlyEntryPoint() public {
        PackedUserOperation memory op = _op(0, 0, signerPk);
        vm.expectRevert(PraetorPaymaster.OnlyEntryPoint.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
        vm.expectRevert(PraetorPaymaster.OnlyEntryPoint.selector);
        pm.postOp(PostOpMode.opSucceeded, "", 0, 0);
        vm.prank(address(ep));
        pm.postOp(PostOpMode.opSucceeded, "", 0, 0);
    }

    function test_ownerManagesSignerAndDeposit() public {
        vm.deal(owner, 1 ether);
        vm.startPrank(owner);
        pm.deposit{value: 0.5 ether}();
        assertEq(ep.balanceOf(address(pm)), 0.5 ether);
        pm.withdrawTo(payable(owner), 0.2 ether);
        assertEq(owner.balance, 0.7 ether);
        pm.setSigner(makeAddr("new signer"));
        vm.stopPrank();
        assertEq(pm.signer(), makeAddr("new signer"));
        vm.expectRevert();
        pm.setSigner(address(1));
    }
}
