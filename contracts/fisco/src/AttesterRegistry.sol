// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice SOTER attester TEEs (address + measurement): activation needs the bank, deactivation any one member.
contract AttesterRegistry is Board {
    struct Attester {
        bytes32 measurement;
        bool active;
    }

    mapping(address => Attester) public attesterOf;

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function openAttester(address attester, bytes32 measurement, bool active, uint64 deadline) external onlyMember returns (uint256 id) {
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(ATTESTER, bytes32(uint256(uint160(attester))), deadline);
        P.AttesterAttestation memory a = P.AttesterAttestation(attester, measurement, active, nonce, deadline, _fiscoRef(pid));
        _store(pid, Draft(ATTESTER, key, nonce, deadline, abi.encode(a), 1, active));
        return pid;
    }

    function _structHash(uint8, bytes memory fields) internal pure override returns (bytes32) {
        return P.hash(abi.decode(fields, (P.AttesterAttestation)));
    }

    function _onReady(uint8, bytes memory fields) internal override {
        P.AttesterAttestation memory a = abi.decode(fields, (P.AttesterAttestation));
        attesterOf[a.attester] = Attester(a.measurement, a.active);
    }
}
