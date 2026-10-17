// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";

// What MandateHook calls on the modules it administers.

interface IPasskeyKeys {
    function ownerKey(address account, bytes32 credIdHash) external view returns (uint256 x, uint256 y);
    function setKey(address account, bytes32 credIdHash, uint256 x, uint256 y) external;
    function replaceAllKeys(address account, bytes32 credIdHash, uint256 x, uint256 y) external;
}

interface IAgentKeys {
    function setKey(address account, address key, uint48 validUntil) external;
    function revoke(address account) external;
}

interface IStandingOrdersAdmin {
    function set(P.StandingOrder calldata o) external;
    function cancel(address account, uint32 id) external;
}
