// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {PackedUserOperation, Execution, IERC7579Account, ISafe7579Launchpad} from "./Interfaces.sol";

bytes4 constant EXECUTE = IERC7579Account.execute.selector;
bytes4 constant EXECUTE_FROM_EXECUTOR = IERC7579Account.executeFromExecutor.selector;
bytes4 constant INSTALL_MODULE = IERC7579Account.installModule.selector;
bytes4 constant UNINSTALL_MODULE = IERC7579Account.uninstallModule.selector;
// The launchpad's first userOp carries setupSafe(InitData); the spec's selector list misses it.
bytes4 constant SETUP_SAFE = ISafe7579Launchpad.setupSafe.selector;
bytes4 constant ERC1271_INVALID = 0xffffffff;

/// Safe native owner that can never sign: closes execTransaction and the owner-signature fallbacks.
contract NoOwner {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) { return ERC1271_INVALID; }
    function isValidSignature(bytes calldata, bytes calldata) external pure returns (bytes4) { return ERC1271_INVALID; }
}

/// Minimal spike version of PasskeyValidator (spec 03): one P-256 key per account, WebAuthn.sol verify.
contract SpikePasskeyValidator {
    struct Key { uint256 x; uint256 y; }
    mapping(address account => mapping(bytes32 credIdHash => Key)) public keys;
    mapping(address account => uint256) public keyCount;

    function onInstall(bytes calldata data) external {
        (bytes32 credIdHash, uint256 x, uint256 y) = abi.decode(data, (bytes32, uint256, uint256));
        keys[msg.sender][credIdHash] = Key(x, y);
        keyCount[msg.sender] += 1;
    }
    function onUninstall(bytes calldata) external { keyCount[msg.sender] = 0; }
    function isModuleType(uint256 t) external pure returns (bool) { return t == 1; }
    function isInitialized(address a) external view returns (bool) { return keyCount[a] > 0; }

    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash) external view returns (uint256) {
        if (op.callData.length < 4) return 1;
        bytes4 sel = bytes4(op.callData[:4]);
        if (sel != EXECUTE && sel != INSTALL_MODULE && sel != UNINSTALL_MODULE && sel != SETUP_SAFE) return 1;
        (bytes32 credIdHash, WebAuthn.WebAuthnAuth memory auth) = abi.decode(op.signature, (bytes32, WebAuthn.WebAuthnAuth));
        Key memory k = keys[msg.sender][credIdHash];
        if (k.x == 0 && k.y == 0) return 1;
        return WebAuthn.verify(abi.encode(userOpHash), true, auth, k.x, k.y) ? 0 : 1;
    }

    // I16: never a valid ERC-1271 signature, whatever the payload.
    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure returns (bytes4) { return ERC1271_INVALID; }
}

/// Minimal spike version of AgentKeyValidator (spec 03): secp256k1 session key, execute only.
contract SpikeAgentKeyValidator {
    struct Agent { address key; uint48 validUntil; bool revoked; }
    mapping(address account => Agent) public agents;
    address public immutable admin; // stands in for MandateHook in the spike

    constructor(address _admin) { admin = _admin; }

    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external { delete agents[msg.sender]; }
    function isModuleType(uint256 t) external pure returns (bool) { return t == 1; }
    function isInitialized(address) external pure returns (bool) { return true; }

    function setKey(address account, address key, uint48 validUntil) external {
        require(msg.sender == admin, "only admin");
        agents[account] = Agent(key, validUntil, false);
    }

    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash) external view returns (uint256) {
        if (op.callData.length < 4 || bytes4(op.callData[:4]) != EXECUTE) return 1;
        Agent memory a = agents[msg.sender];
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(userOpHash), op.signature);
        if (a.key == address(0) || a.revoked || err != ECDSA.RecoverError.NoError || signer != a.key) return 1;
        return uint256(a.validUntil) << 160;
    }

    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure returns (bytes4) { return ERC1271_INVALID; }
}

/// Records what Safe7579 passes to a global hook, and can be told to refuse, to show which paths are hooked.
contract ProbeHook {
    event PreCheck(address indexed account, address msgSender, uint256 msgValue, bytes msgData);
    event PostCheck(address indexed account);

    mapping(address account => bytes) public lastMsgData;
    mapping(address account => address) public lastMsgSender;
    mapping(address account => uint256) public preChecks;
    mapping(address account => bool) public installed;
    // Mimics MandateHook rule 5 (target == account => HIDDEN_CALL) and the TIER3 gate on module changes.
    bool public refuseSelfTarget;
    bool public refuseModuleChanges;

    error Refused(string why);

    function configure(bool selfTarget, bool moduleChanges) external { refuseSelfTarget = selfTarget; refuseModuleChanges = moduleChanges; }

    function onInstall(bytes calldata) external { installed[msg.sender] = true; }
    // MandateHook will only allow uninstall when its own transient flag is set; the probe always refuses.
    function onUninstall(bytes calldata) external pure { revert Refused("onUninstall"); }
    function isModuleType(uint256 t) external pure returns (bool) { return t == 4; }
    function isInitialized(address a) external view returns (bool) { return installed[a]; }

    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData) external returns (bytes memory) {
        lastMsgData[msg.sender] = msgData;
        lastMsgSender[msg.sender] = msgSender;
        preChecks[msg.sender] += 1;
        emit PreCheck(msg.sender, msgSender, msgValue, msgData);
        bytes4 sel = bytes4(msgData[:4]);
        if (refuseModuleChanges && (sel == INSTALL_MODULE || sel == UNINSTALL_MODULE)) revert Refused("module change");
        if (refuseSelfTarget && sel == EXECUTE) {
            // msgData = execute(mode, exec) || 20-byte caller; strip the suffix before decoding.
            (bytes32 mode, bytes memory exec) = abi.decode(msgData[4:msgData.length - 20], (bytes32, bytes));
            if (mode[0] == 0x00) {
                address target;
                assembly { target := shr(96, mload(add(exec, 32))) }
                if (target == msg.sender) revert Refused("self call");
            } else if (mode[0] == 0x01) {
                Execution[] memory xs = abi.decode(exec, (Execution[]));
                for (uint256 i; i < xs.length; i++) if (xs[i].target == msg.sender) revert Refused("self call");
            } else {
                revert Refused("call type");
            }
        }
        return "";
    }

    function postCheck(bytes calldata) external { emit PostCheck(msg.sender); }
}

/// Executor (type 2) used to reach executeFromExecutor.
contract ProbeExecutor {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}
    function isModuleType(uint256 t) external pure returns (bool) { return t == 2; }
    function isInitialized(address) external pure returns (bool) { return true; }

    function run(address account, bytes32 mode, bytes calldata exec) external returns (bytes[] memory) {
        return IERC7579Account(account).executeFromExecutor(mode, exec);
    }
}
