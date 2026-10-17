// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice Agent status per account (account 0 = global) and the heartbeat (spec 04). Any member opens; tightening
/// needs 1 signature, the same or a looser status 2; a heartbeat needs 1 and takes epoch = stored + 1.
contract AgentStatus is Board {
    mapping(address => uint8) public statusOf;
    uint64 public heartbeatValidUntil;

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function openStatus(address account, uint8 status, uint64 deadline) external onlyMember returns (uint256 id) {
        if (status > uint8(P.Status.FROZEN)) revert InvalidValue();
        (uint256 pid, uint64 nonce, bytes32 key) = _allocate(STATUS, bytes32(uint256(uint160(account))), deadline);
        P.StatusAttestation memory a = P.StatusAttestation(account, status, nonce, deadline, _fiscoRef(pid));
        _store(pid, Draft(STATUS, key, nonce, deadline, abi.encode(a), status > statusOf[account] ? 1 : 2, false));
        return pid;
    }

    function openHeartbeat(uint64 validUntil, uint64 deadline) external onlyMember returns (uint256 id) {
        if (validUntil > _nowSeconds() + 1 days) revert InvalidValue();
        (uint256 pid, uint64 epoch, bytes32 key) = _allocate(HEARTBEAT, bytes32(0), deadline);
        P.HeartbeatAttestation memory h = P.HeartbeatAttestation(epoch, validUntil, deadline);
        _store(pid, Draft(HEARTBEAT, key, epoch, deadline, abi.encode(h), 1, false));
        return pid;
    }

    function _structHash(uint8 kind, bytes memory fields) internal pure override returns (bytes32) {
        if (kind == STATUS) return P.hash(abi.decode(fields, (P.StatusAttestation)));
        return P.hash(abi.decode(fields, (P.HeartbeatAttestation)));
    }

    function _onReady(uint8 kind, bytes memory fields) internal override {
        if (kind == STATUS) {
            P.StatusAttestation memory a = abi.decode(fields, (P.StatusAttestation));
            statusOf[a.account] = a.status;
        } else {
            heartbeatValidUntil = abi.decode(fields, (P.HeartbeatAttestation)).validUntil;
        }
    }

    function _reissueFields(uint8 kind, bytes memory fields, uint64 deadline, bytes32 fiscoRef) internal pure override returns (bytes memory) {
        if (kind == STATUS) {
            P.StatusAttestation memory a = abi.decode(fields, (P.StatusAttestation));
            (a.deadline, a.fiscoRef) = (deadline, fiscoRef);
            return abi.encode(a);
        }
        P.HeartbeatAttestation memory h = abi.decode(fields, (P.HeartbeatAttestation));
        h.deadline = deadline;
        return abi.encode(h);
    }
}
