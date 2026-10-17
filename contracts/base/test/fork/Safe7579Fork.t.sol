// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {IRefusalLogEvents} from "@praetor/protocol/PraetorEvents.sol";
import {Execution, MODE_SINGLE, MODE_BATCH} from "../../src/interfaces/IERC7579.sol";
import {PackedUserOperation} from "../../src/interfaces/IERC4337.sol";
import {Calls} from "../utils/Calls.sol";
import {ForkBase} from "./ForkBase.sol";
import "../utils/Safe7579.sol";

/// The real Safe7579 path on a Base Sepolia fork: creation (spec 00), I1, I7, I16, I17, agent payment and refusal,
/// RefusalLog, standing order through executeFromExecutor.
contract Safe7579ForkTest is ForkBase, IRefusalLogEvents {
    bytes internal constant AA24 = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");

    function setUp() public override {
        super.setUp();
        OpResult memory r = _createAccount(1);
        require(r.found && r.success, "account creation failed");
    }

    function _hookDeInit() internal pure returns (bytes memory) {
        return abi.encode(uint8(0), bytes4(0), bytes(""));
    }

    /// Safe7579 reads (hookType, selector) from the context for hooks; GLOBAL = 0.
    function _hookCtx() internal pure returns (bytes memory) {
        return abi.encode(uint8(0), bytes4(0));
    }

    function _uninstallHook() internal view returns (bytes memory) {
        return abi.encodeCall(IAccount7579.uninstallModule, (4, address(d.hook), _hookDeInit()));
    }

    // ---------------------------------------------------------------- creation path (spec 00, Q15, Q16, Q21)

    function test_creationPathWithNoOwnerPasskeyAndPaymaster() public view {
        address[] memory owners = ISafe(account).getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], address(d.noOwner));
        assertEq(ISafe(account).getThreshold(), 1);
        assertTrue(IAccount7579(account).isModuleInstalled(4, address(d.hook), _hookCtx()));
        assertTrue(IAccount7579(account).isModuleInstalled(2, address(d.standingOrders), ""));
        assertTrue(IAccount7579(account).isModuleInstalled(1, address(d.passkeyValidator), ""));
        assertTrue(IAccount7579(account).isModuleInstalled(1, address(d.agentKeyValidator), ""));
        assertTrue(d.hook.isInitialized(account));
        assertEq(account.balance, 0, "the paymaster paid: the account holds no ETH");
    }

    /// A fresh account refuses everything until its mandate is set (NO_POLICY), even for the owner.
    function test_freshAccountRefusesEverything() public {
        _mintUsdc(account, 10e6);
        OpResult memory r = _handle(_passkeyOp(Calls.single(address(USDC), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1e6))));
        assertTrue(r.found);
        assertFalse(r.success);
        (uint8 reason,,) = d.hook.check(account, address(USDC), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1e6));
        assertEq(reason, uint8(P.Reason.NO_POLICY));
    }

    // ---------------------------------------------------------------- I1

    function test_I1_execTransactionAlwaysReverts() public {
        vm.expectRevert();
        ISafe(account).execTransaction(landlord, 0, "", 0, 0, 0, 0, address(0), payable(address(0)), abi.encodePacked(uint256(uint160(address(d.noOwner))), uint256(0), uint8(1)));
        vm.expectRevert();
        ISafe(account).execTransaction(landlord, 0, "", 0, 0, 0, 0, address(0), payable(address(0)), new bytes(65));
    }

    /// Q14: the passkey alone cannot send raw uninstallModule (Safe7579 would skip the hook for itself).
    function test_I1_rawUninstallRefusedByThePasskeyValidator() public {
        PackedUserOperation memory op = _passkeyOp(_uninstallHook());
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(AA24);
        EP.handleOps(ops, payable(bundler));
        assertTrue(IAccount7579(account).isModuleInstalled(4, address(d.hook), _hookCtx()));
    }

    function test_I1_uninstallThroughExecuteWithoutApprovalRefused() public {
        OpResult memory r = _handle(_passkeyOp(Calls.single(account, 0, _uninstallHook())));
        assertTrue(r.found);
        assertFalse(r.success);
        assertTrue(IAccount7579(account).isModuleInstalled(4, address(d.hook), _hookCtx()));
    }

    function test_I1_approvedHookRemovalSucceeds() public {
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), _uninstallHook(), true);
        OpResult memory r = _handle(_passkeyOp(Calls.single(account, 0, _uninstallHook())));
        assertTrue(r.success);
        assertFalse(IAccount7579(account).isModuleInstalled(4, address(d.hook), _hookCtx()));
        assertFalse(d.hook.isInitialized(account));
    }

    /// I7 + Q14: the agent key cannot carry out a module change, even while one is approved.
    function test_I7_agentCannotChangeModulesEvenWithAnApproval() public {
        _lin();
        _ownerAction(uint8(P.OwnerActionKind.MODULE_CHANGE), _uninstallHook(), true);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _agentOp(Calls.single(account, 0, _uninstallHook()), agentPk);
        vm.prank(bundler, bundler);
        vm.expectRevert(AA24);
        EP.handleOps(ops, payable(bundler));
        ops[0] = _agentOp(_uninstallHook(), agentPk);
        vm.prank(bundler, bundler);
        vm.expectRevert(AA24);
        EP.handleOps(ops, payable(bundler));
    }

    // ---------------------------------------------------------------- agent payments, refusals, RefusalLog (I11)

    function test_agentPaysAutonomouslyAndARefusalIsLoggedWithTheHooksReason() public {
        _lin();
        bytes memory pay = abi.encodeWithSelector(0xa9059cbb, landlord, 150e6);
        OpResult memory ok = _handle(_agentOp(Calls.single(address(USDC), 0, pay), agentPk));
        assertTrue(ok.success);
        assertEq(USDC.balanceOf(landlord), 150e6);

        address stranger = makeAddr("fork:stranger");
        bytes memory bad = abi.encodeWithSelector(0xa9059cbb, stranger, 150e6);
        PackedUserOperation memory op = _agentOp(Calls.single(address(USDC), 0, bad), agentPk);
        bytes32 opHash = EP.getUserOpHash(op);
        OpResult memory refused = _handle(op);
        assertTrue(refused.found);
        assertFalse(refused.success, "refused op lands with success = false");
        assertEq(USDC.balanceOf(stranger), 0);
        vm.expectEmit(address(d.refusalLog));
        emit Refused(opHash, account, P.callHash(account, address(USDC), 0, bad), uint8(P.Reason.UNKNOWN_PAYEE), 2, address(USDC), bundler);
        vm.prank(bundler);
        d.refusalLog.log(opHash, account, address(USDC), 0, bad);
    }

    function test_revokedOrForeignAgentKeyRefusedAtValidation() public {
        _lin();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _agentOp(Calls.single(address(USDC), 0, abi.encodeWithSelector(0xa9059cbb, landlord, 1e6)), uint256(keccak256("fork:intruder")));
        vm.prank(bundler, bundler);
        vm.expectRevert(AA24);
        EP.handleOps(ops, payable(bundler));
    }

    // ---------------------------------------------------------------- I16: no signature path outside the hook

    function test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail() public {
        _lin();
        address thief = makeAddr("fork:thief");
        bytes32 permitHash = keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            account, thief, 1_000e6, USDC.nonces(account), block.timestamp + 1 hours))));
        bytes[] memory sigs = new bytes[](4);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, permitHash);
        sigs[0] = abi.encodePacked(address(d.agentKeyValidator), r, s, v);
        sigs[1] = abi.encodePacked(address(d.passkeyValidator), abi.encode(owner.credIdHash, _auth(owner, abi.encodePacked(permitHash))));
        sigs[2] = "";
        sigs[3] = abi.encodePacked(r, s, v);
        for (uint256 i; i < sigs.length; ++i) {
            vm.expectRevert();
            USDC.permit(account, thief, 1_000e6, block.timestamp + 1 hours, sigs[i]);
            vm.expectRevert();
            USDC.transferWithAuthorization(account, thief, 1_000e6, 0, block.timestamp + 1 hours, keccak256(abi.encode(i)), sigs[i]);
        }
        vm.expectRevert();
        USDC.permit(account, thief, 1_000e6, block.timestamp + 1 hours, v, r, s);
        assertEq(USDC.allowance(account, thief), 0);
        assertEq(USDC.balanceOf(thief), 0);
        assertEq(IAccount7579(account).isValidSignature(permitHash, sigs[0]) == bytes4(0x1626ba7e), false);
    }

    // ---------------------------------------------------------------- I17: adapter entry points

    function test_I17_outsidersCannotReachAnyNonViewEntryPoint() public {
        address stranger = makeAddr("fork:outsider");
        vm.startPrank(stranger);
        vm.expectRevert();
        IAccount7579(account).execute(MODE_SINGLE, abi.encodePacked(address(USDC), uint256(0), bytes("")));
        vm.expectRevert();
        IAccount7579(account).installModule(2, stranger, "");
        vm.expectRevert();
        IAccount7579(account).uninstallModule(4, address(d.hook), _hookDeInit());
        vm.expectRevert();
        IAccount7579(account).setRegistry(address(0), new address[](0), 0);
        (bool ok,) = account.call(abi.encodeWithSelector(0x12345678));
        assertFalse(ok, "hooked fallback refuses an unknown selector");
        vm.stopPrank();
    }

    function test_I17_ourValidatorsRefuseEveryOtherSelector() public {
        bytes[3] memory cds = [
            abi.encodeCall(IAccount7579.setRegistry, (address(0), new address[](0), 0)),
            abi.encodeCall(IAccount7579.installModule, (2, makeAddr("x"), bytes(""))),
            abi.encodeWithSelector(0x12345678)
        ];
        for (uint256 i; i < cds.length; ++i) {
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            ops[0] = _passkeyOp(cds[i]);
            vm.prank(bundler, bundler);
            vm.expectRevert(AA24);
            EP.handleOps(ops, payable(bundler));
        }
    }

    // ---------------------------------------------------------------- standing order through the real executor path

    function test_standingOrderPaysThroughExecuteFromExecutor() public {
        _lin();
        P.StandingOrder memory o = P.StandingOrder(account, 1, landlord, 1_200e6, 30 days, uint64(block.timestamp), 0, 0);
        _ownerAction(uint8(P.OwnerActionKind.ADD_STANDING_ORDER), abi.encode(o), true);
        vm.prank(makeAddr("fork:anyone"));
        d.standingOrders.execute(account, 1);
        assertEq(USDC.balanceOf(landlord), 1_200e6, "over the auto cap: the order was pre-approved by owner and bank");
    }
}
