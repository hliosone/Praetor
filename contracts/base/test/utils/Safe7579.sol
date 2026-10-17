// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

// Own minimal interfaces for the deployed Safe 1.4.1, Safe7579 launchpad and FiatToken, written from the deployed
// ABIs for the fork tests (no GPL or LGPL source copied).

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

interface ISafe7579Launchpad {
    function preValidationSetup(bytes32 initHash, address to, bytes calldata preInit) external;
    function setupSafe(LaunchpadInitData calldata initData) external;
    function initSafe7579(
        address safe7579, ModuleInit[] calldata executors, ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,
        address[] calldata attesters, uint8 threshold
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
}

interface IAccount7579 {
    function execute(bytes32 mode, bytes calldata executionCalldata) external;
    function installModule(uint256 moduleType, address module, bytes calldata initData) external;
    function uninstallModule(uint256 moduleType, address module, bytes calldata deInitData) external;
    function isModuleInstalled(uint256 moduleType, address module, bytes calldata context) external view returns (bool);
    function setRegistry(address registry, address[] calldata attesters, uint8 threshold) external;
    function isValidSignature(bytes32 hash, bytes calldata data) external view returns (bytes4);
}

interface IFiatToken {
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 allowance) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external;
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes memory signature
    ) external;
}
