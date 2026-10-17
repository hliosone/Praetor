// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

// Own minimal interfaces for the deployed ERC-4337 v0.7 EntryPoint, Safe7579 adapter and launchpad.
// Written from the ERC texts and the deployed ABIs; no GPL source is copied.

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

struct Execution {
    address target;
    uint256 value;
    bytes callData;
}

struct ModuleInit {
    address module;
    bytes initData;
}

// Field order must match the launchpad's InitData (part of its initHash).
struct LaunchpadInitData {
    address singleton;
    address[] owners;
    uint256 threshold;
    address setupTo;
    bytes setupData;
    address safe7579;
    ModuleInit[] validators;
    bytes callData;
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
}

interface IERC7579Account {
    function execute(bytes32 mode, bytes calldata executionCalldata) external;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external returns (bytes[] memory);
    function installModule(uint256 moduleType, address module, bytes calldata initData) external;
    function uninstallModule(uint256 moduleType, address module, bytes calldata deInitData) external;
    function isModuleInstalled(uint256 moduleType, address module, bytes calldata context) external view returns (bool);
    function setRegistry(address registry, address[] calldata attesters, uint8 threshold) external;
    function isValidSignature(bytes32 hash, bytes calldata data) external view returns (bytes4);
}

interface ISafe7579Launchpad {
    function preValidationSetup(bytes32 initHash, address to, bytes calldata preInit) external;
    function setupSafe(LaunchpadInitData calldata initData) external;
    function initSafe7579(
        address safe7579,
        ModuleInit[] calldata executors,
        ModuleInit[] calldata fallbacks,
        ModuleInit[] calldata hooks,
        address[] calldata attesters,
        uint8 threshold
    ) external;
    function hash(LaunchpadInitData memory data) external pure returns (bytes32);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
    function proxyCreationCode() external pure returns (bytes memory);
}

interface ISafe {
    function execTransaction(
        address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures
    ) external payable returns (bool);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce
    ) external view returns (bytes32);
    function isModuleEnabled(address module) external view returns (bool);
}

interface IModule {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 typeId) external view returns (bool);
    function isInitialized(address account) external view returns (bool);
}
