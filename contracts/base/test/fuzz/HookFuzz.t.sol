// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Execution, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";
import {ConsortiumLib} from "../../src/hook/ConsortiumLib.sol";
import {OwnerLib} from "../../src/hook/OwnerLib.sol";
import {LinScenario} from "../utils/LinScenario.sol";
import {Calls} from "../utils/Calls.sol";

/// Property fuzzing of the hook (spec 03 Tests): signer sets (I3), nonces (I18), approval replay (I5),
/// SOTER counters (I6), default deny (I2), non-canonical batches, band projection vs outcome (I15).
contract HookFuzzTest is LinScenario {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// I3: a status message passes exactly when every signer is a member and there are enough of them
    /// (1 to tighten, 2 for same or looser).
    function testFuzz_I3_signerSets(uint8 mask, uint8 newStatus, uint8 start) public {
        newStatus = uint8(bound(newStatus, 0, 2));
        start = uint8(bound(start, 0, 2));
        if (start != 0) _status(account, start, _pks(bankPk, regPk));
        uint256[4] memory all = [bankPk, regPk, opPk, strangerPk];
        uint256 n;
        for (uint256 i; i < 4; ++i) if (mask & (1 << i) != 0) ++n;
        uint256[] memory pks = new uint256[](n);
        n = 0;
        for (uint256 i; i < 4; ++i) if (mask & (1 << i) != 0) pks[n++] = all[i];
        P.StatusAttestation memory a = P.StatusAttestation(account, newStatus, start == 0 ? 1 : 2, _deadline(), 0);
        bytes[] memory sigs = _sigs(_d(P.hash(a)), pks);
        bool stranger = mask & 8 != 0;
        uint256 members = n - (stranger ? 1 : 0);
        uint256 need = newStatus > start ? 1 : 2;
        if (stranger) vm.expectRevert(ConsortiumLib.BadSignatures.selector);
        else if (members < need) vm.expectRevert(ConsortiumLib.NotEnoughSigners.selector);
        hook.applyStatus(a, sigs);
    }

    /// I18: only stored + 1 is accepted, whatever the value (2^64 - 1 included).
    function testFuzz_I18_nonce(uint64 nonce) public {
        P.SanctionsAttestation memory a = P.SanctionsAttestation(partner, true, nonce, _deadline(), 0);
        bytes[] memory sigs = _sigs(_d(P.hash(a)), _pks(regPk));
        if (nonce != 1) vm.expectRevert(ConsortiumLib.BadNonce.selector);
        hook.applySanctions(a, sigs);
    }

    /// I5: an approval is bound to one callHash, single use; the slot can be registered again once consumed.
    function testFuzz_I5_approvalReplay(uint256 amount, uint64 salt) public {
        amount = bound(amount, 201e6, 500e6);
        Execution memory x = _transfer(landlord, amount);
        bytes32 ch = P.callHash(account, x.target, 0, x.callData);
        P.Tier2Approval memory a = P.Tier2Approval(account, ch, salt, uint64(block.timestamp + 600));
        P.OwnerAuth memory auth = _passkeyAuth(owner, _d(P.hash(a)));
        hook.registerApproval(a, auth);
        vm.expectRevert(OwnerLib.DigestUsed.selector);
        hook.registerApproval(a, auth);
        vm.prank(account);
        hook.preCheck(ENTRYPOINT, 0, abi.encodePacked(Calls.single(x.target, 0, x.callData), ENTRYPOINT));
        (uint8 r,) = _check(x);
        assertTrue(r != 0, "consumed approval no longer lifts");
        P.Tier2Approval memory b = P.Tier2Approval(account, ch, salt ^ 1, uint64(block.timestamp + 600));
        hook.registerApproval(b, _passkeyAuth(owner, _d(P.hash(b))));
        (r,) = _check(x);
        assertEq(r, 0);
    }

    /// I6: SOTER approvals pass only with a counter strictly above every counter seen for the binding.
    function testFuzz_I6_soterCounters(uint64[5] memory counters) public {
        _attester(attester, true, _pks(bankPk));
        bytes32 binding = keccak256("binding");
        bytes memory placeholder = abi.encode(bytes32(0), P.SoterApproval(account, 0, binding, 1, 0), bytes(""));
        (P.OwnerAction memory la, bytes32 ld) = _ownerActionMsg(uint8(P.OwnerActionKind.LINK_WECHAT), placeholder);
        (P.SoterApproval memory proof, bytes memory psig) = _soterApproval(account, ld, binding, 1);
        hook.applyOwnerAction(la, abi.encode(bytes32(0), proof, psig), _passkeyAuth(owner, ld), _bankSig(ld));
        uint64 maxSeen = 1;
        for (uint256 i; i < counters.length; ++i) {
            P.Tier2Approval memory a = P.Tier2Approval(account, keccak256(abi.encode(i)), uint64(i), uint64(block.timestamp + 600));
            bytes32 d = _d(P.hash(a));
            P.OwnerAuth memory auth = _soterAuth(d, binding, counters[i]);
            if (counters[i] <= maxSeen) {
                vm.expectRevert(OwnerLib.BadSoter.selector);
                hook.registerApproval(a, auth);
            } else {
                hook.registerApproval(a, auth);
                maxSeen = counters[i];
            }
        }
        assertEq(hook.soterCounterOf(binding), maxSeen);
    }

    /// I2: anything not modelled is refused.
    function testFuzz_I2_defaultDeny(address target, bytes4 sel, bytes calldata rest) public view {
        vm.assume(target != address(usdc) && target != address(desk) && target != address(rail));
        vm.assume(target != address(xau) && target != address(xag));
        (uint8 r,) = _check(Execution(target, 0, abi.encodePacked(sel, rest)));
        assertEq(r, target == account ? _r(P.Reason.HIDDEN_CALL) : _r(P.Reason.TARGET_NOT_ALLOWED));
    }

    function testFuzz_I2_unknownSelectorsOnKnownContracts(bytes4 sel, bytes calldata rest) public view {
        vm.assume(sel != 0xa9059cbb && sel != 0x095ea7b3);
        vm.assume(sel != desk.swap.selector && sel != rail.pay.selector);
        address[5] memory known = [address(usdc), address(desk), address(rail), address(xau), address(xag)];
        for (uint256 i; i < 5; ++i) {
            (uint8 r,) = _check(Execution(known[i], 0, abi.encodePacked(sel, rest)));
            assertEq(r, _r(P.Reason.SELECTOR_NOT_ALLOWED));
        }
    }

    /// A batch whose bytes are not the canonical encoding of its calls is a hidden call.
    function testFuzz_nonCanonicalBatches(bytes calldata junk) public {
        vm.assume(junk.length > 0);
        bytes memory exec = abi.encodePacked(abi.encode(Calls.one(_transfer(landlord, 1e6))), junk);
        vm.prank(account);
        try hook.preCheck(ENTRYPOINT, 0, abi.encodePacked(Calls.withMode(MODE_BATCH, exec), ENTRYPOINT)) {
            fail();
        } catch {}
    }

    /// I15: when check() allows a swap autonomously, the real outcome passes postCheck's band rule.
    function testFuzz_I15_projectionMatchesOutcome(uint256 usdcIn, int256 priceMove) public {
        usdcIn = bound(usdcIn, 1e6, 1_000e6);
        priceMove = bound(priceMove, -2000, 2000);
        vm.prank(feeder);
        oracle.setPrice(address(xau), XAU_PRICE * (10_000 + priceMove) / 10_000, uint64(block.timestamp), 0);
        int256 p8 = XAU_PRICE * (10_000 + priceMove) / 10_000;
        Execution[] memory xs = Calls.two(_approve(address(usdc), address(desk), usdcIn),
            _swap(address(usdc), address(xau), usdcIn, _minOutBuy(usdcIn, p8, 100)));
        (uint8[] memory r,) = _checkBatch(xs);
        if (r[1] != 0) return;
        vm.prank(account);
        bytes memory hd = hook.preCheck(ENTRYPOINT, 0, abi.encodePacked(Calls.batch(xs), ENTRYPOINT));
        vm.startPrank(account);
        usdc.approve(address(desk), usdcIn);
        desk.swap(address(usdc), address(xau), usdcIn, 0);
        vm.stopPrank();
        vm.prank(account);
        hook.postCheck(hd);
    }
}
