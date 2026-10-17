// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IMandateHookEvents} from "@praetor/protocol/PraetorEvents.sol";
import {MandateHook} from "../../src/MandateHook.sol";
import {Modules} from "../../src/hook/HookTypes.sol";
import {PasskeyValidator} from "../../src/PasskeyValidator.sol";
import {AgentKeyValidator} from "../../src/AgentKeyValidator.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {TreasuryDesk} from "../../src/TreasuryDesk.sol";
import {PayoutRail} from "../../src/PayoutRail.sol";
import {IdentityRegistry} from "../../src/tokens/IdentityRegistry.sol";
import {Compliance} from "../../src/tokens/Compliance.sol";
import {PraetorToken} from "../../src/tokens/PraetorToken.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {Passkeys} from "./Passkeys.sol";

/// Deploys the Base contract set around a MandateHook and signs consortium messages with test member keys.
abstract contract HookBase is Passkeys, IMandateHookEvents {
    uint256 internal constant NOW = 1_800_000_000;
    uint256 internal bankPk = uint256(keccak256("member:bank"));
    uint256 internal regPk = uint256(keccak256("member:regulator"));
    uint256 internal opPk = uint256(keccak256("member:operator"));
    uint256 internal strangerPk = uint256(keccak256("stranger"));
    uint256 internal attesterPk = uint256(keccak256("attester"));
    uint256 internal agentPk = uint256(keccak256("agent"));
    address internal bank = vm.addr(bankPk);
    address internal regulator = vm.addr(regPk);
    address internal operator = vm.addr(opPk);
    address internal attester = vm.addr(attesterPk);
    address internal agent = vm.addr(agentPk);

    MockUSDC internal usdc;
    PriceOracle internal oracle;
    IdentityRegistry internal registry;
    Compliance internal compliance;
    PraetorToken internal xau;
    PraetorToken internal xag;
    TreasuryDesk internal desk;
    PayoutRail internal rail;
    MandateHook internal hook;
    PasskeyValidator internal passkeyV;
    AgentKeyValidator internal agentV;
    address internal standingOrders = makeAddr("standingOrders");
    address internal feeder = makeAddr("feeder");
    address internal partner = makeAddr("payoutPartner");
    address internal account = makeAddr("account");
    Passkey internal owner;

    mapping(bytes32 => uint64) internal nextNonce;
    bytes32 internal domSep;

    function setUp() public virtual {
        vm.warp(NOW);
        usdc = new MockUSDC();
        oracle = new PriceOracle(address(this), feeder, address(usdc));
        registry = new IdentityRegistry(address(this));
        compliance = new Compliance(address(this), address(registry));
        xau = new PraetorToken("Praetor Gold", "tXAU", address(this), address(registry), address(compliance));
        xag = new PraetorToken("Praetor Silver", "tXAG", address(this), address(registry), address(compliance));
        desk = new TreasuryDesk(address(this), address(usdc), address(oracle), address(registry));
        hook = new MandateHook(bank, regulator, operator, "Praetor-test", true);
        passkeyV = new PasskeyValidator(address(hook));
        agentV = new AgentKeyValidator(address(hook));
        rail = new PayoutRail(address(hook), address(usdc));
        hook.setModules(Modules({
            passkeyValidator: address(passkeyV), agentKeyValidator: address(agentV), standingOrders: standingOrders,
            usdc: address(usdc), desk: address(desk), payoutRail: address(rail), oracle: address(oracle)
        }));
        domSep = hook.domainSeparator();
        owner = _passkey("owner");
        vm.startPrank(account);
        hook.onInstall("");
        passkeyV.onInstall(abi.encode(owner.credIdHash, owner.x, owner.y));
        agentV.onInstall("");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- signing

    function _sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    /// Signatures sorted ascending by signer address, as the hook requires.
    function _sigs(bytes32 d, uint256[] memory pks) internal pure returns (bytes[] memory out) {
        for (uint256 i = 1; i < pks.length; ++i) {
            for (uint256 j = i; j > 0 && vm.addr(pks[j - 1]) > vm.addr(pks[j]); --j) (pks[j - 1], pks[j]) = (pks[j], pks[j - 1]);
        }
        out = new bytes[](pks.length);
        for (uint256 i; i < pks.length; ++i) out[i] = _sign(pks[i], d);
    }

    function _pks(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _pks(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    /// Cached separator: an external call here would be taken by vm.expectRevert as the call under test.
    function _d(bytes32 structHash) internal view returns (bytes32) {
        return P.digest(domSep, structHash);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 3600);
    }

    // ---------------------------------------------------------------- consortium messages (nonce = stored + 1)

    function _nonce(bytes32 key) internal returns (uint64) {
        return ++nextNonce[key];
    }

    function _status(address who, uint8 st, uint256[] memory pks) internal {
        P.StatusAttestation memory a = P.StatusAttestation(who, st, _nonce(keccak256(abi.encode("status", who))), _deadline(), bytes32(0));
        hook.applyStatus(a, _sigs(_d(P.hash(a)), pks));
    }

    function _heartbeat(uint64 ttl) internal {
        P.HeartbeatAttestation memory a = P.HeartbeatAttestation(_nonce("heartbeat"), uint64(block.timestamp) + ttl, _deadline());
        hook.applyHeartbeat(a, _sigs(_d(P.hash(a)), _pks(opPk)));
    }

    function _caps(uint8 profile, uint256 perTx, uint256 daily, uint256 monthly) internal {
        P.CapsAttestation memory a = P.CapsAttestation(profile, perTx, daily, monthly, _nonce(keccak256(abi.encode("caps", profile))), _deadline(), bytes32(0));
        hook.applyCaps(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
    }

    function _kya(address who, address agentKey, uint8 level, uint8 profile, bytes2 juris, uint64 validUntil) internal {
        P.KYAAttestation memory a = P.KYAAttestation({
            account: who, agentKey: agentKey, agentDidHash: keccak256("did"), kycCredentialHash: keccak256("kyc"),
            mandateCredentialHash: keccak256("mandate"), kycLevel: level, riskProfile: profile, jurisdiction: juris,
            agentMeasurement: keccak256("rtmr3"), validUntil: validUntil, nonce: _nonce(keccak256(abi.encode("kya", who))),
            deadline: _deadline(), fiscoRef: bytes32(0)
        });
        hook.applyKYA(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
    }

    function _asset(address asset, uint8 kind, uint8 st, uint16 maxW, uint256[] memory pks) internal {
        P.AssetAttestation memory a = P.AssetAttestation(asset, kind, st, maxW, _nonce(keccak256(abi.encode("asset", asset))), _deadline(), bytes32(0));
        hook.applyAsset(a, _sigs(_d(P.hash(a)), pks));
    }

    function _sanction(address target, bool listed, uint256[] memory pks) internal {
        P.SanctionsAttestation memory a = P.SanctionsAttestation(target, listed, _nonce(keccak256(abi.encode("sanctions", target))), _deadline(), bytes32(0));
        hook.applySanctions(a, _sigs(_d(P.hash(a)), pks));
    }

    function _jurisdiction(bytes2 j, bool blocked, uint256[] memory pks) internal {
        P.JurisdictionAttestation memory a = P.JurisdictionAttestation(j, blocked, _nonce(keccak256(abi.encode("juris", j))), _deadline(), bytes32(0));
        hook.applyJurisdiction(a, _sigs(_d(P.hash(a)), pks));
    }

    function _attester(address who, bool active, uint256[] memory pks) internal {
        P.AttesterAttestation memory a = P.AttesterAttestation(who, keccak256("attester-rtmr3"), active, _nonce(keccak256(abi.encode("attester", who))), _deadline(), bytes32(0));
        hook.applyAttester(a, _sigs(_d(P.hash(a)), pks));
    }
}
