// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {MemberRegistry} from "./MemberRegistry.sol";

/// WeCrossHub (BCOS3, V4): the router polls its requests and calls the target chain.
interface IWeCrossHub {
    function interchainInvoke(string calldata path, string calldata method, string[] calldata args, string calldata callbackPath, string calldata callbackMethod)
        external
        returns (string memory uid);
}

/// @notice Ready attestations waiting for delivery to Base (spec 04). Boards enqueue; the WeCross router or the
/// bridge-relayer mark a message delivered once with its Base tx (first write wins). The transport is untrusted:
/// Base verifies the member signatures itself. Relayers poll `pending` (a view, no getLogs quirk).
/// WeCross (spec 04, D42): the WeCross router account asks for a message's delivery with `requestWeCross`, so the
/// interchain request carries the router's own identity (tx.origin), never a member's; WeCrossInbox on Base decodes
/// args[1] = hex of abi.encode(attestation, sigs). Its callback is a hint: the relayer watchdog still delivers or
/// records anything WeCross did not.
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
    address public hub;
    address public hubProxy;
    mapping(uint256 => bool) public requested;

    error OnlyDeployer();
    error Sealed();
    error OnlyBoard();
    error OnlyTransport();
    error AlreadyDelivered();
    error HubSet();
    error NoHub();
    error OnlyRouter();
    error OnlyHubProxy();
    error AlreadyRequested();

    event Enqueued(uint256 indexed id, uint8 indexed kind, address indexed board, uint256 proposalId);
    event Delivered(uint256 indexed id, bytes32 baseTx, uint8 transport, address by);
    event WeCrossRequested(uint256 indexed id, string uid);
    event WeCrossCallback(bool state, string result);

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

    /// The WeCrossHub and the FISCO WeCrossProxy that calls back, set once by the deployer (transport only: Base
    /// verifies every message itself).
    function setHub(address hub_, address proxy_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (hub != address(0)) revert HubSet();
        hub = hub_;
        hubProxy = proxy_;
    }

    function requestWeCross(uint256 id) external returns (string memory uid) {
        if (msg.sender != registry.router()) revert OnlyRouter();
        if (hub == address(0)) revert NoHub();
        Message storage m = messages[id];
        if (m.delivered) revert AlreadyDelivered();
        if (requested[id]) revert AlreadyRequested();
        requested[id] = true;
        string[] memory args = new string[](3);
        args[0] = _kindName(m.kind);
        args[1] = _hex(_withSigs(m.payload, m.sigs));
        args[2] = Strings.toString(id);
        uid = IWeCrossHub(hub).interchainInvoke("payment.base.inbox", "deliver", args, "payment.fisco.outbox", "onDelivered");
        emit WeCrossRequested(id, uid);
    }

    /// WeCross's callback after the Base call: a hint for the consoles, the watchdog records the delivery.
    function onDelivered(bool state, string[] calldata result) external returns (string[] memory) {
        if (msg.sender != hubProxy) revert OnlyHubProxy();
        emit WeCrossCallback(state, result.length > 0 ? result[0] : "");
        return result;
    }

    /// abi.encode(attestation, sigs) from the attestation's encoding: every attestation is a static tuple, so the
    /// signatures' offset is right after it.
    function _withSigs(bytes memory payload, bytes[] memory sigs) internal pure returns (bytes memory) {
        bytes memory arr = abi.encode(sigs);
        bytes memory tail = new bytes(arr.length - 32);
        for (uint256 i; i < tail.length; ++i) tail[i] = arr[i + 32];
        return bytes.concat(payload, abi.encode(payload.length + 32), tail);
    }

    function _kindName(uint8 kind) internal pure returns (string memory) {
        string[9] memory names = ["Status", "Heartbeat", "Caps", "KYA", "Asset", "Sanctions", "Jurisdiction", "Attester", "Anchor"];
        return names[kind];
    }

    function _hex(bytes memory b) internal pure returns (string memory) {
        bytes memory digits = "0123456789abcdef";
        bytes memory out = new bytes(2 + b.length * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < b.length; ++i) {
            out[2 + 2 * i] = digits[uint8(b[i]) >> 4];
            out[3 + 2 * i] = digits[uint8(b[i]) & 0x0f];
        }
        return string(out);
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
