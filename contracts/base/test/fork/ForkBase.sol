// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Vm} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {PraetorDeployer} from "../../script/PraetorDeployer.sol";
import {IEntryPointV07, PackedUserOperation} from "../../src/interfaces/IERC4337.sol";
import {Execution, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";
import {Passkeys} from "../utils/Passkeys.sol";
import "../utils/Safe7579.sol";

/// Base Sepolia fork at the pinned block (infra/deployments/fork.json) with the real EntryPoint v0.7, Safe 1.4.1,
/// Safe7579 adapter and launchpad, and our contracts deployed by PraetorDeployer. Test keys are keccak256(label)
/// (Q13): low-entropy keys carry EIP-7702 code on Base Sepolia.
abstract contract ForkBase is Passkeys, PraetorDeployer {
    using stdJson for string;

    IEntryPointV07 internal constant EP = IEntryPointV07(ENTRY_POINT);
    address internal constant ADAPTER = 0x7579EE8307284F293B1927136486880611F20002;
    address internal constant LAUNCHPAD = 0x7579011aB74c46090561ea277Ba79D510c6C00ff;
    address internal constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant REGISTRY_ATTESTER = 0x000000333034E9f539ce08819E12c1b8Cb29084d;
    IFiatToken internal constant USDC = IFiatToken(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    bytes32 internal constant OP_EVENT = keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

    uint256 internal bankPk = uint256(keccak256("fork:bank"));
    uint256 internal regPk = uint256(keccak256("fork:regulator"));
    uint256 internal opPk = uint256(keccak256("fork:operator"));
    uint256 internal pmSignerPk = uint256(keccak256("fork:paymaster-signer"));
    uint256 internal agentPk = uint256(keccak256("fork:agent"));
    address internal deployer = makeAddr("fork:deployer");
    address internal deskOperator = makeAddr("fork:desk-operator");
    address internal feeder = makeAddr("fork:feeder");
    address internal bundler = makeAddr("fork:bundler");
    address internal landlord = makeAddr("fork:landlord");
    address internal partner = makeAddr("fork:payout-partner");

    Deployment internal d;
    Passkey internal owner;
    address internal account;
    mapping(bytes32 => uint64) internal nonceOf;
    uint64 internal salt;

    struct OpResult {
        bool found;
        bool success;
        uint256 gasUsed;
    }

    function setUp() public virtual {
        string memory fork = vm.readFile(string.concat(vm.projectRoot(), "/../../infra/deployments/fork.json"));
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://sepolia.base.org")), fork.readUint(".forkBlock"));
        vm.deal(deployer, 10 ether);
        vm.deal(bundler, 1 ether);
        Config memory c = Config({
            deployer: deployer, bank: vm.addr(bankPk), regulator: vm.addr(regPk), operator: vm.addr(opPk), feeder: feeder,
            deskOperator: deskOperator, paymasterSigner: vm.addr(pmSignerPk), usdc: address(USDC), domainName: "Praetor-local",
            soterCounterStrict: true, paymasterDeposit: 1 ether
        });
        vm.startPrank(deployer);
        d = _deployAll(c);
        vm.stopPrank();
        owner = _passkey("fork-owner");
    }

    // ---------------------------------------------------------------- account creation (spec 00, Q15, Q16)

    function _initData(Execution[] memory execs) internal view returns (LaunchpadInitData memory init) {
        address[] memory owners = new address[](1);
        owners[0] = address(d.noOwner);
        address[] memory attesters = new address[](1);
        attesters[0] = REGISTRY_ATTESTER; // GS000: the launchpad always configures the registry, so at least one
        ModuleInit[] memory none = new ModuleInit[](0);
        ModuleInit[] memory validators = new ModuleInit[](2);
        validators[0] = ModuleInit(address(d.passkeyValidator), abi.encode(owner.credIdHash, owner.x, owner.y));
        validators[1] = ModuleInit(address(d.agentKeyValidator), "");
        init = LaunchpadInitData({
            singleton: SINGLETON,
            owners: owners,
            threshold: 1,
            setupTo: LAUNCHPAD,
            setupData: abi.encodeCall(ISafe7579Launchpad.initSafe7579, (ADAPTER, none, none, none, attesters, 1)),
            safe7579: ADAPTER,
            validators: validators,
            callData: abi.encodeCall(IAccount7579.execute, (MODE_BATCH, abi.encode(execs)))
        });
    }

    function _initializer(LaunchpadInitData memory init) internal view returns (bytes memory) {
        return abi.encodeCall(ISafe7579Launchpad.preValidationSetup, (ISafe7579Launchpad(LAUNCHPAD).hash(init), address(0), ""));
    }

    function _predict(bytes memory initializer, uint256 saltNonce) internal view returns (address) {
        bytes32 s = keccak256(abi.encodePacked(keccak256(initializer), saltNonce));
        bytes memory code = abi.encodePacked(ISafeProxyFactory(FACTORY).proxyCreationCode(), uint256(uint160(LAUNCHPAD)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), FACTORY, s, keccak256(code))))));
    }

    /// Init batch order executor first, hook last (Q15).
    function _initExecs(address acc) internal view returns (Execution[] memory e) {
        e = new Execution[](3);
        e[0] = Execution(acc, 0, abi.encodeCall(IAccount7579.setRegistry, (address(0), new address[](0), 0)));
        e[1] = Execution(acc, 0, abi.encodeCall(IAccount7579.installModule, (2, address(d.standingOrders), bytes(""))));
        e[2] = Execution(acc, 0, abi.encodeCall(IAccount7579.installModule, (4, address(d.hook), abi.encode(uint8(0), bytes4(0), bytes("")))));
    }

    function _createAccount(uint256 saltNonce) internal returns (OpResult memory r) {
        LaunchpadInitData memory init = _initData(new Execution[](0));
        bytes memory initializer = _initializer(init);
        account = _predict(initializer, saltNonce);
        init = _initData(_initExecs(account));
        PackedUserOperation memory op = _baseOp(address(d.passkeyValidator));
        op.initCode = abi.encodePacked(FACTORY, abi.encodeCall(ISafeProxyFactory.createProxyWithNonce, (LAUNCHPAD, initializer, saltNonce)));
        op.callData = abi.encodeCall(ISafe7579Launchpad.setupSafe, (init));
        op.accountGasLimits = bytes32(uint256(3_000_000) << 128 | 3_000_000);
        _sponsor(op);
        op.signature = _passkeySig(owner, EP.getUserOpHash(op));
        r = _handle(op);
    }

    // ---------------------------------------------------------------- userOps

    function _key(address validator) internal pure returns (uint192) {
        return uint192(uint160(validator)) << 32;
    }

    function _baseOp(address validator) internal view returns (PackedUserOperation memory op) {
        op.sender = account;
        op.nonce = EP.getNonce(account, _key(validator));
        op.accountGasLimits = bytes32(uint256(2_000_000) << 128 | 2_000_000);
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(uint256(1 gwei) << 128 | 2 gwei);
    }

    /// PraetorPaymaster sponsorship (D20): the account holds no ETH (Q21).
    function _sponsor(PackedUserOperation memory op) internal view {
        uint48 until = uint48(block.timestamp + 600);
        op.paymasterAndData = abi.encodePacked(address(d.paymaster), uint128(200_000), uint128(50_000), until, uint48(0), new bytes(65));
        bytes32 h = d.paymaster.getHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pmSignerPk, MessageHashUtils.toEthSignedMessageHash(h));
        op.paymasterAndData = abi.encodePacked(address(d.paymaster), uint128(200_000), uint128(50_000), until, uint48(0), r, s, v);
    }

    function _passkeyOp(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = _baseOp(address(d.passkeyValidator));
        op.callData = callData;
        _sponsor(op);
        op.signature = _passkeySig(owner, EP.getUserOpHash(op));
    }

    function _agentOp(bytes memory callData, uint256 pk) internal view returns (PackedUserOperation memory op) {
        op = _baseOp(address(d.agentKeyValidator));
        op.callData = callData;
        _sponsor(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(EP.getUserOpHash(op)));
        op.signature = abi.encodePacked(r, s, v);
    }

    function _handle(PackedUserOperation memory op) internal returns (OpResult memory r) {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.recordLogs();
        vm.prank(bundler, bundler);
        EP.handleOps(ops, payable(bundler));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(EP) && logs[i].topics[0] == OP_EVENT) {
                (, bool ok,, uint256 used) = abi.decode(logs[i].data, (uint256, bool, uint256, uint256));
                (r.found, r.success, r.gasUsed) = (true, ok, used);
            }
        }
    }

    // ---------------------------------------------------------------- consortium and owner actions on the fork

    function _sign(uint256 pk, bytes32 h) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        return abi.encodePacked(r, s, v);
    }

    function _sigs1(uint256 pk, bytes32 h) internal pure returns (bytes[] memory s) {
        s = new bytes[](1);
        s[0] = _sign(pk, h);
    }

    function _sigs2(uint256 a, uint256 b, bytes32 h) internal pure returns (bytes[] memory s) {
        if (vm.addr(a) > vm.addr(b)) (a, b) = (b, a);
        s = new bytes[](2);
        (s[0], s[1]) = (_sign(a, h), _sign(b, h));
    }

    function _dig(bytes32 structHash) internal view returns (bytes32) {
        return P.digest(d.hook.domainSeparator(), structHash);
    }

    function _next(bytes32 k) internal returns (uint64) {
        return ++nonceOf[k];
    }

    function _ownerAction(uint8 kind, bytes memory payload, bool withBank) internal {
        P.OwnerAction memory a = P.OwnerAction(account, kind, P.ownerActionPayloadHash(account, kind, payload), ++salt, uint64(block.timestamp + 600), 0);
        bytes32 h = _dig(P.hash(a));
        P.OwnerAuth memory auth = P.OwnerAuth(0, abi.encode(owner.credIdHash, _auth(owner, abi.encodePacked(h))));
        d.hook.applyOwnerAction(a, payload, auth, withBank ? _sigs1(bankPk, h) : new bytes[](0));
    }

    /// Lin's mandate on the fork: caps, KYA with the agent key, assets, heartbeat, policy, agent key, USDC.
    function _lin() internal {
        uint64 dl = uint64(block.timestamp + 3600);
        P.CapsAttestation memory caps = P.CapsAttestation(2, 5_000e6, 10_000e6, 50_000e6, _next("caps"), dl, 0);
        d.hook.applyCaps(caps, _sigs1(bankPk, _dig(P.hash(caps))));
        P.KYAAttestation memory k;
        (k.account, k.agentKey, k.kycLevel, k.riskProfile, k.jurisdiction, k.validUntil, k.nonce, k.deadline) =
            (account, vm.addr(agentPk), 2, 2, "HK", uint64(block.timestamp + 365 days), _next("kya"), dl);
        d.hook.applyKYA(k, _sigs1(bankPk, _dig(P.hash(k))));
        P.AssetAttestation memory pa = P.AssetAttestation(partner, 2, 1, 0, _next("partner"), dl, 0);
        d.hook.applyAsset(pa, _sigs1(bankPk, _dig(P.hash(pa))));
        P.HeartbeatAttestation memory hb = P.HeartbeatAttestation(_next("hb"), uint64(block.timestamp + 180), dl);
        d.hook.applyHeartbeat(hb, _sigs1(opPk, _dig(P.hash(hb))));
        P.Policy memory p;
        (p.autoCap, p.hardCap, p.dailyBudget, p.monthlyBudget, p.dailyCount, p.bufferUsdc) = (200e6, 2_000e6, 500e6, 3_000e6, 10, 1_000e6);
        p.payees = new address[](1);
        p.payees[0] = landlord;
        p.merchants = new bytes32[](1);
        p.merchants[0] = P.merchantKey(partner, keccak256("KOWLOON-LETTINGS"));
        p.bands = new P.Band[](1);
        p.bands[0] = P.Band(address(USDC), 0, 10_000, 10_000);
        (p.maxRebalancesPerDay, p.maxTradeUsd, p.maxSlippageBps, p.validUntil) = (1, 1_000e6, 100, uint64(block.timestamp + 365 days));
        _ownerAction(uint8(P.OwnerActionKind.SET_POLICY), abi.encode(p), true);
        _ownerAction(uint8(P.OwnerActionKind.SET_AGENT_KEY), abi.encode(vm.addr(agentPk), uint48(block.timestamp + 30 days)), true);
        _mintUsdc(account, 5_300e6);
    }

    /// Fork USDC through FiatToken's own minter path (its packed balance slot defeats `deal`).
    function _mintUsdc(address to, uint256 amount) internal {
        vm.prank(USDC.masterMinter());
        USDC.configureMinter(address(this), amount);
        USDC.mint(to, amount);
    }
}
