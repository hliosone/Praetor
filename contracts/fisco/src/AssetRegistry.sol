// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice Approved assets and counterparties (tokens, desk, payout partners). Any loosening component (activate,
/// raise maxWeight, change kind) needs the bank; pure tightening needs any one member (spec 02).
contract AssetRegistry is Board {
    struct Asset {
        uint8 kind;
        uint8 status;
        uint16 maxWeightBps;
        bool known;
    }

    mapping(address => Asset) public assetOf;
    address[] internal listed;

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function openAsset(address asset, uint8 kind, uint8 status, uint16 maxWeightBps, uint64 deadline) external onlyMember returns (uint256 id) {
        if (kind > uint8(P.AssetKind.PAYOUT_PARTNER) || status > uint8(P.AssetStatus.DELISTED) || maxWeightBps > P.BPS) revert InvalidValue();
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(ASSET, bytes32(uint256(uint160(asset))), deadline);
        P.AssetAttestation memory a = P.AssetAttestation(asset, kind, status, maxWeightBps, nonce, deadline, _fiscoRef(pid));
        Asset memory cur = assetOf[asset];
        bool loosens = _rank(status) < _rank(cur.status) || maxWeightBps > cur.maxWeightBps || (kind != cur.kind && cur.status != 0);
        _store(pid, Draft(ASSET, key, nonce, deadline, abi.encode(a), 1, loosens));
        return pid;
    }

    function list(uint256 from, uint256 max) external view returns (address[] memory out) {
        uint256 n = from >= listed.length ? 0 : listed.length - from;
        if (n > max) n = max;
        out = new address[](n);
        for (uint256 i; i < n; ++i) out[i] = listed[from + i];
    }

    function isActive(address asset) external view returns (bool) {
        return assetOf[asset].status == uint8(P.AssetStatus.ACTIVE);
    }

    function _structHash(uint8, bytes memory fields) internal pure override returns (bytes32) {
        return P.hash(abi.decode(fields, (P.AssetAttestation)));
    }

    function _onReady(uint8, bytes memory fields) internal override {
        P.AssetAttestation memory a = abi.decode(fields, (P.AssetAttestation));
        if (!assetOf[a.asset].known) listed.push(a.asset);
        assetOf[a.asset] = Asset(a.kind, a.status, a.maxWeightBps, true);
    }

    function _rank(uint8 status) internal pure returns (uint8) {
        if (status == uint8(P.AssetStatus.ACTIVE)) return 0;
        if (status == uint8(P.AssetStatus.SUSPENDED)) return 1;
        return 2;
    }

    function _reissueFields(uint8, bytes memory fields, uint64 deadline, bytes32 fiscoRef) internal pure override returns (bytes memory) {
        P.AssetAttestation memory a = abi.decode(fields, (P.AssetAttestation));
        (a.deadline, a.fiscoRef) = (deadline, fiscoRef);
        return abi.encode(a);
    }
}
