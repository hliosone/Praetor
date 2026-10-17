// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {WeCrossInbox} from "../../src/WeCrossInbox.sol";
import {Anchor} from "../../src/Anchor.sol";
import {ConsortiumLib} from "../../src/hook/ConsortiumLib.sol";
import {HookBase} from "../utils/HookBase.sol";

/// WeCross delivers string[] -> string[]; the inbox routes to the hook's permissionless setters and never reverts.
contract WeCrossInboxTest is HookBase {
    WeCrossInbox internal inbox;
    Anchor internal anchorC;

    function setUp() public override {
        super.setUp();
        anchorC = new Anchor(address(hook));
        inbox = new WeCrossInbox(address(hook), address(anchorC));
    }

    function _args(string memory kind, bytes memory payload) internal pure returns (string[] memory a) {
        a = new string[](2);
        a[0] = kind;
        a[1] = vm.toString(payload);
    }

    function _assertOk(string[] memory r, string memory id) internal pure {
        assertEq(r.length, 2);
        assertEq(r[0], "ok");
        assertEq(r[1], id);
    }

    function test_deliversAFreeze() public {
        P.StatusAttestation memory a = P.StatusAttestation(account, 2, 1, _deadline(), keccak256("ref"));
        string[] memory r = inbox.deliver(_args("Status", abi.encode(a, _sigs(_d(P.hash(a)), _pks(regPk)))));
        _assertOk(r, "1");
        (uint8 eff,,,) = hook.statusOf(account);
        assertEq(eff, 2);
    }

    function test_deliversEveryType() public {
        P.HeartbeatAttestation memory hb = P.HeartbeatAttestation(1, uint64(block.timestamp + 60), _deadline());
        _assertOk(inbox.deliver(_args("Heartbeat", abi.encode(hb, _sigs(_d(P.hash(hb)), _pks(opPk))))), "1");
        P.CapsAttestation memory c = P.CapsAttestation(2, 1, 2, 3, 1, _deadline(), 0);
        _assertOk(inbox.deliver(_args("Caps", abi.encode(c, _sigs(_d(P.hash(c)), _pks(bankPk))))), "1");
        P.KYAAttestation memory k;
        (k.account, k.agentKey, k.kycLevel, k.riskProfile, k.jurisdiction, k.validUntil, k.nonce, k.deadline) =
            (account, agent, 2, 2, "HK", uint64(block.timestamp + 1 days), 1, _deadline());
        _assertOk(inbox.deliver(_args("KYA", abi.encode(k, _sigs(_d(P.hash(k)), _pks(bankPk))))), "1");
        P.AssetAttestation memory a = P.AssetAttestation(address(xau), 0, 1, 4000, 1, _deadline(), 0);
        _assertOk(inbox.deliver(_args("Asset", abi.encode(a, _sigs(_d(P.hash(a)), _pks(bankPk))))), "1");
        P.SanctionsAttestation memory sa = P.SanctionsAttestation(partner, true, 1, _deadline(), 0);
        _assertOk(inbox.deliver(_args("Sanctions", abi.encode(sa, _sigs(_d(P.hash(sa)), _pks(regPk))))), "1");
        P.JurisdictionAttestation memory j = P.JurisdictionAttestation("CN", true, 1, _deadline(), 0);
        _assertOk(inbox.deliver(_args("Jurisdiction", abi.encode(j, _sigs(_d(P.hash(j)), _pks(regPk))))), "1");
        P.AttesterAttestation memory at = P.AttesterAttestation(attester, keccak256("m"), true, 1, _deadline(), 0);
        _assertOk(inbox.deliver(_args("Attester", abi.encode(at, _sigs(_d(P.hash(at)), _pks(bankPk))))), "1");
        P.AnchorAttestation memory an = P.AnchorAttestation(1, keccak256("h"), 9, _deadline());
        _assertOk(inbox.deliver(_args("Anchor", abi.encode(an, _sigs(_d(P.hash(an)), _pks(bankPk, regPk))))), "1");
        assertEq(anchorC.seq(), 1);
    }

    function test_errorsComeBackAsStringsNeverAsReverts() public {
        P.StatusAttestation memory a = P.StatusAttestation(account, 2, 1, _deadline(), 0);
        string[] memory r = inbox.deliver(_args("Status", abi.encode(a, _sigs(_d(P.hash(a)), _pks(strangerPk)))));
        assertEq(r[0], "error");
        assertEq(r[1], vm.toString(abi.encodeWithSelector(ConsortiumLib.BadSignatures.selector)));
        r = inbox.deliver(_args("Nope", hex"00"));
        assertEq(r[0], "error");
        assertEq(r[1], "UNKNOWN_TYPE");
        string[] memory bad = new string[](2);
        bad[0] = "Status";
        bad[1] = "0xzz";
        r = inbox.deliver(bad);
        assertEq(r[1], "BAD_HEX");
        r = inbox.deliver(new string[](1));
        assertEq(r[1], "BAD_ARGS");
        r = inbox.deliver(_args("Status", hex"1234"));
        assertEq(r[0], "error");
    }

    function test_acceptsHexWithoutPrefix() public {
        P.StatusAttestation memory a = P.StatusAttestation(account, 1, 1, _deadline(), 0);
        string[] memory args = _args("Status", abi.encode(a, _sigs(_d(P.hash(a)), _pks(opPk))));
        bytes memory h = bytes(args[1]);
        bytes memory noPrefix = new bytes(h.length - 2);
        for (uint256 i; i < noPrefix.length; ++i) noPrefix[i] = h[i + 2];
        args[1] = string(noPrefix);
        _assertOk(inbox.deliver(args), "1");
    }

    function test_routeIsSelfOnly() public {
        vm.expectRevert(WeCrossInbox.OnlySelf.selector);
        inbox.route("Status", "");
    }

    function testFuzz_neverReverts(string calldata kind, bytes calldata payload) public {
        string[] memory r = inbox.deliver(_args(kind, payload));
        assertEq(r.length, 2);
    }
}
