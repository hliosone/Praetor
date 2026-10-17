// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {PackedUserOperation, SIG_VALIDATION_FAILED} from "./interfaces/IERC4337.sol";
import {
    IERC7579Validator, IERC7579Account, ISafe7579LaunchpadSetup, MODULE_TYPE_VALIDATOR, ERC1271_INVALID
} from "./interfaces/IERC7579.sol";

/// @notice Owner passkeys (P-256, up to 4 per account) verified with Coinbase WebAuthn.sol on the RIP-7212
/// precompile (spec 03). Accepts only `execute` and the launchpad's `setupSafe`: raw `installModule` /
/// `uninstallModule` would let the passkey alone remove the hook, because Safe7579 skips the hook when the hook
/// itself is uninstalled (V1 T1, Q14, I1). Keys are changed only by MandateHook (SET_OWNER_KEY, recovery).
contract PasskeyValidator is IERC7579Validator {
    struct Key {
        uint256 x;
        uint256 y;
    }

    uint256 public constant MAX_KEYS = 4;

    address public immutable hook;
    mapping(address account => mapping(bytes32 credIdHash => Key)) internal keys;
    mapping(address account => bytes32[]) internal creds;

    error OnlyHook();
    error InvalidKey();
    error AlreadyInstalled();
    error TooManyKeys();
    error LastKey();
    error UnknownKey();

    event OwnerKeySet(address indexed account, bytes32 indexed credIdHash, uint256 x, uint256 y);

    constructor(address hook_) {
        hook = hook_;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    function onInstall(bytes calldata data) external {
        if (creds[msg.sender].length != 0) revert AlreadyInstalled();
        (bytes32 credIdHash, uint256 x, uint256 y) = abi.decode(data, (bytes32, uint256, uint256));
        if (x == 0 && y == 0) revert InvalidKey();
        _add(msg.sender, credIdHash, x, y);
    }

    function onUninstall(bytes calldata) external {
        _clear(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address account) external view returns (bool) {
        return creds[account].length != 0;
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external view returns (uint256) {
        if (userOp.callData.length < 4) return SIG_VALIDATION_FAILED;
        bytes4 sel = bytes4(userOp.callData[:4]);
        if (sel != IERC7579Account.execute.selector && sel != ISafe7579LaunchpadSetup.setupSafe.selector) {
            return SIG_VALIDATION_FAILED;
        }
        (bytes32 credIdHash, WebAuthn.WebAuthnAuth memory auth) = abi.decode(userOp.signature, (bytes32, WebAuthn.WebAuthnAuth));
        Key memory k = keys[msg.sender][credIdHash];
        if (k.x == 0 && k.y == 0) return SIG_VALIDATION_FAILED;
        return WebAuthn.verify(abi.encode(userOpHash), true, auth, k.x, k.y) ? 0 : SIG_VALIDATION_FAILED;
    }

    /// I16: the account never produces a valid ERC-1271 signature through this validator.
    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_INVALID;
    }

    /// Adds or rotates a key; x = y = 0 removes it, never the last one (SET_OWNER_KEY).
    function setKey(address account, bytes32 credIdHash, uint256 x, uint256 y) external onlyHook {
        bool exists = keys[account][credIdHash].x != 0 || keys[account][credIdHash].y != 0;
        if (x == 0 && y == 0) {
            if (!exists) revert UnknownKey();
            if (creds[account].length == 1) revert LastKey();
            _remove(account, credIdHash);
        } else if (exists) {
            keys[account][credIdHash] = Key(x, y);
            emit OwnerKeySet(account, credIdHash, x, y);
        } else {
            if (creds[account].length >= MAX_KEYS) revert TooManyKeys();
            _add(account, credIdHash, x, y);
        }
    }

    /// Recovery: every owner key is replaced by the new one.
    function replaceAllKeys(address account, bytes32 credIdHash, uint256 x, uint256 y) external onlyHook {
        if (x == 0 && y == 0) revert InvalidKey();
        _clear(account);
        _add(account, credIdHash, x, y);
    }

    function ownerKey(address account, bytes32 credIdHash) external view returns (uint256 x, uint256 y) {
        Key memory k = keys[account][credIdHash];
        return (k.x, k.y);
    }

    function keyCount(address account) external view returns (uint256) {
        return creds[account].length;
    }

    function credsOf(address account) external view returns (bytes32[] memory) {
        return creds[account];
    }

    function _add(address account, bytes32 credIdHash, uint256 x, uint256 y) internal {
        keys[account][credIdHash] = Key(x, y);
        creds[account].push(credIdHash);
        emit OwnerKeySet(account, credIdHash, x, y);
    }

    function _remove(address account, bytes32 credIdHash) internal {
        delete keys[account][credIdHash];
        bytes32[] storage list = creds[account];
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == credIdHash) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        emit OwnerKeySet(account, credIdHash, 0, 0);
    }

    function _clear(address account) internal {
        bytes32[] storage list = creds[account];
        for (uint256 i; i < list.length; ++i) delete keys[account][list[i]];
        delete creds[account];
    }
}
