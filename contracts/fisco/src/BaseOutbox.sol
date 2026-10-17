// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {MemberRegistry} from "./MemberRegistry.sol";

/// @notice Ready attestations waiting for delivery to Base (spec 04). Boards enqueue; the WeCross router or the
/// bridge-relayer mark a message delivered once with its Base tx (first write wins). The transport is untrusted:
/// Base verifies the member signatures itself. Relayers poll `pending` (a view, no getLogs quirk).
contract BaseOutbox {
    struct Message {
        uint8 kind;
        address board;
        uint256 proposalId;
        bytes payload;
        bytes[] sigs;
        bool delivered;
        bytes32 baseTx;
        uint8 transport;
        uint64 enqueuedAt; // seconds (FISCO block time / 1000): the relayer watchdog acts after BRIDGE_WATCHDOG_S
    }

    MemberRegistry public immutable registry;
    address public immutable deployer;
    bool public sealed_;
    mapping(address => bool) public isBoard;
    Message[] internal messages;
    mapping(address => mapping(uint256 => uint256)) internal idPlusOne;

    error OnlyDeployer();
    error Sealed();
    error OnlyBoard();
    error OnlyTransport();
    error AlreadyDelivered();

    event Enqueued(uint256 indexed id, uint8 indexed kind, address indexed board, uint256 proposalId);
    event Delivered(uint256 indexed id, bytes32 baseTx, uint8 transport, address by);

    constructor(address registry_) {
        registry = MemberRegistry(registry_);
        deployer = msg.sender;
    }

    function addBoard(address board) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (sealed_) revert Sealed();
        isBoard[board] = true;
    }

    /// Ends the bootstrap: no board can be added afterwards.
    function seal() external {
        if (msg.sender != deployer) revert OnlyDeployer();
        sealed_ = true;
    }

    function enqueue(uint8 kind, uint256 proposalId, bytes calldata payload, bytes[] calldata sigs) external returns (uint256 id) {
        if (!isBoard[msg.sender]) revert OnlyBoard();
        messages.push();
        id = messages.length - 1;
        Message storage m = messages[id];
        m.kind = kind;
        m.board = msg.sender;
        m.proposalId = proposalId;
        m.payload = payload;
        m.enqueuedAt = uint64(block.timestamp / 1000);
        for (uint256 i; i < sigs.length; ++i) m.sigs.push(sigs[i]);
        idPlusOne[msg.sender][proposalId] = id + 1;
        emit Enqueued(id, kind, msg.sender, proposalId);
    }

    /// transport: 0 relayer, 1 WeCross.
    function markDelivered(uint256 id, bytes32 baseTx, uint8 transport) external {
        if (msg.sender != registry.router() && msg.sender != registry.relayer()) revert OnlyTransport();
        Message storage m = messages[id];
        if (m.delivered) revert AlreadyDelivered();
        m.delivered = true;
        m.baseTx = baseTx;
        m.transport = transport;
        emit Delivered(id, baseTx, transport, msg.sender);
    }

    /// Whether a board's Ready proposal reached Base (false when it was never enqueued).
    function isDelivered(address board, uint256 proposalId) external view returns (bool) {
        uint256 i = idPlusOne[board][proposalId];
        return i != 0 && messages[i - 1].delivered;
    }

    function count() external view returns (uint256) {
        return messages.length;
    }

    function message(uint256 id) external view returns (Message memory) {
        return messages[id];
    }

    /// Undelivered messages from `from`, at most `max` of them.
    function pending(uint256 from, uint256 max) external view returns (uint256[] memory ids, Message[] memory out) {
        uint256 n;
        for (uint256 i = from; i < messages.length && n < max; ++i) if (!messages[i].delivered) ++n;
        ids = new uint256[](n);
        out = new Message[](n);
        n = 0;
        for (uint256 i = from; i < messages.length && n < max; ++i) {
            if (!messages[i].delivered) {
                ids[n] = i;
                out[n++] = messages[i];
            }
        }
    }
}
