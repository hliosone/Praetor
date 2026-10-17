// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice Sanctioned addresses: listing needs 1 member, delisting 2 (spec 02).
contract SanctionsList is Board {
    mapping(address => bool) public isListed;
    address[] internal entries;
    mapping(address => bool) internal seen;

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function openSanctions(address target, bool listed, uint64 deadline) external onlyMember returns (uint256 id) {
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(SANCTIONS, bytes32(uint256(uint160(target))), deadline);
        P.SanctionsAttestation memory a = P.SanctionsAttestation(target, listed, nonce, deadline, _fiscoRef(pid));
        _store(pid, Draft(SANCTIONS, key, nonce, deadline, abi.encode(a), listed ? 1 : 2, false));
        return pid;
    }

    function list(uint256 from, uint256 max) external view returns (address[] memory out) {
        uint256 n = from >= entries.length ? 0 : entries.length - from;
        if (n > max) n = max;
        out = new address[](n);
        for (uint256 i; i < n; ++i) out[i] = entries[from + i];
    }

    function _structHash(uint8, bytes memory fields) internal pure override returns (bytes32) {
        return P.hash(abi.decode(fields, (P.SanctionsAttestation)));
    }

    function _onReady(uint8, bytes memory fields) internal override {
        P.SanctionsAttestation memory a = abi.decode(fields, (P.SanctionsAttestation));
        isListed[a.target] = a.listed;
        if (!seen[a.target]) {
            seen[a.target] = true;
            entries.push(a.target);
        }
    }

    function _reissueFields(uint8, bytes memory fields, uint64 deadline, bytes32 fiscoRef) internal pure override returns (bytes memory) {
        P.SanctionsAttestation memory a = abi.decode(fields, (P.SanctionsAttestation));
        (a.deadline, a.fiscoRef) = (deadline, fiscoRef);
        return abi.encode(a);
    }
}
