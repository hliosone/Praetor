// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {ConsortiumLib} from "../../src/hook/ConsortiumLib.sol";
import {MandateHook} from "../../src/MandateHook.sol";
import {Modules} from "../../src/hook/HookTypes.sol";
import {HookBase} from "../utils/HookBase.sol";

/// Consortium setters (spec 03): signatures are the authority; tighten with 1, loosen with 2, bank-only types;
/// nonce == stored + 1 (I3, I18); deadline; this deployment's domain only.
contract MandateHookConsortiumTest is HookBase {
    function _statusMsg(address who, uint8 st, uint64 nonce) internal view returns (P.StatusAttestation memory) {
        return P.StatusAttestation(who, st, nonce, _deadline(), keccak256("ref"));
    }

    // ---------------------------------------------------------------- status

    function test_oneMemberFreezesAnAccount() public {
        P.StatusAttestation memory a = _statusMsg(account, 2, 1);
        vm.expectEmit(address(hook));
        emit StatusApplied(account, 2, 1, keccak256("ref"), 1);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        (uint8 eff, uint8 acc, uint8 glob,) = hook.statusOf(account);
        assertEq(eff, 2);
        assertEq(acc, 2);
        assertEq(glob, 0);
    }

    function test_looseningNeedsTwoMembers() public {
        _status(account, 2, _pks(regPk));
        P.StatusAttestation memory a = _statusMsg(account, 0, 2);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(bankPk, opPk)));
        (uint8 eff,,,) = hook.statusOf(account);
        assertEq(eff, 0);
    }

    function test_sameStatusCountsAsLoosening() public {
        P.StatusAttestation memory a = _statusMsg(account, 0, 1);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
    }

    function test_globalStatusAppliesToEveryAccount() public {
        _status(address(0), 1, _pks(opPk));
        (uint8 eff, uint8 acc, uint8 glob,) = hook.statusOf(account);
        assertEq(eff, 1);
        assertEq(acc, 0);
        assertEq(glob, 1);
    }

    /// I18: nonce must be exactly stored + 1, so nobody can jump to 2^64 - 1 and block later messages.
    function test_nonceMustBeStoredPlusOne() public {
        P.StatusAttestation memory a = _statusMsg(account, 2, type(uint64).max);
        vm.expectRevert(ConsortiumLib.BadNonce.selector);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        a = _statusMsg(account, 2, 2);
        vm.expectRevert(ConsortiumLib.BadNonce.selector);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        a = _statusMsg(account, 2, 1);
        bytes[] memory sigs = _sigs(_d(P.hash(a)), _pks(regPk));
        hook.applyStatus(a, sigs);
        vm.expectRevert(ConsortiumLib.BadNonce.selector);
        hook.applyStatus(a, sigs);
        assertEq(hook.nonces(0, bytes32(uint256(uint160(account)))), 1);
    }

    function test_deadlinePassedRefused() public {
        P.StatusAttestation memory a = _statusMsg(account, 2, 1);
        a.deadline = uint64(block.timestamp - 1);
        vm.expectRevert(ConsortiumLib.Expired.selector);
        hook.applyStatus(a, _sigs(_d(P.hash(a)), _pks(regPk)));
    }

    function test_signerSetRules() public {
        P.StatusAttestation memory a = _statusMsg(account, 0, 1);
        bytes32 d = _d(P.hash(a));
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(a, _sigs(d, _pks(bankPk, strangerPk)));
        bytes[] memory dup = new bytes[](2);
        dup[0] = _sign(bankPk, d);
        dup[1] = _sign(bankPk, d);
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(a, dup);
        bytes[] memory sorted = _sigs(d, _pks(bankPk, regPk));
        bytes[] memory unsorted = new bytes[](2);
        (unsorted[0], unsorted[1]) = (sorted[1], sorted[0]);
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(a, unsorted);
        bytes[] memory junk = new bytes[](1);
        junk[0] = hex"0102";
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(_statusMsg(account, 2, 1), junk);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applyStatus(_statusMsg(account, 2, 1), new bytes[](0));
    }

    /// Spec 00: a signature made for another environment (domain name) never verifies here.
    function test_otherDomainRefused() public {
        P.StatusAttestation memory a = _statusMsg(account, 2, 1);
        bytes32 other = P.digest(P.domainSeparator("Praetor", address(hook)), P.hash(a));
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(a, _sigs(other, _pks(regPk)));
    }

    function test_rejectsMalleableHighS() public {
        P.StatusAttestation memory a = _statusMsg(account, 2, 1);
        bytes32 d = _d(P.hash(a));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(regPk, d);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        hook.applyStatus(a, sigs);
    }

    // ---------------------------------------------------------------- heartbeat

    function test_heartbeatEpochAndTtl() public {
        _heartbeat(180);
        (,,, uint64 hb) = hook.statusOf(account);
        assertEq(hb, block.timestamp + 180);
        P.HeartbeatAttestation memory a = P.HeartbeatAttestation(2, uint64(block.timestamp + 1 days + 1), _deadline());
        vm.expectRevert(ConsortiumLib.InvalidValue.selector);
        hook.applyHeartbeat(a, _sigs(_d(P.hash(a)), _pks(opPk)));
        a = P.HeartbeatAttestation(3, uint64(block.timestamp + 60), _deadline());
        vm.expectRevert(ConsortiumLib.BadNonce.selector);
        hook.applyHeartbeat(a, _sigs(_d(P.hash(a)), _pks(opPk)));
    }

    // ---------------------------------------------------------------- bank-only types

    function test_capsNeedTheBank() public {
        P.CapsAttestation memory a = P.CapsAttestation(2, 5_000e6, 10_000e6, 50_000e6, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyCaps(a, _sigs(_d(P.hash(a)), _pks(regPk, opPk)));
        hook.applyCaps(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
        (uint256 perTx, uint256 daily, uint256 monthly) = hook.capsOf(2);
        assertEq(perTx, 5_000e6);
        assertEq(daily, 10_000e6);
        assertEq(monthly, 50_000e6);
    }

    function test_capsAbove2pow128Refused() public {
        P.CapsAttestation memory a = P.CapsAttestation(2, 2 ** 128 + 1, 1, 1, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.InvalidValue.selector);
        hook.applyCaps(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
    }

    function test_kyaNeedsTheBank() public {
        _kya(account, agent, 2, 2, "HK", uint64(block.timestamp + 365 days));
        (address key, uint8 level, uint8 profile, bytes2 j, uint64 vu) = hook.kyaOf(account);
        assertEq(key, agent);
        assertEq(level, 2);
        assertEq(profile, 2);
        assertEq(j, bytes2("HK"));
        assertEq(vu, block.timestamp + 365 days);
        P.KYAAttestation memory a;
        a.account = account;
        a.nonce = 2;
        a.deadline = _deadline();
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyKYA(a, _sigs(_d(P.hash(a)), _pks(regPk)));
    }

    // ---------------------------------------------------------------- assets

    function test_assetActivationNeedsBankSuspensionAnyMember() public {
        P.AssetAttestation memory a = P.AssetAttestation(address(xau), 0, 1, 4000, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        _asset(address(xau), 0, 1, 4000, _pks(bankPk));
        _asset(address(xau), 0, 2, 4000, _pks(regPk)); // suspend
        _asset(address(xau), 0, 2, 3000, _pks(opPk)); // lower max weight
        a = P.AssetAttestation(address(xau), 0, 2, 3500, 4, _deadline(), 0); // raise max weight
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        a = P.AssetAttestation(address(xau), 1, 2, 3000, 4, _deadline(), 0); // change kind
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(regPk)));
        a = P.AssetAttestation(address(xau), 0, 1, 3000, 4, _deadline(), 0); // reactivate
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(opPk)));
        _asset(address(xau), 0, 3, 3000, _pks(opPk)); // delist
        (uint8 kind, uint8 st, uint16 maxW,) = hook.assetOf(address(xau));
        assertEq(kind, 0);
        assertEq(st, 3);
        assertEq(maxW, 3000);
    }

    function test_assetUnDelistToSuspendedIsLoosening() public {
        _asset(address(xau), 0, 3, 3000, _pks(bankPk));
        P.AssetAttestation memory a = P.AssetAttestation(address(xau), 0, 2, 3000, 2, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(regPk)));
    }

    function test_assetRejectsInvalidEnums() public {
        P.AssetAttestation memory a = P.AssetAttestation(address(xau), 3, 1, 4000, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.InvalidValue.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
        a = P.AssetAttestation(address(xau), 0, 4, 4000, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.InvalidValue.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
        a = P.AssetAttestation(address(xau), 0, 1, 10_001, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.InvalidValue.selector);
        hook.applyAsset(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
    }

    // ---------------------------------------------------------------- sanctions, jurisdictions, attesters

    function test_sanctionsListOneDelistTwo() public {
        _sanction(partner, true, _pks(regPk));
        assertTrue(hook.isSanctioned(partner));
        P.SanctionsAttestation memory a = P.SanctionsAttestation(partner, false, 2, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applySanctions(a, _sigs(_d(P.hash(a)), _pks(bankPk)));
        hook.applySanctions(a, _sigs(_d(P.hash(a)), _pks(bankPk, regPk)));
        assertFalse(hook.isSanctioned(partner));
    }

    function test_jurisdictionBlockOneUnblockTwo() public {
        _jurisdiction("CN", true, _pks(regPk));
        assertTrue(hook.isPayoutBlocked("CN"));
        P.JurisdictionAttestation memory a = P.JurisdictionAttestation("CN", false, 2, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applyJurisdiction(a, _sigs(_d(P.hash(a)), _pks(opPk)));
        hook.applyJurisdiction(a, _sigs(_d(P.hash(a)), _pks(opPk, regPk)));
        assertFalse(hook.isPayoutBlocked("CN"));
    }

    function test_attesterActivateBankDeactivateAny() public {
        P.AttesterAttestation memory a = P.AttesterAttestation(attester, keccak256("m"), true, 1, _deadline(), 0);
        vm.expectRevert(ConsortiumLib.BankRequired.selector);
        hook.applyAttester(a, _sigs(_d(P.hash(a)), _pks(regPk, opPk)));
        _attester(attester, true, _pks(bankPk));
        (bytes32 m, bool active) = hook.attesterOf(attester);
        assertTrue(active);
        assertEq(m, keccak256("attester-rtmr3"));
        _attester(attester, false, _pks(opPk));
        (, active) = hook.attesterOf(attester);
        assertFalse(active);
    }

    // ---------------------------------------------------------------- deployment wiring

    function test_setModulesOnceByDeployer() public {
        Modules memory m;
        vm.expectRevert(MandateHook.ModulesAlreadySet.selector);
        hook.setModules(m);
        MandateHook fresh = new MandateHook(bank, regulator, operator, "Praetor-test", true);
        vm.prank(makeAddr("other"));
        vm.expectRevert(MandateHook.OnlyDeployer.selector);
        fresh.setModules(m);
    }

    function test_membersAndDomain() public view {
        (address b, address r, address o) = hook.members();
        assertEq(b, bank);
        assertEq(r, regulator);
        assertEq(o, operator);
        assertEq(hook.domainSeparator(), P.domainSeparator("Praetor-test", address(hook)));
    }

    function test_constructorRejectsDuplicateOrZeroMembers() public {
        vm.expectRevert(MandateHook.InvalidMembers.selector);
        new MandateHook(bank, bank, operator, "Praetor-test", true);
        vm.expectRevert(MandateHook.InvalidMembers.selector);
        new MandateHook(bank, regulator, address(0), "Praetor-test", true);
    }
}
