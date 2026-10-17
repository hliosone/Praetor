// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {IPaymaster, IEntryPointV07, PackedUserOperation, PostOpMode, packValidationData} from "./interfaces/IERC4337.sol";

/// @notice Our own verifying paymaster for EntryPoint v0.7, written from the spec (eth-infinitism's GPL
/// VerifyingPaymaster is not used). Users never hold ETH (Q21); the bundler's paymaster key signs only for accounts
/// registered in the api database (spec 03). paymasterAndData = paymaster (20) | verificationGasLimit (16) |
/// postOpGasLimit (16) | validUntil (6) | validAfter (6) | signature (65); the signed hash covers everything before
/// the signature (D20).
contract PraetorPaymaster is IPaymaster, Ownable {
    uint256 internal constant SIGNED_PREFIX = 64;

    IEntryPointV07 public immutable entryPoint;
    address public signer;

    error OnlyEntryPoint();

    event SignerSet(address signer);

    constructor(address entryPoint_, address owner_, address signer_) Ownable(owner_) {
        entryPoint = IEntryPointV07(entryPoint_);
        signer = signer_;
    }

    function getHash(PackedUserOperation calldata op) public view returns (bytes32) {
        return keccak256(abi.encode(
            op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData), op.accountGasLimits, op.preVerificationGas,
            op.gasFees, keccak256(op.paymasterAndData[:SIGNED_PREFIX]), block.chainid, address(this)
        ));
    }

    function validatePaymasterUserOp(PackedUserOperation calldata op, bytes32, uint256)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        bytes calldata pd = op.paymasterAndData;
        if (pd.length != SIGNED_PREFIX + 65) return ("", packValidationData(true, 0, 0));
        uint48 validUntil = uint48(bytes6(pd[52:58]));
        uint48 validAfter = uint48(bytes6(pd[58:64]));
        (address who, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(getHash(op)), pd[SIGNED_PREFIX:]);
        bool failed = err != ECDSA.RecoverError.NoError || who != signer;
        return ("", packValidationData(failed, validUntil, validAfter));
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
    }

    function setSigner(address signer_) external onlyOwner {
        signer = signer_;
        emit SignerSet(signer_);
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }
}
