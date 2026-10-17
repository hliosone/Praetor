// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {PraetorTypes as P} from "../sol/PraetorTypes.sol";

/// Asserts the Solidity twin against the golden vectors written by vectors/make-vectors.ts.
contract ProtocolVectorsTest is Test {
    using stdJson for string;

    address constant TEST_VC = 0x00000000000000000000000000000000DeaDBeef;

    function _read(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/vectors/", name, ".json"));
    }

    function _uint(string memory j, string memory key) internal pure returns (uint256) {
        return vm.parseUint(j.readString(key));
    }

    function _recover(bytes32 d, bytes memory sig) internal pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(d, v, r, s);
    }

    /// Type string, typehash, struct hash, digest under the test domain, and every listed signature.
    function _checkTyped(string memory j, string memory typeString, bytes32 typeHash, bytes32 structHash) internal pure returns (bytes32 d) {
        assertEq(typeString, j.readString(".encodeType"), "type string");
        assertEq(typeHash, keccak256(bytes(typeString)), "typehash constant");
        assertEq(typeHash, j.readBytes32(".typehash"), "typehash");
        assertEq(structHash, j.readBytes32(".structHash"), "structHash");
        d = P.digest(P.domainSeparator("Praetor-test", TEST_VC), structHash);
        assertEq(d, j.readBytes32(".digest"), "digest");
        bytes[] memory sorted = j.readBytesArray(".sortedSigs");
        address last;
        for (uint256 i; i < sorted.length; ++i) {
            address who = _recover(d, sorted[i]);
            assertGt(uint160(who), uint160(last), "sorted ascending");
            last = who;
        }
    }

    function test_domainConstants() public pure {
        assertEq(P.BASE_CHAIN_ID, 84532);
        assertEq(P.MAX_AMOUNT, 2 ** 128);
        assertEq(
            P.domainSeparator("Praetor-test", TEST_VC),
            keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Praetor-test"), keccak256("1"), uint256(84532), TEST_VC))
        );
    }

    function test_enumsMatchWireValues() public pure {
        assertEq(uint8(P.Reason.INVALID_AMOUNT), 27);
        assertEq(uint8(P.Reason.HIDDEN_CALL), 20);
        assertEq(uint8(P.Reason.TIER3_REQUIRED), 26);
        assertEq(uint8(P.Status.FROZEN), 2);
        assertEq(uint8(P.Tier.T4_CONSORTIUM), 4);
        assertEq(uint8(P.OwnerActionKind.REMOVE_PAYEE), 12);
        assertEq(uint8(P.AssetStatus.DELISTED), 3);
        assertEq(uint8(P.Rail.WECHAT_PAY), 2);
        assertEq(uint8(P.PriceSource.DEMO), 1);
        assertEq(uint8(P.AuthKind.SOTER), 1);
        assertEq(uint8(P.AssetKind.PAYOUT_PARTNER), 2);
        assertEq(uint8(P.RiskProfile.GROWTH), 3);
    }

    function test_status() public view {
        string memory j = _read("status-attestation");
        P.StatusAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.StatusAttestation));
        _checkTyped(j, P.STATUS_TYPE, P.STATUS_TYPEHASH, P.hash(m));
    }

    function test_heartbeat() public view {
        string memory j = _read("heartbeat-attestation");
        P.HeartbeatAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.HeartbeatAttestation));
        _checkTyped(j, P.HEARTBEAT_TYPE, P.HEARTBEAT_TYPEHASH, P.hash(m));
    }

    function test_caps() public view {
        string memory j = _read("caps-attestation");
        P.CapsAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.CapsAttestation));
        _checkTyped(j, P.CAPS_TYPE, P.CAPS_TYPEHASH, P.hash(m));
    }

    function test_kya() public view {
        string memory j = _read("kya-attestation");
        P.KYAAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.KYAAttestation));
        _checkTyped(j, P.KYA_TYPE, P.KYA_TYPEHASH, P.hash(m));
        assertEq(m.jurisdiction, bytes2("HK"));
    }

    function test_asset() public view {
        string memory j = _read("asset-attestation");
        P.AssetAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.AssetAttestation));
        _checkTyped(j, P.ASSET_TYPE, P.ASSET_TYPEHASH, P.hash(m));
    }

    function test_sanctions() public view {
        string memory j = _read("sanctions-attestation");
        P.SanctionsAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.SanctionsAttestation));
        _checkTyped(j, P.SANCTIONS_TYPE, P.SANCTIONS_TYPEHASH, P.hash(m));
    }

    function test_jurisdiction() public view {
        string memory j = _read("jurisdiction-attestation");
        P.JurisdictionAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.JurisdictionAttestation));
        _checkTyped(j, P.JURISDICTION_TYPE, P.JURISDICTION_TYPEHASH, P.hash(m));
    }

    function test_attester() public view {
        string memory j = _read("attester-attestation");
        P.AttesterAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.AttesterAttestation));
        _checkTyped(j, P.ATTESTER_TYPE, P.ATTESTER_TYPEHASH, P.hash(m));
    }

    function test_anchor() public view {
        string memory j = _read("anchor-attestation");
        P.AnchorAttestation memory m = abi.decode(j.readBytes(".encoded"), (P.AnchorAttestation));
        _checkTyped(j, P.ANCHOR_TYPE, P.ANCHOR_TYPEHASH, P.hash(m));
    }

    function test_standingOrder() public view {
        string memory j = _read("standing-order");
        P.StandingOrder memory m = abi.decode(j.readBytes(".encoded"), (P.StandingOrder));
        _checkTyped(j, P.STANDING_ORDER_TYPE, P.STANDING_ORDER_TYPEHASH, P.hash(m));
    }

    function test_soterApproval() public view {
        string memory j = _read("soter-approval");
        P.SoterApproval memory m = abi.decode(j.readBytes(".encoded"), (P.SoterApproval));
        bytes32 d = _checkTyped(j, P.SOTER_TYPE, P.SOTER_TYPEHASH, P.hash(m));
        assertEq(m.digest, _read("tier2-approval").readBytes32(".digest"), "approves the Tier2Approval digest");
        assertEq(_recover(d, j.readBytes(".signatures[0].sig")), _read("keys").readAddress(".attester"));
    }

    function test_tier2ApprovalAndPasskey() public view {
        string memory j = _read("tier2-approval");
        P.Tier2Approval memory m = abi.decode(j.readBytes(".encoded"), (P.Tier2Approval));
        bytes32 d = _checkTyped(j, P.TIER2_TYPE, P.TIER2_TYPEHASH, P.hash(m));
        uint256 x = _uint(j, ".passkey.x");
        uint256 y = _uint(j, ".passkey.y");
        WebAuthn.WebAuthnAuth memory low = abi.decode(j.readBytes(".passkeyAuthEncoded"), (WebAuthn.WebAuthnAuth));
        assertTrue(WebAuthn.verify(abi.encodePacked(d), true, low, x, y), "low-s passkey verifies");
        WebAuthn.WebAuthnAuth memory high = abi.decode(j.readBytes(".highSAuthEncoded"), (WebAuthn.WebAuthnAuth));
        assertFalse(WebAuthn.verify(abi.encodePacked(d), true, high, x, y), "high-s refused");
        assertFalse(WebAuthn.verify(abi.encodePacked(bytes32(uint256(d) ^ 1)), true, low, x, y), "other challenge refused");
        (bytes32 cred, WebAuthn.WebAuthnAuth memory again) = abi.decode(j.readBytes(".passkeySignature"), (bytes32, WebAuthn.WebAuthnAuth));
        assertEq(cred, j.readBytes32(".passkey.credIdHash"));
        assertEq(again.s, low.s);
    }

    function test_ownerAction() public view {
        string memory j = _read("owner-action");
        P.OwnerAction memory m = abi.decode(j.readBytes(".encoded"), (P.OwnerAction));
        bytes32 d = _checkTyped(j, P.OWNER_ACTION_TYPE, P.OWNER_ACTION_TYPEHASH, P.hash(m));
        assertEq(m.payloadHash, keccak256(j.readBytes(".payload")), "SET_POLICY payloadHash = policyHash");
        assertEq(_recover(d, j.readBytes(".signatures[0].sig")), _read("keys").readAddress(".bank"));

        P.OwnerAuth memory pk = abi.decode(j.readBytes(".passkeyOwnerAuth"), (P.OwnerAuth));
        assertEq(pk.kind, uint8(P.AuthKind.PASSKEY));
        (, WebAuthn.WebAuthnAuth memory auth) = abi.decode(pk.data, (bytes32, WebAuthn.WebAuthnAuth));
        string memory t2 = _read("tier2-approval");
        assertTrue(WebAuthn.verify(abi.encodePacked(d), true, auth, _uint(t2, ".passkey.x"), _uint(t2, ".passkey.y")));

        P.OwnerAuth memory so = abi.decode(j.readBytes(".soterOwnerAuth"), (P.OwnerAuth));
        assertEq(so.kind, uint8(P.AuthKind.SOTER));
        (P.SoterApproval memory sa, bytes memory sig) = abi.decode(so.data, (P.SoterApproval, bytes));
        assertEq(sa.digest, d);
        bytes32 sd = P.digest(P.domainSeparator("Praetor-test", TEST_VC), P.hash(sa));
        assertEq(_recover(sd, sig), _read("keys").readAddress(".attester"));
    }

    function test_callHash() public view {
        string memory j = _read("callhash");
        for (uint256 i; i < 4; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            bytes32 h = P.callHash(j.readAddress(string.concat(k, ".account")), j.readAddress(string.concat(k, ".target")),
                _uint(j, string.concat(k, ".value")), j.readBytes(string.concat(k, ".data")));
            assertEq(h, j.readBytes32(string.concat(k, ".callHash")));
        }
    }

    function test_identifiers() public view {
        string memory j = _read("identifiers");
        bytes32 b = P.bindingHash(keccak256(bytes(j.readString(".binding.mpAppId"))), keccak256(bytes(j.readString(".binding.openid"))),
            keccak256(bytes(j.readString(".binding.uid"))), keccak256(bytes(j.readString(".binding.cpuId"))));
        assertEq(b, j.readBytes32(".binding.bindingHash"));
        bytes32 ref = keccak256(bytes(j.readString(".merchant.merchantId")));
        assertEq(ref, j.readBytes32(".merchant.merchantRef"));
        assertEq(P.merchantKey(j.readAddress(".merchant.partner"), ref), j.readBytes32(".merchant.merchantKey"));
        assertEq(P.fiscoRef(j.readAddress(".fiscoRef.fiscoContract"), _uint(j, ".fiscoRef.proposalId")), j.readBytes32(".fiscoRef.fiscoRef"));
    }

    function test_valueUsd6() public view {
        string memory j = _read("value-usd6");
        for (uint256 i; i < 9; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            (bool ok, uint256 v) = P.valueUsd6(_uint(j, string.concat(k, ".amount")), _uint(j, string.concat(k, ".price8")),
                uint8(j.readUint(string.concat(k, ".decimals"))));
            bool refused = j.readBool(string.concat(k, ".refused"));
            assertEq(ok, !refused);
            if (ok) assertEq(v, _uint(j, string.concat(k, ".valueUsd6")));
        }
    }

    function test_policyRules() public view {
        string memory j = _read("policy");
        uint256 nowTs = _uint(j, ".now");
        address usdc = j.readAddress(".usdc");
        uint256 n = j.readStringArray(".rules").length;
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".cases[", vm.toString(i), "]");
            P.Policy memory p = abi.decode(j.readBytes(string.concat(k, ".encoded")), (P.Policy));
            assertEq(P.validatePolicy(p, nowTs, usdc), j.readUint(string.concat(k, ".rule")), j.readString(string.concat(k, ".name")));
            assertEq(P.policyHash(p), j.readBytes32(string.concat(k, ".policyHash")));
        }
    }

    function test_ownerActionPayloads() public view {
        string memory j = _read("owner-action-payloads");
        for (uint256 i; i < 14; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            uint8 kind = uint8(j.readUint(string.concat(k, ".kind")));
            bytes memory payload = j.readBytes(string.concat(k, ".payload"));
            bytes32 expected = j.readBytes32(string.concat(k, ".payloadHash"));
            address account = j.readAddress(string.concat(k, ".args.account"));
            assertEq(P.ownerActionPayloadHash(account, kind, payload), expected, j.readString(string.concat(k, ".name")));
        }
    }

    function test_auditChain() public view {
        string memory j = _read("audit-chain");
        bytes32 head;
        for (uint256 i; i < 5; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            assertEq(j.readBytes32(string.concat(k, ".prevHead")), head);
            head = P.nextHead(head, j.readBytes32(string.concat(k, ".entryHash")));
            assertEq(head, j.readBytes32(string.concat(k, ".head")));
        }
    }
}
