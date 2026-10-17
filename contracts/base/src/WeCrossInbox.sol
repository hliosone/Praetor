// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";

interface IHookSetters {
    function applyStatus(P.StatusAttestation calldata a, bytes[] calldata sigs) external;
    function applyHeartbeat(P.HeartbeatAttestation calldata a, bytes[] calldata sigs) external;
    function applyCaps(P.CapsAttestation calldata a, bytes[] calldata sigs) external;
    function applyKYA(P.KYAAttestation calldata a, bytes[] calldata sigs) external;
    function applyAsset(P.AssetAttestation calldata a, bytes[] calldata sigs) external;
    function applySanctions(P.SanctionsAttestation calldata a, bytes[] calldata sigs) external;
    function applyJurisdiction(P.JurisdictionAttestation calldata a, bytes[] calldata sigs) external;
    function applyAttester(P.AttesterAttestation calldata a, bytes[] calldata sigs) external;
}

interface IAnchorSink {
    function anchor(P.AnchorAttestation calldata a, bytes[] calldata sigs) external;
}

/// @notice Landing point of WeCross deliveries on Base (spec 03). WeCross calls `string[] f(string[])`:
/// args[0] = message type, args[1] = hex of abi.encode(attestation, bytes[] sigs). Permissionless: the hook verifies
/// the member signatures itself, the transport is untrusted. Returns ["ok", nonce] or ["error", reason] and never
/// reverts the router call.
contract WeCrossInbox {
    IHookSetters public immutable hook;
    IAnchorSink public immutable anchorSink;

    error OnlySelf();

    constructor(address hook_, address anchor_) {
        hook = IHookSetters(hook_);
        anchorSink = IAnchorSink(anchor_);
    }

    function deliver(string[] calldata args) external returns (string[] memory out) {
        out = new string[](2);
        if (args.length < 2) return _err(out, "BAD_ARGS");
        (bool okHex, bytes memory payload) = _fromHex(bytes(args[1]));
        if (!okHex) return _err(out, "BAD_HEX");
        try this.route(args[0], payload) returns (uint256 id) {
            out[0] = "ok";
            out[1] = Strings.toString(id);
        } catch (bytes memory reason) {
            out[0] = "error";
            out[1] = reason.length == 0 ? "REVERTED" : _isUnknown(reason) ? "UNKNOWN_TYPE" : _hex(reason);
        }
    }

    /// External only so `deliver` can catch its reverts; callable by this contract alone.
    function route(string calldata kind, bytes calldata payload) external returns (uint256) {
        if (msg.sender != address(this)) revert OnlySelf();
        bytes32 k = keccak256(bytes(kind));
        if (k == keccak256("Status")) {
            (P.StatusAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.StatusAttestation, bytes[]));
            hook.applyStatus(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Heartbeat")) {
            (P.HeartbeatAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.HeartbeatAttestation, bytes[]));
            hook.applyHeartbeat(a, sigs);
            return a.epoch;
        }
        if (k == keccak256("Caps")) {
            (P.CapsAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.CapsAttestation, bytes[]));
            hook.applyCaps(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("KYA")) {
            (P.KYAAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.KYAAttestation, bytes[]));
            hook.applyKYA(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Asset")) {
            (P.AssetAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.AssetAttestation, bytes[]));
            hook.applyAsset(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Sanctions")) {
            (P.SanctionsAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.SanctionsAttestation, bytes[]));
            hook.applySanctions(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Jurisdiction")) {
            (P.JurisdictionAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.JurisdictionAttestation, bytes[]));
            hook.applyJurisdiction(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Attester")) {
            (P.AttesterAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.AttesterAttestation, bytes[]));
            hook.applyAttester(a, sigs);
            return a.nonce;
        }
        if (k == keccak256("Anchor")) {
            (P.AnchorAttestation memory a, bytes[] memory sigs) = abi.decode(payload, (P.AnchorAttestation, bytes[]));
            anchorSink.anchor(a, sigs);
            return a.seq;
        }
        revert UnknownType();
    }

    error UnknownType();

    function _isUnknown(bytes memory reason) internal pure returns (bool) {
        return reason.length == 4 && bytes4(reason) == UnknownType.selector;
    }

    function _err(string[] memory out, string memory why) internal pure returns (string[] memory) {
        out[0] = "error";
        out[1] = why;
        return out;
    }

    function _hex(bytes memory b) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory s = new bytes(2 + b.length * 2);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i; i < b.length; ++i) {
            s[2 + i * 2] = alphabet[uint8(b[i]) >> 4];
            s[3 + i * 2] = alphabet[uint8(b[i]) & 0x0f];
        }
        return string(s);
    }

    function _fromHex(bytes memory s) internal pure returns (bool, bytes memory) {
        uint256 start = s.length >= 2 && s[0] == "0" && (s[1] == "x" || s[1] == "X") ? 2 : 0;
        if ((s.length - start) % 2 != 0) return (false, "");
        bytes memory out = new bytes((s.length - start) / 2);
        for (uint256 i; i < out.length; ++i) {
            (bool okA, uint8 a) = _nibble(s[start + 2 * i]);
            (bool okB, uint8 b) = _nibble(s[start + 2 * i + 1]);
            if (!okA || !okB) return (false, "");
            out[i] = bytes1(a * 16 + b);
        }
        return (true, out);
    }

    function _nibble(bytes1 c) internal pure returns (bool, uint8) {
        uint8 x = uint8(c);
        if (x >= 48 && x <= 57) return (true, x - 48);
        if (x >= 97 && x <= 102) return (true, x - 87);
        if (x >= 65 && x <= 70) return (true, x - 55);
        return (false, 0);
    }
}
