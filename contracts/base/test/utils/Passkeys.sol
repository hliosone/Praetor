// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";

/// Software P-256 authenticator for tests: the automated stand-in for a phone's passkey (spec 06).
abstract contract Passkeys is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    struct Passkey {
        uint256 pk;
        uint256 x;
        uint256 y;
        bytes32 credIdHash;
    }

    function _passkey(string memory label) internal pure returns (Passkey memory p) {
        p.pk = uint256(keccak256(abi.encodePacked("p256:", label))) % (P256_N - 1) + 1;
        (p.x, p.y) = vm.publicKeyP256(p.pk);
        p.credIdHash = keccak256(abi.encodePacked("cred:", label));
    }

    function _auth(Passkey memory p, bytes memory challenge, bytes1 flags, bool highS)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory a)
    {
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"', Base64.encodeURL(challenge),
            '","origin":"https://praetor.localhost","crossOrigin":false}'
        );
        bytes memory authData = abi.encodePacked(sha256("praetor.localhost"), flags, uint32(1));
        bytes32 h = sha256(abi.encodePacked(authData, sha256(bytes(cdj))));
        (bytes32 r, bytes32 s) = vm.signP256(p.pk, h);
        uint256 sn = uint256(s);
        if (sn > P256_N / 2) sn = P256_N - sn;
        if (highS) sn = P256_N - sn;
        a = WebAuthn.WebAuthnAuth(authData, cdj, 23, 1, uint256(r), sn);
    }

    function _auth(Passkey memory p, bytes memory challenge) internal pure returns (WebAuthn.WebAuthnAuth memory) {
        return _auth(p, challenge, 0x05, false);
    }

    /// userOp.signature for PasskeyValidator, and OwnerAuth.data for PASSKEY.
    function _passkeySig(Passkey memory p, bytes32 h) internal pure returns (bytes memory) {
        return abi.encode(p.credIdHash, _auth(p, abi.encodePacked(h)));
    }
}
