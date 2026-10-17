// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test, Vm, console2} from "forge-std/Test.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import "../src/Interfaces.sol";
import "../src/Modules.sol";

interface IFiatToken {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function version() external view returns (string memory);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external;
    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes memory signature
    ) external;
}

/// V1: the account creation path of spec 00 and the hook coverage invariants I1, I16, I17 on a Base Sepolia fork.
contract V1Test is Test {
    IEntryPointV07 constant EP = IEntryPointV07(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
    address constant ADAPTER = 0x7579EE8307284F293B1927136486880611F20002;
    address constant LAUNCHPAD = 0x7579011aB74c46090561ea277Ba79D510c6C00ff;
    address constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67; // Safe 1.4.1 proxy factory
    address constant SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a; // Safe 1.4.1 singleton
    address constant ATTESTER = 0x000000333034E9f539ce08819E12c1b8Cb29084d;
    IFiatToken constant USDC = IFiatToken(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    uint256 constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes32 constant BATCH = bytes32(uint256(1) << 248);
    bytes32 constant SINGLE = bytes32(0);
    bytes32 constant OP_EVENT = keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");
    bytes32 constant OP_REVERT = keccak256("UserOperationRevertReason(bytes32,address,uint256,bytes)");

    NoOwner noOwner;
    SpikePasskeyValidator passkeyV;
    SpikeAgentKeyValidator agentV;
    ProbeHook hook;
    ProbeExecutor executor;

    uint256 p256Pk = 0x1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988;
    uint256 px;
    uint256 py;
    bytes32 credIdHash = keccak256("spike-credential");
    uint256 agentPk = 0xA11CE;
    address bundler = makeAddr("bundler");

    struct OpResult { bool success; uint256 gasUsed; bytes revertReason; bool found; }

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://sepolia.base.org")));
        noOwner = new NoOwner();
        passkeyV = new SpikePasskeyValidator();
        agentV = new SpikeAgentKeyValidator(address(this));
        hook = new ProbeHook();
        executor = new ProbeExecutor();
        (px, py) = vm.publicKeyP256(p256Pk);
        vm.deal(bundler, 1 ether);
    }

    // ---------------------------------------------------------------- account creation helpers

    function _initData(Execution[] memory execs) internal view returns (LaunchpadInitData memory d) {
        address[] memory owners = new address[](1);
        owners[0] = address(noOwner);
        address[] memory attesters = new address[](1);
        attesters[0] = ATTESTER; // GS000 fix: the launchpad always configures the registry, so >= 1 attester
        ModuleInit[] memory none = new ModuleInit[](0);
        ModuleInit[] memory validators = new ModuleInit[](2);
        validators[0] = ModuleInit(address(passkeyV), abi.encode(credIdHash, px, py));
        validators[1] = ModuleInit(address(agentV), "");
        d = LaunchpadInitData({
            singleton: SINGLETON,
            owners: owners,
            threshold: 1,
            setupTo: LAUNCHPAD,
            setupData: abi.encodeCall(ISafe7579Launchpad.initSafe7579, (ADAPTER, none, none, none, attesters, 1)),
            safe7579: ADAPTER,
            validators: validators,
            callData: abi.encodeCall(IERC7579Account.execute, (BATCH, abi.encode(execs)))
        });
    }

    function _initializer(LaunchpadInitData memory d) internal view returns (bytes memory) {
        // The launchpad's initHash covers every field except callData, so the address is known before callData.
        return abi.encodeCall(ISafe7579Launchpad.preValidationSetup, (ISafe7579Launchpad(LAUNCHPAD).hash(d), address(0), ""));
    }

    function _predict(bytes memory initializer, uint256 salt) internal view returns (address) {
        bytes32 s = keccak256(abi.encodePacked(keccak256(initializer), salt));
        bytes memory code = abi.encodePacked(ISafeProxyFactory(FACTORY).proxyCreationCode(), uint256(uint160(LAUNCHPAD)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), FACTORY, s, keccak256(code))))));
    }

    function _initExecs(address account, bool hookFirst) internal view returns (Execution[] memory e) {
        e = new Execution[](3);
        e[0] = Execution(account, 0, abi.encodeCall(IERC7579Account.setRegistry, (address(0), new address[](0), 0)));
        Execution memory h = Execution(account, 0, abi.encodeCall(IERC7579Account.installModule, (4, address(hook), abi.encode(uint8(0), bytes4(0), bytes("")))));
        Execution memory x = Execution(account, 0, abi.encodeCall(IERC7579Account.installModule, (2, address(executor), bytes(""))));
        (e[1], e[2]) = hookFirst ? (h, x) : (x, h);
    }

    function _createAccount(uint256 salt, bool hookFirst) internal returns (address account, OpResult memory r) {
        // First pass with a placeholder callData to learn the address (callData is not in the initHash).
        LaunchpadInitData memory d = _initData(new Execution[](0));
        bytes memory initializer = _initializer(d);
        account = _predict(initializer, salt);
        d = _initData(_initExecs(account, hookFirst));
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        op.initCode = abi.encodePacked(FACTORY, abi.encodeCall(ISafeProxyFactory.createProxyWithNonce, (LAUNCHPAD, initializer, salt)));
        op.callData = abi.encodeCall(ISafe7579Launchpad.setupSafe, (d));
        op.accountGasLimits = bytes32(uint256(2_000_000) << 128 | 2_000_000);
        op.signature = _passkeySig(EP.getUserOpHash(op));
        vm.deal(account, 0.1 ether); // no paymaster in the spike: the account prefunds
        r = _handle(op);
    }

    // ---------------------------------------------------------------- userOp helpers

    function _key(address validator) internal pure returns (uint192) {
        return uint192(uint160(validator)) << 32; // Safe7579 reads the validator from the top 20 bytes of the nonce
    }

    function _baseOp(address account, address validator) internal view returns (PackedUserOperation memory op) {
        op.sender = account;
        op.nonce = EP.getNonce(account, _key(validator));
        op.accountGasLimits = bytes32(uint256(600_000) << 128 | 600_000);
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(uint256(1 gwei) << 128 | 2 gwei);
    }

    function _passkeySig(bytes32 userOpHash) internal view returns (bytes memory) {
        return abi.encode(credIdHash, _webauthn(abi.encode(userOpHash)));
    }

    function _webauthn(bytes memory challenge) internal view returns (WebAuthn.WebAuthnAuth memory a) {
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"', Base64.encodeURL(challenge),
            '","origin":"https://praetor.localhost","crossOrigin":false}'
        );
        bytes memory authData = abi.encodePacked(sha256("praetor.localhost"), bytes1(0x05), uint32(1)); // UP | UV
        bytes32 h = sha256(abi.encodePacked(authData, sha256(bytes(cdj))));
        (bytes32 r, bytes32 s) = vm.signP256(p256Pk, h);
        uint256 sn = uint256(s);
        if (sn > P256_N / 2) sn = P256_N - sn; // WebAuthn.sol rejects high-s
        a = WebAuthn.WebAuthnAuth(authData, cdj, 23, 1, uint256(r), sn);
    }

    function _agentSig(bytes32 userOpHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, MessageHashUtils.toEthSignedMessageHash(userOpHash));
        return abi.encodePacked(r, s, v);
    }

    function _handle(PackedUserOperation memory op) internal returns (OpResult memory r) {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.recordLogs();
        vm.prank(bundler, bundler);
        EP.handleOps(ops, payable(bundler));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(EP)) continue;
            if (logs[i].topics[0] == OP_EVENT) {
                (, bool ok,, uint256 used) = abi.decode(logs[i].data, (uint256, bool, uint256, uint256));
                r.success = ok; r.gasUsed = used; r.found = true;
            } else if (logs[i].topics[0] == OP_REVERT) {
                (, r.revertReason) = abi.decode(logs[i].data, (uint256, bytes));
            }
        }
    }

    function _hookInstalled(address account) internal view returns (bool) {
        return IERC7579Account(account).isModuleInstalled(4, address(hook), abi.encode(uint8(0), bytes4(0)));
    }

    function _ready(uint256 salt) internal returns (address account) {
        OpResult memory r;
        (account, r) = _createAccount(salt, false);
        assertTrue(r.success, "account creation");
        agentV.setKey(account, vm.addr(agentPk), uint48(block.timestamp + 1 days));
    }

    // ---------------------------------------------------------------- 1 + 2: creation path

    function test_1_creationPath_specOrder_hookFirst() public {
        (address account, OpResult memory r) = _createAccount(1001, true);
        console2.log("account", account);
        console2.log("first op success", r.success);
        console2.log("first op actualGasUsed", r.gasUsed);
        assertTrue(r.success, "first op (passkey-validated, NoOwner owner) succeeds");
        address[] memory owners = ISafe(account).getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], address(noOwner));
        assertEq(ISafe(account).getThreshold(), 1);
        assertTrue(IERC7579Account(account).isModuleInstalled(1, address(passkeyV), ""), "passkey validator");
        assertTrue(IERC7579Account(account).isModuleInstalled(1, address(agentV), ""), "agent validator");
        assertTrue(IERC7579Account(account).isModuleInstalled(2, address(executor), ""), "executor");
        assertTrue(_hookInstalled(account), "global hook");
        // With the spec's order the executor install already runs through the hook's preCheck.
        assertEq(hook.preChecks(account), 1, "executor install was hooked");
        bytes memory md = hook.lastMsgData(account);
        console2.log("preCheck msgData length", md.length);
        console2.logBytes(md);
        bytes memory expected = abi.encodeCall(IERC7579Account.installModule, (2, address(executor), bytes("")));
        assertEq(md.length, expected.length + 20, "msgData = calldata + 20 appended bytes");
        assertEq(address(bytes20(_slice(md, md.length - 20, 20))), account, "appended sender = the Safe (self call)");
        assertEq(keccak256(_slice(md, 0, expected.length)), keccak256(expected), "original calldata intact");
        assertEq(hook.lastMsgSender(account), account, "msgSender arg = self");
    }

    function test_1b_specOrder_breaksWhenHookGatesModuleChanges() public {
        hook.configure(false, true); // MandateHook refuses installModule without an owner action
        (address account, OpResult memory r) = _createAccount(1002, true);
        console2.log("hook-first creation success", r.success);
        console2.logBytes(r.revertReason);
        assertFalse(r.success, "spec order fails: the executor install hits the new hook");
        // setupSafe reverted, so the proxy still runs the launchpad singleton: no Safe owners yet.
        (bool ok,) = account.staticcall(abi.encodeCall(ISafe.getOwners, ()));
        assertFalse(ok, "Safe setup rolled back");
        // callData is not in the initHash, but a retry still fails: the failed op's validation phase already
        // initialized the adapter's validator list, so the launchpad's initializeAccountWithValidators reverts.
        // The counterfactual address is bricked; the first op must be simulated before it is submitted.
        hook.configure(true, true);
        PackedUserOperation memory retry = _baseOp(account, address(passkeyV));
        LaunchpadInitData memory d = _initData(_initExecs(account, false));
        retry.callData = abi.encodeCall(ISafe7579Launchpad.setupSafe, (d));
        retry.accountGasLimits = bytes32(uint256(2_000_000) << 128 | 2_000_000);
        retry.signature = _passkeySig(EP.getUserOpHash(retry));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = retry;
        vm.prank(bundler, bundler);
        vm.expectRevert(abi.encodeWithSignature(
            "FailedOpWithRevert(uint256,string,bytes)", 0, "AA23 reverted", abi.encodeWithSignature("InvalidUserOperationData()")
        ));
        EP.handleOps(ops, payable(bundler));
    }

    function test_1c_executorFirstOrder_worksWithGatingHook() public {
        hook.configure(true, true);
        (address account, OpResult memory r) = _createAccount(1003, false);
        console2.log("executor-first creation success", r.success, "gas", r.gasUsed);
        assertTrue(r.success, "executor before hook: nothing hooked during init");
        assertTrue(_hookInstalled(account));
        assertTrue(IERC7579Account(account).isModuleInstalled(2, address(executor), ""));
        assertEq(hook.preChecks(account), 0);
    }

    // ---------------------------------------------------------------- 3: agent op

    function test_3_agentOp_passesHook() public {
        address account = _ready(1004);
        address payee = makeAddr("payee");
        PackedUserOperation memory op = _baseOp(account, address(agentV));
        op.callData = abi.encodeCall(IERC7579Account.execute, (SINGLE, abi.encodePacked(payee, uint256(0), bytes(""))));
        op.signature = _agentSig(EP.getUserOpHash(op));
        OpResult memory r = _handle(op);
        console2.log("agent op success", r.success, "actualGasUsed", r.gasUsed);
        assertTrue(r.success);
        assertEq(hook.preChecks(account), 1);
        bytes memory md = hook.lastMsgData(account);
        assertEq(bytes4(md), IERC7579Account.execute.selector);
        assertEq(address(bytes20(_slice(md, md.length - 20, 20))), address(EP), "appended sender = EntryPoint");
        assertEq(hook.lastMsgSender(account), address(EP));
    }

    function test_3b_agentKey_cannotSendModuleCalls() public {
        address account = _ready(1005);
        PackedUserOperation memory op = _baseOp(account, address(agentV));
        op.callData = abi.encodeCall(IERC7579Account.installModule, (2, address(0xBEEF), bytes("")));
        op.signature = _agentSig(EP.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error"));
        EP.handleOps(ops, payable(bundler));
    }

    // ---------------------------------------------------------------- 4: I1

    function test_4a_execTransaction_alwaysReverts() public {
        address account = _ready(1006);
        address to = makeAddr("to");
        bytes32 h = ISafe(account).getTransactionHash(to, 0, "", 0, 0, 0, 0, address(0), address(0), ISafe(account).nonce());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, h);
        bytes[] memory sigs = new bytes[](3);
        sigs[0] = abi.encodePacked(r, s, v); // any EOA
        // contract signature claiming NoOwner (v = 0, r = owner, s = offset of the dynamic part)
        sigs[1] = abi.encodePacked(bytes32(uint256(uint160(address(noOwner)))), bytes32(uint256(65)), uint8(0), uint256(0));
        sigs[2] = abi.encodePacked(bytes32(uint256(uint160(address(noOwner)))), bytes32(0), uint8(1)); // approved hash
        for (uint256 i; i < sigs.length; i++) {
            vm.expectRevert();
            ISafe(account).execTransaction(to, 0, "", 0, 0, 0, 0, address(0), payable(address(0)), sigs[i]);
        }
    }

    function test_4b_directUninstallOfHook_skipsPreCheck_GAP() public {
        address account = _ready(1007);
        hook.configure(true, true); // the hook would refuse any module change if asked
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        op.callData = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), abi.encode(uint8(0), bytes4(0), bytes(""))));
        op.signature = _passkeySig(EP.getUserOpHash(op));
        OpResult memory r = _handle(op);
        console2.log("direct uninstall success", r.success, "hook still installed", _hookInstalled(account));
        console2.log("hook preChecks during uninstall", hook.preChecks(account));
        // Documents the gap: tryWithHook skips the hook being removed and onUninstall's revert is swallowed.
        assertTrue(r.success, "GAP: passkey alone removes the hook");
        assertFalse(_hookInstalled(account), "GAP: hook gone");
        assertEq(hook.preChecks(account), 0, "GAP: preCheck never ran");
    }

    function test_4c_uninstallViaExecuteSelfCall_refusedByHook() public {
        address account = _ready(1008);
        hook.configure(true, true);
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        bytes memory un = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), abi.encode(uint8(0), bytes4(0), bytes(""))));
        op.callData = abi.encodeCall(IERC7579Account.execute, (SINGLE, abi.encodePacked(account, uint256(0), un)));
        op.signature = _passkeySig(EP.getUserOpHash(op));
        OpResult memory r = _handle(op);
        assertFalse(r.success, "execute(self.uninstallModule) is refused by the hook");
        assertTrue(_hookInstalled(account));
    }

    function test_4d_directInstall_isHooked() public {
        address account = _ready(1009);
        hook.configure(false, true);
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        op.callData = abi.encodeCall(IERC7579Account.installModule, (2, address(new ProbeExecutor()), bytes("")));
        op.signature = _passkeySig(EP.getUserOpHash(op));
        OpResult memory r = _handle(op);
        assertFalse(r.success, "installModule passes the hook, which refuses");
    }

    function test_4e_directUninstallOfValidator_isHooked() public {
        address account = _ready(1010);
        hook.configure(false, true);
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        // Validators live in a linked list: uninstall data = abi.encode(prev, deInitData); prev of agentV is passkeyV? use sentinel walk
        op.callData = abi.encodeCall(IERC7579Account.uninstallModule, (1, address(agentV), abi.encode(address(1), bytes(""))));
        op.signature = _passkeySig(EP.getUserOpHash(op));
        OpResult memory r = _handle(op);
        assertFalse(r.success, "uninstalling a non-hook module passes the hook, which refuses");
        assertTrue(IERC7579Account(account).isModuleInstalled(1, address(agentV), ""));
    }

    function test_4f_nonceKey0_ownerFallback_fails() public {
        address account = _ready(1011);
        PackedUserOperation memory op = _baseOp(account, address(0));
        op.callData = abi.encodeCall(IERC7579Account.execute, (SINGLE, abi.encodePacked(makeAddr("x"), uint256(0), bytes(""))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, EP.getUserOpHash(op));
        op.signature = abi.encodePacked(uint48(0), uint48(0), r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error"));
        EP.handleOps(ops, payable(bundler));
    }

    function test_4g_unknownValidatorKey_fallsBackToOwners_fails() public {
        address account = _ready(1012);
        PackedUserOperation memory op = _baseOp(account, address(0xdead));
        op.callData = abi.encodeCall(IERC7579Account.execute, (SINGLE, abi.encodePacked(makeAddr("x"), uint256(0), bytes(""))));
        op.signature = _agentSig(EP.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error"));
        EP.handleOps(ops, payable(bundler));
    }

    function test_4h_executeFromExecutor() public {
        address account = _ready(1013);
        ProbeExecutor outsider = new ProbeExecutor();
        bytes memory exec = abi.encodePacked(makeAddr("y"), uint256(0), bytes(""));
        vm.expectRevert(); // InvalidModule: only installed executors
        outsider.run(account, SINGLE, exec);
        uint256 before = hook.preChecks(account);
        executor.run(account, SINGLE, exec);
        assertEq(hook.preChecks(account), before + 1, "installed executor's call passes the hook");
        assertEq(hook.lastMsgSender(account), address(executor));
        assertEq(bytes4(hook.lastMsgData(account)), IERC7579Account.executeFromExecutor.selector);
    }

    function test_4i_fallbackSelector_isHooked() public {
        address account = _ready(1014);
        vm.expectCall(address(hook), abi.encodeWithSelector(ProbeHook.preCheck.selector));
        (bool ok,) = account.call(abi.encodeWithSelector(bytes4(0xdeadbeef), uint256(1)));
        assertFalse(ok, "no fallback handler installed");
    }

    function test_4j_directCallsToAdapterSelectors() public {
        address account = _ready(1015);
        // From an outsider (not EntryPoint, not self): every guarded selector reverts.
        address[] memory none = new address[](0);
        vm.expectRevert();
        IERC7579Account(account).execute(SINGLE, abi.encodePacked(address(1), uint256(0), bytes("")));
        vm.expectRevert();
        IERC7579Account(account).installModule(2, address(1), "");
        vm.expectRevert();
        IERC7579Account(account).uninstallModule(4, address(hook), abi.encode(uint8(0), bytes4(0), bytes("")));
        vm.expectRevert();
        IERC7579Account(account).setRegistry(address(0), none, 0);
        // setRegistry through a passkey userOp: our validator refuses the selector (AA24).
        PackedUserOperation memory op = _baseOp(account, address(passkeyV));
        op.callData = abi.encodeCall(IERC7579Account.setRegistry, (address(0), none, 0));
        op.signature = _passkeySig(EP.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error"));
        EP.handleOps(ops, payable(bundler));
    }

    // ---------------------------------------------------------------- 5: I16

    function test_5_usdc_erc1271_closed() public {
        address account = _ready(1016);
        console2.log("USDC name", USDC.name());
        console2.log("USDC symbol", USDC.symbol());
        console2.log("USDC decimals", USDC.decimals());
        console2.log("USDC version", USDC.version());
        console2.logBytes32(USDC.DOMAIN_SEPARATOR());
        bytes32 ds = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(USDC.name())), keccak256(bytes(USDC.version())), block.chainid, address(USDC)
        ));
        assertEq(ds, USDC.DOMAIN_SEPARATOR(), "domain = (name, version, 84532, USDC)");
        address spender = makeAddr("spender");

        // Positive control: an EOA's permit with the same digest construction works.
        // High-entropy key: low keys like 0xE0A are 7702-delegated on Base Sepolia by third parties.
        uint256 eoaPk = uint256(keccak256("praetor-v1-control-eoa"));
        address eoa = vm.addr(eoaPk);
        bytes32 eoaDigest = _permitDigest(eoa, spender, 5e6, type(uint256).max);
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(eoaPk, eoaDigest);
        USDC.permit(eoa, spender, 5e6, type(uint256).max, abi.encodePacked(r0, s0, v0));
        assertEq(USDC.allowance(eoa, spender), 5e6, "control permit works");

        bytes32 digest = _permitDigest(account, spender, 5e6, type(uint256).max);
        bytes32 twaNonce = keccak256("n");
        bytes32 twaDigest = _twaDigest(account, spender, 5e6, 0, type(uint256).max, twaNonce);
        bytes[] memory sigs = _accountSigs(digest);
        bytes[] memory twaSigs = _accountSigs(twaDigest);
        for (uint256 i; i < sigs.length; i++) _checkVariant(account, spender, digest, sigs[i], twaSigs[i], twaNonce, i);
        assertEq(USDC.allowance(account, spender), 0);
    }

    function _checkVariant(address account, address spender, bytes32 digest, bytes memory sig, bytes memory twaSig, bytes32 twaNonce, uint256 i) internal {
        (bool okView, bytes memory ret) = account.staticcall(abi.encodeCall(IERC7579Account.isValidSignature, (digest, sig)));
        console2.log("variant", i, okView ? "isValidSignature returned" : "isValidSignature reverted");
        if (okView && ret.length >= 32) assertTrue(bytes4(abi.decode(ret, (bytes32))) != bytes4(0x1626ba7e), "never magic");
        vm.expectRevert();
        USDC.permit(account, spender, 5e6, type(uint256).max, sig);
        vm.expectRevert();
        USDC.transferWithAuthorization(account, spender, 5e6, 0, type(uint256).max, twaNonce, twaSig);
    }

    function _accountSigs(bytes32 digest) internal view returns (bytes[] memory s) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(agentPk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(agentPk, MessageHashUtils.toEthSignedMessageHash(digest));
        s = new bytes[](6);
        s[0] = abi.encodePacked(address(agentV), r, ss, v); // agent key via AgentKeyValidator
        s[1] = abi.encodePacked(address(agentV), r2, s2, v2); // agent key, eth-signed variant
        s[2] = abi.encodePacked(address(passkeyV), abi.encode(credIdHash, _webauthn(abi.encodePacked(digest)))); // passkey
        s[3] = ""; // empty: Safe signedMessages path
        s[4] = abi.encodePacked(address(0), r, ss, v); // zero prefix: Safe owner signatures (NoOwner)
        s[5] = abi.encodePacked(r, ss, v); // raw 65-byte ECDSA, no prefix
    }

    function _permitDigest(address owner, address spender, uint256 value, uint256 deadline) internal view returns (bytes32) {
        bytes32 sh = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            owner, spender, value, USDC.nonces(owner), deadline
        ));
        return keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), sh));
    }

    function _twaDigest(address from, address to, uint256 value, uint256 va, uint256 vb, bytes32 n) internal view returns (bytes32) {
        bytes32 sh = keccak256(abi.encode(
            keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            from, to, value, va, vb, n
        ));
        return keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), sh));
    }

    // ---------------------------------------------------------------- misc

    function test_6_webauthnPath_precompileOrFcl() public view {
        bytes memory ch = abi.encode(keccak256("x"));
        WebAuthn.WebAuthnAuth memory a = _webauthn(ch);
        uint256 g = gasleft();
        bool ok = WebAuthn.verify(ch, true, a, px, py);
        uint256 used = g - gasleft();
        console2.log("WebAuthn.verify ok", ok, "gas", used);
        (bool s, bytes memory ret) = address(0x100).staticcall(abi.encode(bytes32(0), uint256(1), uint256(1), px, py));
        console2.log("0x100 call success / ret length", s, ret.length);
        assertTrue(ok);
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }
}
