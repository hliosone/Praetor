// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {MemberRegistry} from "./MemberRegistry.sol";
import {BaseOutbox} from "./BaseOutbox.sol";

/// @notice The consortium message board (spec 04). A member's FISCO account opens a proposal: the board allocates
/// the proposalId and the next nonce (stored + 1 per key, I18), so Base nonces always equal FISCO-allocated ones.
/// Members sign the EIP-712 digest under the Base domain with their Base signer keys; at threshold (tighten 1,
/// loosen 2, bank-only types need the bank) the board emits Ready and enqueues the attestation for Base. An expired
/// proposal is closed and its nonce released. FISCO's block.timestamp is in milliseconds; attestations carry seconds.
abstract contract Board {
    enum Status { NONE, OPEN, READY, CLOSED }

    struct Proposal {
        uint8 kind;
        Status status;
        uint64 nonce;
        uint64 deadline;
        bytes32 key;
        address opener;
        uint8 required;
        bool bankRequired;
        bool hasBank;
        bytes fields;
        bytes[] sigs;
        address[] signers;
    }

    // Message kinds, also the outbox types (WeCrossInbox args[0] in this order).
    uint8 internal constant STATUS = 0;
    uint8 internal constant HEARTBEAT = 1;
    uint8 internal constant CAPS = 2;
    uint8 internal constant KYA = 3;
    uint8 internal constant ASSET = 4;
    uint8 internal constant SANCTIONS = 5;
    uint8 internal constant JURISDICTION = 6;
    uint8 internal constant ATTESTER = 7;
    uint8 internal constant ANCHOR = 8;

    MemberRegistry public immutable registry;
    BaseOutbox public immutable outbox;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) internal proposals;
    mapping(bytes32 => uint64) public storedNonce;
    mapping(bytes32 => uint256) public openProposalOf;

    error NotMember();
    error OnlyBank();
    error ProposalOpen(uint256 id);
    error NotOpen();
    error Expired();
    error NotExpired();
    error BadSignature();
    error AlreadySigned();
    error InvalidValue();

    event ProposalOpened(uint8 indexed kind, uint256 indexed id, bytes32 indexed key, uint64 nonce, uint64 deadline, address opener);
    event Signed(uint8 indexed kind, uint256 indexed id, address signer, uint8 count);
    event Ready(uint8 indexed kind, uint256 indexed id, bytes payload, bytes[] sigs);
    event Closed(uint256 indexed id);

    constructor(address registry_, address outbox_) {
        registry = MemberRegistry(registry_);
        outbox = BaseOutbox(outbox_);
    }

    modifier onlyMember() {
        (bool ok,) = registry.roleOf(msg.sender);
        if (!ok) revert NotMember();
        _;
    }

    modifier onlyBank() {
        (bool ok, uint8 role) = registry.roleOf(msg.sender);
        if (!ok || role != registry.BANK()) revert OnlyBank();
        _;
    }

    function sign(uint256 id, bytes calldata sig) external {
        Proposal storage p = proposals[id];
        if (p.status != Status.OPEN) revert NotOpen();
        if (_nowSeconds() > p.deadline) revert Expired();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digestOf(p.fields, p.kind), sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
        (bool member, uint8 role) = registry.signerRole(signer);
        if (!member) revert NotMember();
        uint256 n = p.signers.length;
        for (uint256 i; i < n; ++i) if (p.signers[i] == signer) revert AlreadySigned();
        // Insert keeping signers ascending: Base requires sorted, distinct signers.
        p.signers.push(signer);
        p.sigs.push(sig);
        for (uint256 i = n; i > 0 && p.signers[i - 1] > signer; --i) {
            (p.signers[i], p.signers[i - 1]) = (p.signers[i - 1], p.signers[i]);
            (p.sigs[i], p.sigs[i - 1]) = (p.sigs[i - 1], p.sigs[i]);
        }
        if (role == registry.BANK()) p.hasBank = true;
        emit Signed(p.kind, id, signer, uint8(n + 1));
        if (n + 1 >= p.required && (!p.bankRequired || p.hasBank)) _ready(id, p);
    }

    /// Closes an expired proposal and releases its nonce for the next one.
    function close(uint256 id) public {
        Proposal storage p = proposals[id];
        if (p.status != Status.OPEN) revert NotOpen();
        if (_nowSeconds() <= p.deadline) revert NotExpired();
        p.status = Status.CLOSED;
        delete openProposalOf[p.key];
        emit Closed(id);
    }

    function proposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    /// The digest members sign: byte-identical to Base's for the same attestation (non-SM profile).
    function digestOf(bytes memory fields, uint8 kind) public view returns (bytes32) {
        return P.digest(registry.domainSeparator(), _structHash(kind, fields));
    }

    /// Allocates the proposal id and the nonce stored + 1 for (kind, subkey); one open proposal per key.
    function _allocate(uint8 kind, bytes32 subkey, uint64 deadline) internal returns (uint256 id, uint64 nonce, bytes32 key) {
        if (deadline <= _nowSeconds()) revert InvalidValue();
        key = keccak256(abi.encode(kind, subkey));
        uint256 open = openProposalOf[key];
        if (open != 0) {
            if (_nowSeconds() <= proposals[open].deadline) revert ProposalOpen(open);
            close(open);
        }
        id = ++proposalCount;
        nonce = storedNonce[key] + 1;
        openProposalOf[key] = id;
    }

    struct Draft {
        uint8 kind;
        bytes32 key;
        uint64 nonce;
        uint64 deadline;
        bytes fields;
        uint8 required;
        bool bankRequired;
    }

    function _store(uint256 id, Draft memory d) internal {
        Proposal storage p = proposals[id];
        p.kind = d.kind;
        p.status = Status.OPEN;
        p.nonce = d.nonce;
        p.deadline = d.deadline;
        p.key = d.key;
        p.opener = msg.sender;
        p.required = d.required;
        p.bankRequired = d.bankRequired;
        p.fields = d.fields;
        emit ProposalOpened(d.kind, id, d.key, d.nonce, d.deadline, msg.sender);
    }

    function _fiscoRef(uint256 id) internal view returns (bytes32) {
        return P.fiscoRef(address(this), id);
    }

    function _nowSeconds() internal view returns (uint64) {
        return uint64(block.timestamp / 1000);
    }

    function _ready(uint256 id, Proposal storage p) internal {
        p.status = Status.READY;
        storedNonce[p.key] = p.nonce;
        delete openProposalOf[p.key];
        _onReady(p.kind, p.fields);
        emit Ready(p.kind, id, p.fields, p.sigs);
        outbox.enqueue(p.kind, id, p.fields, p.sigs);
    }

    function _structHash(uint8 kind, bytes memory fields) internal view virtual returns (bytes32);

    /// Local state the board keeps once a decision is Ready (used for the next tighten/loosen decision).
    function _onReady(uint8 kind, bytes memory fields) internal virtual;
}
