// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

// Own ERC-4337 v0.7 types and the EntryPoint subset we call, written from the ERC text (no GPL source copied).

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPointV07 {
    event UserOperationEvent(
        bytes32 indexed userOpHash, address indexed sender, address indexed paymaster,
        uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed
    );
    event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason);

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
    function getNonce(address sender, uint192 key) external view returns (uint256);
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
}

enum PostOpMode { opSucceeded, opReverted, postOpReverted }

interface IPaymaster {
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        external returns (bytes memory context, uint256 validationData);
    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas) external;
}

/// validationData = sigFailed (1 bit, as 0/1 in the low 160 bits) | validUntil (48 bits) << 160 | validAfter (48 bits) << 208.
function packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter) pure returns (uint256) {
    return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
}

uint256 constant SIG_VALIDATION_FAILED = 1;
