// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";
import {AssetRegistry} from "./AssetRegistry.sol";

/// @notice Bank caps per risk profile and KYA (bank-only attestations), the policy check that precedes every
/// SET_POLICY signature (its tx hash is the OwnerAction fiscoRef), agent successor links (F10) and the audit record
/// of co-signed owner actions (spec 04).
contract MandateRegistry is Board {
    struct Caps {
        uint256 perTxCap;
        uint256 dailyCap;
        uint256 monthlyCap;
    }

    // MandateChecked failedRule codes.
    uint8 public constant RULE_OK = 0;
    uint8 public constant RULE_INVALID_POLICY = 1;
    uint8 public constant RULE_HARD_CAP = 2;
    uint8 public constant RULE_DAILY = 3;
    uint8 public constant RULE_MONTHLY = 4;
    uint8 public constant RULE_ASSET_NOT_ACTIVE = 5;
    uint8 public constant RULE_OVER_MAX_WEIGHT = 6;

    AssetRegistry public immutable assets;
    address public immutable usdc;
    mapping(uint8 => Caps) public capsOf;
    mapping(address => P.KYAAttestation) internal kyas;

    event MandateChecked(address indexed account, bytes32 policyHash, bool ok, uint8 failedRule);
    event SuccessorLinked(address indexed account, bytes32 oldAgentDidHash, bytes32 newAgentDidHash);
    event OwnerActionRecorded(address indexed account, uint8 indexed action, bytes32 payloadHash, bytes32 digest);

    constructor(address registry_, address outbox_, address assets_, address usdc_) Board(registry_, outbox_) {
        assets = AssetRegistry(assets_);
        usdc = usdc_;
    }

    function openCaps(uint8 riskProfile, uint256 perTxCap, uint256 dailyCap, uint256 monthlyCap, uint64 deadline)
        external
        onlyBank
        returns (uint256 id)
    {
        if (riskProfile > uint8(P.RiskProfile.GROWTH) || perTxCap > P.MAX_AMOUNT || dailyCap > P.MAX_AMOUNT || monthlyCap > P.MAX_AMOUNT) {
            revert InvalidValue();
        }
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(CAPS, bytes32(uint256(riskProfile)), deadline);
        P.CapsAttestation memory a = P.CapsAttestation(riskProfile, perTxCap, dailyCap, monthlyCap, nonce, deadline, _fiscoRef(pid));
        _store(pid, Draft(CAPS, key, nonce, deadline, abi.encode(a), 1, true));
        return pid;
    }

    /// KYA fields as in spec 02 (nonce, deadline and fiscoRef are set by the board).
    function openKYA(P.KYAAttestation calldata k) external onlyBank returns (uint256 id) {
        if (k.riskProfile > uint8(P.RiskProfile.GROWTH)) revert InvalidValue();
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(KYA, bytes32(uint256(uint160(k.account))), k.deadline);
        P.KYAAttestation memory a = k;
        a.nonce = nonce;
        a.fiscoRef = _fiscoRef(pid);
        _store(pid, Draft(KYA, key, nonce, k.deadline, abi.encode(a), 1, true));
        return pid;
    }

    /// The bank checks a proposed policy against the caps and the asset registry before anyone signs it.
    function submitPolicy(address account, P.Policy calldata policy, uint8 riskProfile) external onlyBank returns (bool ok, uint8 failedRule) {
        failedRule = _check(policy, riskProfile);
        ok = failedRule == RULE_OK;
        emit MandateChecked(account, P.policyHash(policy), ok, failedRule);
    }

    function linkSuccessor(address account, bytes32 oldAgentDidHash, bytes32 newAgentDidHash) external onlyBank {
        emit SuccessorLinked(account, oldAgentDidHash, newAgentDidHash);
    }

    function recordOwnerAction(address account, uint8 action, bytes32 payloadHash, bytes32 digest) external onlyBank {
        emit OwnerActionRecorded(account, action, payloadHash, digest);
    }

    function kyaOf(address account) external view returns (P.KYAAttestation memory) {
        return kyas[account];
    }

    function _check(P.Policy calldata policy, uint8 riskProfile) internal view returns (uint8) {
        if (P.validatePolicy(policy, _nowSeconds(), usdc) != 0) return RULE_INVALID_POLICY;
        Caps memory c = capsOf[riskProfile];
        if (policy.hardCap > c.perTxCap) return RULE_HARD_CAP;
        if (policy.dailyBudget > c.dailyCap) return RULE_DAILY;
        if (policy.monthlyBudget > c.monthlyCap) return RULE_MONTHLY;
        for (uint256 i; i < policy.bands.length; ++i) {
            (, uint8 status, uint16 maxW,) = assets.assetOf(policy.bands[i].token);
            if (status != uint8(P.AssetStatus.ACTIVE)) return RULE_ASSET_NOT_ACTIVE;
            if (policy.bands[i].maxBps > maxW) return RULE_OVER_MAX_WEIGHT;
        }
        return RULE_OK;
    }

    function _structHash(uint8 kind, bytes memory fields) internal pure override returns (bytes32) {
        if (kind == CAPS) return P.hash(abi.decode(fields, (P.CapsAttestation)));
        return P.hash(abi.decode(fields, (P.KYAAttestation)));
    }

    function _onReady(uint8 kind, bytes memory fields) internal override {
        if (kind == CAPS) {
            P.CapsAttestation memory a = abi.decode(fields, (P.CapsAttestation));
            capsOf[a.riskProfile] = Caps(a.perTxCap, a.dailyCap, a.monthlyCap);
        } else {
            P.KYAAttestation memory k = abi.decode(fields, (P.KYAAttestation));
            kyas[k.account] = k;
        }
    }
}
