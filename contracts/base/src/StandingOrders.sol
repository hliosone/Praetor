// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IStandingOrdersEvents} from "@praetor/protocol/PraetorEvents.sol";
import {IERC7579Module, IERC7579Account, Execution, MODULE_TYPE_EXECUTOR, MODE_SINGLE, MODE_BATCH} from "./interfaces/IERC7579.sol";
import {Modules} from "./hook/HookTypes.sol";

interface IHookModules {
    function modules() external view returns (Modules memory);
}

/// @notice Fixed-amount recurring payments (rent, subscriptions) stored in the wallet's own executor (spec 03):
/// only owner + bank create one (through MandateHook), anyone can trigger a due payment, exactly `amount`, once per
/// period, missed periods skipped. The hook still checks freeze, sanctions, jurisdiction, partner and bank caps.
/// Stores no personal data (I19): payee address, amount, period, rail and a merchant hash.
contract StandingOrders is IERC7579Module, IStandingOrdersEvents {
    struct Order {
        address payee;
        uint256 amount;
        uint32 period;
        uint64 firstDue;
        uint64 nextDue;
        uint8 rail;
        bytes32 merchantRef;
        bool active;
    }

    address public immutable hook;
    mapping(address account => mapping(uint32 id => Order)) public orders;
    mapping(address account => bool) internal installed;

    error OnlyHook();
    error InvalidOrder();
    error NotActive();
    error NotDue();

    constructor(address hook_) {
        hook = hook_;
    }

    function onInstall(bytes calldata) external {
        installed[msg.sender] = true;
    }

    function onUninstall(bytes calldata) external {
        delete installed[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function isInitialized(address account) external view returns (bool) {
        return installed[account];
    }

    function set(P.StandingOrder calldata o) external {
        if (msg.sender != hook) revert OnlyHook();
        if (o.amount == 0 || o.payee == address(0) || o.period == 0 || o.rail > uint8(P.Rail.WECHAT_PAY)) revert InvalidOrder();
        orders[o.account][o.id] = Order(o.payee, o.amount, o.period, o.firstDue, o.firstDue, o.rail, o.merchantRef, true);
        emit StandingOrderSet(o.account, o.id, P.hash(o));
    }

    function cancel(address account, uint32 id) external {
        if (msg.sender != hook) revert OnlyHook();
        orders[account][id].active = false;
        emit StandingOrderCancelled(account, id);
    }

    function execute(address account, uint32 id) external {
        Order storage o = orders[account][id];
        if (!o.active) revert NotActive();
        if (block.timestamp < o.nextDue) revert NotDue();
        uint64 periodIndex = uint64((block.timestamp - o.firstDue) / o.period);
        o.nextDue = o.firstDue + o.period * (periodIndex + 1);
        Modules memory m = IHookModules(hook).modules();
        bytes memory transfer = abi.encodeWithSelector(0xa9059cbb, o.payee, o.amount);
        if (o.rail == uint8(P.Rail.USDC_DIRECT)) {
            IERC7579Account(account).executeFromExecutor(MODE_SINGLE, abi.encodePacked(m.usdc, uint256(0), transfer));
        } else {
            bytes32 paymentRef = keccak256(abi.encode(account, id, periodIndex));
            Execution[] memory xs = new Execution[](2);
            xs[0] = Execution(m.usdc, 0, abi.encodeWithSelector(0x095ea7b3, m.payoutRail, o.amount));
            xs[1] = Execution(m.payoutRail, 0, abi.encodeWithSignature(
                "pay(address,uint256,uint8,bytes32,bytes32)", o.payee, o.amount, o.rail, o.merchantRef, paymentRef));
            IERC7579Account(account).executeFromExecutor(MODE_BATCH, abi.encode(xs));
        }
        emit StandingOrderExecuted(account, id, o.amount, periodIndex, msg.sender);
    }
}
