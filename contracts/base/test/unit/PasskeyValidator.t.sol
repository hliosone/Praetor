// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PasskeyValidator} from "../../src/PasskeyValidator.sol";
import {PackedUserOperation} from "../../src/interfaces/IERC4337.sol";
import {IERC7579Account, ISafe7579LaunchpadSetup} from "../../src/interfaces/IERC7579.sol";
import {Calls} from "../utils/Calls.sol";
import {Passkeys} from "../utils/Passkeys.sol";

contract PasskeyValidatorTest is Passkeys {
    PasskeyValidator internal v;
    address internal hook = makeAddr("hook");
    address internal account = makeAddr("account");
    Passkey internal owner;
    bytes32 internal h = keccak256("userOpHash");

    function setUp() public {
        v = new PasskeyValidator(hook);
        owner = _passkey("owner");
        vm.prank(account);
        v.onInstall(abi.encode(owner.credIdHash, owner.x, owner.y));
    }

    function _validate(bytes memory callData, bytes memory sig) internal returns (uint256) {
        PackedUserOperation memory op;
        op.sender = account;
        op.callData = callData;
        op.signature = sig;
        vm.prank(account);
        return v.validateUserOp(op, h);
    }

    function test_executeWithPasskeyPasses() public {
        assertEq(_validate(Calls.single(address(1), 0, ""), _passkeySig(owner, h)), 0);
    }

    /// Q16: the launchpad's first op carries setupSafe(InitData).
    function test_setupSafePasses() public {
        bytes memory cd = abi.encodeWithSelector(ISafe7579LaunchpadSetup.setupSafe.selector, uint256(0));
        assertEq(bytes4(cd), bytes4(0xd9ed0e8f));
        assertEq(_validate(cd, _passkeySig(owner, h)), 0);
    }

    /// Q14 (I1): raw installModule/uninstallModule would skip the hook for the hook itself; refused here.
    function test_refusesRawModuleCalls() public {
        bytes memory sig = _passkeySig(owner, h);
        assertEq(_validate(abi.encodeCall(IERC7579Account.installModule, (4, address(1), "")), sig), 1);
        assertEq(_validate(abi.encodeCall(IERC7579Account.uninstallModule, (4, address(1), "")), sig), 1);
        assertEq(_validate(hex"deadbeef", sig), 1);
        assertEq(_validate(hex"e9ae", sig), 1);
    }

    function test_refusesWrongChallengeKeyHighSAndNoUV() public {
        bytes memory cd = Calls.single(address(1), 0, "");
        assertEq(_validate(cd, _passkeySig(owner, keccak256("other"))), 1, "other challenge");
        Passkey memory stranger = _passkey("stranger");
        assertEq(_validate(cd, abi.encode(owner.credIdHash, _auth(stranger, abi.encodePacked(h)))), 1, "other key");
        assertEq(_validate(cd, abi.encode(stranger.credIdHash, _auth(stranger, abi.encodePacked(h)))), 1, "unknown cred");
        assertEq(_validate(cd, abi.encode(owner.credIdHash, _auth(owner, abi.encodePacked(h), 0x05, true))), 1, "high s");
        assertEq(_validate(cd, abi.encode(owner.credIdHash, _auth(owner, abi.encodePacked(h), 0x01, false))), 1, "no UV");
    }

    function test_setKeyAddsUpToFourAndRemovesButNeverTheLast() public {
        vm.startPrank(hook);
        for (uint256 i = 1; i < 4; ++i) {
            Passkey memory k = _passkey(vm.toString(i));
            v.setKey(account, k.credIdHash, k.x, k.y);
        }
        assertEq(v.keyCount(account), 4);
        Passkey memory fifth = _passkey("fifth");
        vm.expectRevert(PasskeyValidator.TooManyKeys.selector);
        v.setKey(account, fifth.credIdHash, fifth.x, fifth.y);
        for (uint256 i = 1; i < 4; ++i) v.setKey(account, _passkey(vm.toString(i)).credIdHash, 0, 0);
        assertEq(v.keyCount(account), 1);
        vm.expectRevert(PasskeyValidator.LastKey.selector);
        v.setKey(account, owner.credIdHash, 0, 0);
        vm.expectRevert(PasskeyValidator.UnknownKey.selector);
        v.setKey(account, fifth.credIdHash, 0, 0);
        vm.stopPrank();
    }

    function test_setKeyRotatesAnExistingCredential() public {
        Passkey memory next = _passkey("next");
        vm.prank(hook);
        v.setKey(account, owner.credIdHash, next.x, next.y);
        assertEq(v.keyCount(account), 1);
        (uint256 x, uint256 y) = v.ownerKey(account, owner.credIdHash);
        assertEq(x, next.x);
        assertEq(y, next.y);
    }

    function test_replaceAllKeysForRecovery() public {
        Passkey memory second = _passkey("second");
        Passkey memory fresh = _passkey("fresh");
        vm.startPrank(hook);
        v.setKey(account, second.credIdHash, second.x, second.y);
        v.replaceAllKeys(account, fresh.credIdHash, fresh.x, fresh.y);
        vm.stopPrank();
        assertEq(v.keyCount(account), 1);
        (uint256 x,) = v.ownerKey(account, owner.credIdHash);
        assertEq(x, 0);
        (x,) = v.ownerKey(account, second.credIdHash);
        assertEq(x, 0);
        assertEq(_validate(Calls.single(address(1), 0, ""), _passkeySig(fresh, h)), 0);
        assertEq(_validate(Calls.single(address(1), 0, ""), _passkeySig(owner, h)), 1);
    }

    function test_onlyHookWritesKeys() public {
        vm.expectRevert(PasskeyValidator.OnlyHook.selector);
        v.setKey(account, owner.credIdHash, 1, 2);
        vm.expectRevert(PasskeyValidator.OnlyHook.selector);
        v.replaceAllKeys(account, owner.credIdHash, 1, 2);
    }

    function test_installRejectsEmptyKeyAndDoubleInstall() public {
        vm.prank(makeAddr("a2"));
        vm.expectRevert(PasskeyValidator.InvalidKey.selector);
        v.onInstall(abi.encode(owner.credIdHash, uint256(0), uint256(0)));
        vm.prank(account);
        vm.expectRevert(PasskeyValidator.AlreadyInstalled.selector);
        v.onInstall(abi.encode(owner.credIdHash, owner.x, owner.y));
    }

    function test_uninstallClearsAllKeys() public {
        vm.prank(account);
        v.onUninstall("");
        assertEq(v.keyCount(account), 0);
        assertFalse(v.isInitialized(account));
        (uint256 x,) = v.ownerKey(account, owner.credIdHash);
        assertEq(x, 0);
    }

    function testFuzz_erc1271AlwaysInvalid(address sender, bytes32 hash, bytes calldata data) public view {
        assertEq(v.isValidSignatureWithSender(sender, hash, data), bytes4(0xffffffff));
    }
}
