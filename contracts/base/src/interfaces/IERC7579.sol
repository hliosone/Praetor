// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PackedUserOperation} from "./IERC4337.sol";

// Own ERC-7579 interfaces (module types and the account subset we use), written from the ERC text.

struct Execution {
    address target;
    uint256 value;
    bytes callData;
}

uint256 constant MODULE_TYPE_VALIDATOR = 1;
uint256 constant MODULE_TYPE_EXECUTOR = 2;
uint256 constant MODULE_TYPE_FALLBACK = 3;
uint256 constant MODULE_TYPE_HOOK = 4;

// Execution mode: callType (1 byte) | execType (1 byte) | unused (4) | modeSelector (4) | modePayload (22).
bytes1 constant CALLTYPE_SINGLE = 0x00;
bytes1 constant CALLTYPE_BATCH = 0x01;
bytes32 constant MODE_SINGLE = bytes32(0);
bytes32 constant MODE_BATCH = bytes32(uint256(1) << 248);

interface IERC7579Module {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
}

interface IERC7579Validator is IERC7579Module {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external returns (uint256);
    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata data) external view returns (bytes4);
}

interface IERC7579Hook is IERC7579Module {
    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData) external returns (bytes memory hookData);
    function postCheck(bytes calldata hookData) external;
}

interface IERC7579Account {
    function execute(bytes32 mode, bytes calldata executionCalldata) external;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external returns (bytes[] memory);
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata context) external view returns (bool);
}

/// The launchpad's first-op entry point; PasskeyValidator accepts it (Q16) so an account can be created.
interface ISafe7579LaunchpadSetup {
    struct ModuleInit {
        address module;
        bytes initData;
    }

    struct InitData {
        address singleton;
        address[] owners;
        uint256 threshold;
        address setupTo;
        bytes setupData;
        address safe7579;
        ModuleInit[] validators;
        bytes callData;
    }

    function setupSafe(InitData calldata initData) external;
}

bytes4 constant ERC1271_INVALID = 0xffffffff;
