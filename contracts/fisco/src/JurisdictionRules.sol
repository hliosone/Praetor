// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice Jurisdictions where stablecoin payouts are blocked (e.g. CN): block needs 1 member, unblock 2.
contract JurisdictionRules is Board {
    mapping(bytes2 => bool) public isPayoutBlocked;

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function openJurisdiction(bytes2 jurisdiction, bool payoutBlocked, uint64 deadline) external onlyMember returns (uint256 id) {
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(JURISDICTION, bytes32(jurisdiction), deadline);
        P.JurisdictionAttestation memory a = P.JurisdictionAttestation(jurisdiction, payoutBlocked, nonce, deadline, _fiscoRef(pid));
        _store(pid, Draft(JURISDICTION, key, nonce, deadline, abi.encode(a), payoutBlocked ? 1 : 2, false));
        return pid;
    }

    function _structHash(uint8, bytes memory fields) internal pure override returns (bytes32) {
        return P.hash(abi.decode(fields, (P.JurisdictionAttestation)));
    }

    function _onReady(uint8, bytes memory fields) internal override {
        P.JurisdictionAttestation memory a = abi.decode(fields, (P.JurisdictionAttestation));
        isPayoutBlocked[a.jurisdiction] = a.payoutBlocked;
    }
}
