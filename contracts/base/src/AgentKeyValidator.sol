// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {PackedUserOperation, packValidationData, SIG_VALIDATION_FAILED} from "./interfaces/IERC4337.sol";
import {
    IERC7579Validator, IERC7579Account, Execution, MODULE_TYPE_VALIDATOR, CALLTYPE_SINGLE, CALLTYPE_BATCH, ERC1271_INVALID
} from "./interfaces/IERC7579.sol";

/// @notice Validates userOps signed by the agent's secp256k1 key, which lives in the agent-signer TEE (spec 03).
/// The agent may only send `execute`, never to the account itself: module changes are
/// `execute(self.installModule/uninstallModule)` and need the owner and the bank (I7, Q14). Keys are written only
/// by MandateHook (SET_AGENT_KEY, REVOKE_AGENT_KEY, recovery).
contract AgentKeyValidator is IERC7579Validator {
    struct Agent {
        address key;
        uint48 validUntil;
        bool revoked;
    }

    address public immutable hook;
    mapping(address account => Agent) internal agents;
    mapping(address account => bool) internal installed;

    error OnlyHook();
    error InvalidKey();

    event AgentKeySet(address indexed account, address key, uint48 validUntil);
    event AgentKeyRevoked(address indexed account);

    constructor(address hook_) {
        hook = hook_;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    function onInstall(bytes calldata) external {
        installed[msg.sender] = true;
    }

    function onUninstall(bytes calldata) external {
        delete agents[msg.sender];
        delete installed[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address account) external view returns (bool) {
        return installed[account];
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external view returns (uint256) {
        if (!_executeNotToSelf(userOp.callData, msg.sender)) return SIG_VALIDATION_FAILED;
        Agent memory a = agents[msg.sender];
        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(userOpHash), userOp.signature);
        if (a.key == address(0) || a.revoked || err != ECDSA.RecoverError.NoError || signer != a.key) {
            return SIG_VALIDATION_FAILED;
        }
        return packValidationData(false, a.validUntil, 0);
    }

    /// I16: the account never produces a valid ERC-1271 signature through this validator.
    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_INVALID;
    }

    function setKey(address account, address key, uint48 validUntil) external onlyHook {
        if (key == address(0) || validUntil == 0) revert InvalidKey();
        agents[account] = Agent(key, validUntil, false);
        emit AgentKeySet(account, key, validUntil);
    }

    function revoke(address account) external onlyHook {
        agents[account].revoked = true;
        emit AgentKeyRevoked(account);
    }

    function agentOf(address account) external view returns (address key, uint48 validUntil, bool revoked) {
        Agent memory a = agents[account];
        return (a.key, a.validUntil, a.revoked);
    }

    /// True only for `execute` with a single or batch call type whose targets never include `account`.
    function _executeNotToSelf(bytes calldata callData, address account) internal pure returns (bool) {
        if (callData.length < 4 || bytes4(callData[:4]) != IERC7579Account.execute.selector) return false;
        (bytes32 mode, bytes memory exec) = abi.decode(callData[4:], (bytes32, bytes));
        if (mode[0] == CALLTYPE_SINGLE) {
            if (exec.length < 20) return false;
            address target;
            assembly ("memory-safe") {
                target := shr(96, mload(add(exec, 32)))
            }
            return target != account;
        }
        if (mode[0] == CALLTYPE_BATCH) {
            Execution[] memory xs = abi.decode(exec, (Execution[]));
            for (uint256 i; i < xs.length; ++i) if (xs[i].target == account) return false;
            return true;
        }
        return false;
    }
}
