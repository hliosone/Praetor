// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";

/// @notice The consortium's members (bank, regulator, operator): FISCO account, Base signer key, SM2 binding
/// (Guomi profile), plus the Base domain (baseHook, domainName) every board signs under, and the transport
/// accounts allowed to mark outbox messages delivered. Bootstrapped once by the deployer; every later change needs
/// 2 of the 3 members (our app-level multisig: the FISCO committee governs the chain only, spec 04).
contract MemberRegistry {
    struct Member {
        address fiscoAccount;
        address baseSigner;
        bytes sm2Binding;
    }

    struct Change {
        uint8 kind;
        bytes data;
        uint8 approvals; // bitmask of roles
        bool done;
    }

    uint8 public constant BANK = 0;
    uint8 public constant REGULATOR = 1;
    uint8 public constant OPERATOR = 2;
    uint8 internal constant SET_MEMBER = 0;
    uint8 internal constant SET_BASE_HOOK = 1;
    uint8 internal constant SET_DOMAIN_NAME = 2;
    uint8 internal constant SET_TRANSPORTS = 3;

    address public immutable deployer;
    bool public bootstrapped;
    Member[3] internal members;
    address public baseHook;
    string public domainName;
    address public router;
    address public relayer;
    Change[] internal changes;

    error OnlyDeployer();
    error AlreadyBootstrapped();
    error NotMember();
    error AlreadyApproved();
    error InvalidChange();

    event MemberSet(uint8 indexed role, address fiscoAccount, address baseSigner);
    event DomainSet(address baseHook, string domainName);
    event TransportsSet(address router, address relayer);
    event ChangeProposed(uint256 indexed id, uint8 kind, address by);
    event ChangeApproved(uint256 indexed id, uint8 role);

    constructor() {
        deployer = msg.sender;
    }

    function bootstrap(Member[3] calldata m, address baseHook_, string calldata domainName_, address router_, address relayer_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (bootstrapped) revert AlreadyBootstrapped();
        bootstrapped = true;
        for (uint8 r; r < 3; ++r) _setMember(r, m[r].fiscoAccount, m[r].baseSigner, m[r].sm2Binding);
        _setDomain(baseHook_, domainName_);
        _setTransports(router_, relayer_);
    }

    /// kind 0 setMember(role, fiscoAccount, baseSigner, sm2Binding), 1 setBaseHook(address), 2 setDomainName(string),
    /// 3 setTransports(router, relayer). The proposer's approval counts.
    function proposeChange(uint8 kind, bytes calldata data) external returns (uint256 id) {
        uint8 role = _role(msg.sender);
        if (kind > SET_TRANSPORTS) revert InvalidChange();
        changes.push(Change(kind, data, uint8(1 << role), false));
        id = changes.length - 1;
        emit ChangeProposed(id, kind, msg.sender);
        emit ChangeApproved(id, role);
    }

    function approveChange(uint256 id) external {
        uint8 role = _role(msg.sender);
        Change storage c = changes[id];
        if (c.done) revert InvalidChange();
        if (c.approvals & (1 << role) != 0) revert AlreadyApproved();
        c.approvals |= uint8(1 << role);
        emit ChangeApproved(id, role);
        if (_count(c.approvals) >= 2) {
            c.done = true;
            _apply(c.kind, c.data);
        }
    }

    function memberOf(uint8 role) external view returns (Member memory) {
        return members[role];
    }

    /// (true, role) for a member's FISCO account.
    function roleOf(address fiscoAccount) public view returns (bool, uint8) {
        for (uint8 r; r < 3; ++r) if (members[r].fiscoAccount == fiscoAccount && fiscoAccount != address(0)) return (true, r);
        return (false, 0);
    }

    /// (true, role) for a member's Base signer key.
    function signerRole(address baseSigner) external view returns (bool, uint8) {
        for (uint8 r; r < 3; ++r) if (members[r].baseSigner == baseSigner && baseSigner != address(0)) return (true, r);
        return (false, 0);
    }

    function baseSignerOf(uint8 role) external view returns (address) {
        return members[role].baseSigner;
    }

    /// The Base EIP-712 domain: constant chain id 84532 (never FISCO's 20200), name and hook from this registry.
    function domainSeparator() external view returns (bytes32) {
        return P.domainSeparator(domainName, baseHook);
    }

    function _apply(uint8 kind, bytes memory data) internal {
        if (kind == SET_MEMBER) {
            (uint8 role, address fisco, address signer, bytes memory binding) = abi.decode(data, (uint8, address, address, bytes));
            if (role > OPERATOR) revert InvalidChange();
            _setMember(role, fisco, signer, binding);
        } else if (kind == SET_BASE_HOOK) {
            _setDomain(abi.decode(data, (address)), domainName);
        } else if (kind == SET_DOMAIN_NAME) {
            _setDomain(baseHook, abi.decode(data, (string)));
        } else {
            (address r, address l) = abi.decode(data, (address, address));
            _setTransports(r, l);
        }
    }

    function _setMember(uint8 role, address fisco, address signer, bytes memory binding) internal {
        members[role] = Member(fisco, signer, binding);
        emit MemberSet(role, fisco, signer);
    }

    function _setDomain(address hook, string memory name) internal {
        baseHook = hook;
        domainName = name;
        emit DomainSet(hook, name);
    }

    function _setTransports(address router_, address relayer_) internal {
        router = router_;
        relayer = relayer_;
        emit TransportsSet(router_, relayer_);
    }

    function _role(address who) internal view returns (uint8) {
        (bool ok, uint8 role) = roleOf(who);
        if (!ok) revert NotMember();
        return role;
    }

    function _count(uint8 mask) internal pure returns (uint8 n) {
        for (uint8 i; i < 3; ++i) if (mask & (1 << i) != 0) ++n;
    }
}
