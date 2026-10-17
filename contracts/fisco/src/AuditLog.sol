// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Board} from "./Board.sol";

/// @notice Append-only audit hash chain (spec 02, 04): the operator service appends entry hashes (JSON entries live
/// off-chain, anyone can recompute them); two members anchor the current head on Base (AnchorAttestation, seq =
/// stored + 1, head and FISCO block taken from this log so nobody can anchor a head that is not here).
contract AuditLog is Board {
    uint64 public seq;
    bytes32 public head;
    mapping(uint64 => bytes32) public headAt;

    error OnlyOperator();

    event AuditAppended(uint64 indexed seq, address indexed account, uint8 kind, bytes32 entryHash, bytes32 head, bytes32 baseTx, bytes32 refId);

    constructor(address registry_, address outbox_) Board(registry_, outbox_) {}

    function append(bytes32 entryHash, uint8 kind, address account, bytes32 baseTx, bytes32 refId) external returns (uint64) {
        (bool ok, uint8 role) = registry.roleOf(msg.sender);
        if (!ok || role != registry.OPERATOR()) revert OnlyOperator();
        head = P.nextHead(head, entryHash);
        headAt[++seq] = head;
        emit AuditAppended(seq, account, kind, entryHash, head, baseTx, refId);
        return seq;
    }

    function latest() external view returns (uint64, bytes32) {
        return (seq, head);
    }

    function openAnchor(uint64 deadline) external onlyMember returns (uint256 id) {
        (uint256 pid, uint64 anchorSeq, bytes32 key) = _allocate(ANCHOR, bytes32(0), deadline);
        P.AnchorAttestation memory a = P.AnchorAttestation(anchorSeq, head, uint64(block.number), deadline);
        _store(pid, Draft(ANCHOR, key, anchorSeq, deadline, abi.encode(a), 2, false));
        return pid;
    }

    function _structHash(uint8, bytes memory fields) internal pure override returns (bytes32) {
        return P.hash(abi.decode(fields, (P.AnchorAttestation)));
    }

    function _onReady(uint8, bytes memory) internal override {}

    function _reissueFields(uint8, bytes memory fields, uint64 deadline, bytes32) internal pure override returns (bytes memory) {
        P.AnchorAttestation memory a = abi.decode(fields, (P.AnchorAttestation));
        a.deadline = deadline;
        return abi.encode(a);
    }
}
