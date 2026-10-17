// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {Compliance} from "./Compliance.sol";

/// @notice tXAU / tXAG: ERC-3643 permissioned tokens, 18 decimals, 1 token = 1 troy ounce, issued by the demo team
/// and backed by nothing (spec 00). Own implementation. Roles: owner (role admin), agents (the bank's key: freeze,
/// forced transfer, burn any holder, recovery, pause; a known risk listed in spec 08) and minters (the desk: mint to
/// verified holders and burn only its own balance).
contract PraetorToken is ERC20, Ownable {
    IdentityRegistry public immutable identityRegistry;
    Compliance public immutable compliance;

    bool public paused;
    mapping(address => bool) public isAgent;
    mapping(address => bool) public isMinter;
    mapping(address => bool) public isFrozen;
    mapping(address => uint256) internal frozenTokens;

    error OnlyAgent();
    error OnlyMinterOrAgent();
    error TokenPaused();
    error AddressFrozen();
    error InsufficientFreeBalance();
    error TransferNotCompliant();

    event AgentSet(address indexed agent, bool enabled);
    event MinterSet(address indexed minter, bool enabled);
    event Paused(bool paused);
    event AddressFrozenSet(address indexed wallet, bool frozen, address indexed by);
    event TokensFrozen(address indexed wallet, uint256 amount);
    event TokensUnfrozen(address indexed wallet, uint256 amount);
    event RecoverySuccess(address indexed lostWallet, address indexed newWallet);

    constructor(string memory name_, string memory symbol_, address owner_, address registry_, address compliance_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        identityRegistry = IdentityRegistry(registry_);
        compliance = Compliance(compliance_);
    }

    modifier onlyAgent() {
        if (!isAgent[msg.sender]) revert OnlyAgent();
        _;
    }

    function addAgent(address agent) external onlyOwner {
        isAgent[agent] = true;
        emit AgentSet(agent, true);
    }

    function removeAgent(address agent) external onlyOwner {
        isAgent[agent] = false;
        emit AgentSet(agent, false);
    }

    function setMinter(address minter, bool enabled) external onlyOwner {
        isMinter[minter] = enabled;
        emit MinterSet(minter, enabled);
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender] && !isAgent[msg.sender]) revert OnlyMinterOrAgent();
        if (!compliance.canTransfer(address(0), to, amount)) revert TransferNotCompliant();
        _mint(to, amount);
    }

    /// A minter burns only its own balance (the desk after buying metal back); agents burn anyone's.
    function burn(address from, uint256 amount) external {
        if (!isAgent[msg.sender] && !(isMinter[msg.sender] && from == msg.sender)) revert OnlyAgent();
        _reduceFrozenIfNeeded(from, amount);
        ERC20._update(from, address(0), amount);
    }

    function pause() external onlyAgent {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyAgent {
        paused = false;
        emit Paused(false);
    }

    function setAddressFrozen(address wallet, bool frozen) external onlyAgent {
        isFrozen[wallet] = frozen;
        emit AddressFrozenSet(wallet, frozen, msg.sender);
    }

    function freezePartialTokens(address wallet, uint256 amount) external onlyAgent {
        if (balanceOf(wallet) < frozenTokens[wallet] + amount) revert InsufficientFreeBalance();
        frozenTokens[wallet] += amount;
        emit TokensFrozen(wallet, amount);
    }

    function unfreezePartialTokens(address wallet, uint256 amount) external onlyAgent {
        frozenTokens[wallet] -= amount;
        emit TokensUnfrozen(wallet, amount);
    }

    function getFrozenTokens(address wallet) external view returns (uint256) {
        return frozenTokens[wallet];
    }

    function forcedTransfer(address from, address to, uint256 amount) external onlyAgent returns (bool) {
        if (!compliance.canTransfer(address(0), to, amount)) revert TransferNotCompliant();
        _reduceFrozenIfNeeded(from, amount);
        ERC20._update(from, to, amount);
        return true;
    }

    function recoveryAddress(address lostWallet, address newWallet) external onlyAgent returns (bool) {
        if (!compliance.canTransfer(address(0), newWallet, 0)) revert TransferNotCompliant();
        uint256 frozen = frozenTokens[lostWallet];
        delete frozenTokens[lostWallet];
        ERC20._update(lostWallet, newWallet, balanceOf(lostWallet));
        frozenTokens[newWallet] += frozen;
        if (isFrozen[lostWallet]) isFrozen[newWallet] = true;
        emit RecoverySuccess(lostWallet, newWallet);
        return true;
    }

    /// Ordinary transfers (and mints): not paused, neither side frozen, free balance, compliance.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            if (paused) revert TokenPaused();
            if (isFrozen[from] || isFrozen[to]) revert AddressFrozen();
            if (balanceOf(from) < frozenTokens[from] + value) revert InsufficientFreeBalance();
        }
        if (!compliance.canTransfer(from, to, value)) revert TransferNotCompliant();
        super._update(from, to, value);
    }

    function _reduceFrozenIfNeeded(address from, uint256 amount) internal {
        uint256 bal = balanceOf(from);
        uint256 free = bal > frozenTokens[from] ? bal - frozenTokens[from] : 0;
        if (amount > free) {
            uint256 unfreeze = amount - free;
            frozenTokens[from] -= unfreeze > frozenTokens[from] ? frozenTokens[from] : unfreeze;
            emit TokensUnfrozen(from, unfreeze);
        }
    }
}
