// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";

/// Records what the hook asks of the executor; the real StandingOrders has its own tests.
contract StandingOrdersMock {
    P.StandingOrder public last;
    address public cancelledAccount;
    uint32 public cancelledId;

    function set(P.StandingOrder calldata o) external {
        last = o;
    }

    function cancel(address account, uint32 id) external {
        cancelledAccount = account;
        cancelledId = id;
    }
}
