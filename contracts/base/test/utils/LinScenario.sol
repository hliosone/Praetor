// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {PraetorTypes as P} from "@praetor/protocol/PraetorTypes.sol";
import {Execution} from "../../src/interfaces/IERC7579.sol";
import {TreasuryDesk} from "../../src/TreasuryDesk.sol";
import {PayoutRail} from "../../src/PayoutRail.sol";
import {HookBase} from "./HookBase.sol";

/// Lin's account from spec 00 with every rule passing: 5,300 USDC, 3,200 USD of tXAU, 1,500 USD of tXAG,
/// balanced caps 5,000 / 10,000 / 50,000, KYA level 2 in HK, assets and partners active, fresh heartbeat.
abstract contract LinScenario is HookBase {
    int256 internal constant XAU_PRICE = 2650e8;
    int256 internal constant XAG_PRICE = 3112000000; // 31.12
    bytes32 internal constant MERCHANT_REF = keccak256("KOWLOON-LETTINGS");

    function setUp() public virtual override {
        super.setUp();
        compliance.setCountryAllowed("HK", true);
        registry.addAgent(address(this));
        registry.registerIdentity(account, keccak256("lin-kyc"), "HK");
        registry.registerIdentity(address(desk), keccak256("desk"), "HK");
        xau.setMinter(address(desk), true);
        xag.setMinter(address(desk), true);
        desk.setMetal(address(xau), true);
        desk.setMetal(address(xag), true);
        vm.startPrank(feeder);
        oracle.setPrice(address(xau), XAU_PRICE, uint64(block.timestamp), 0);
        oracle.setPrice(address(xag), XAG_PRICE, uint64(block.timestamp), 0);
        vm.stopPrank();
        usdc.mint(account, 5_300e6);
        usdc.mint(address(desk), 1_000_000e6);
        vm.startPrank(address(desk));
        xau.mint(account, 3200e6 * 1e20 / uint256(XAU_PRICE)); // 1.2075... oz
        xag.mint(account, 1500e6 * 1e20 / uint256(XAG_PRICE)); // 48.2... oz
        vm.stopPrank();

        _caps(uint8(P.RiskProfile.BALANCED), 5_000e6, 10_000e6, 50_000e6);
        _kya(account, agent, 2, uint8(P.RiskProfile.BALANCED), "HK", uint64(block.timestamp + 365 days));
        _asset(address(xau), 0, 1, 4000, _pks(bankPk));
        _asset(address(xag), 0, 1, 2500, _pks(bankPk));
        _asset(address(desk), 1, 1, 0, _pks(bankPk));
        _asset(partner, 2, 1, 0, _pks(bankPk));
        _heartbeat(180);
        _setPolicy(_linPolicy());
    }

    // ---------------------------------------------------------------- call builders

    function _transfer(address to, uint256 amount) internal view returns (Execution memory) {
        return Execution(address(usdc), 0, abi.encodeWithSelector(0xa9059cbb, to, amount));
    }

    function _approve(address token, address spender, uint256 amount) internal pure returns (Execution memory) {
        return Execution(token, 0, abi.encodeWithSelector(0x095ea7b3, spender, amount));
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal view returns (Execution memory) {
        return Execution(address(desk), 0, abi.encodeCall(TreasuryDesk.swap, (tokenIn, tokenOut, amountIn, minOut)));
    }

    function _pay(uint256 amount, bytes32 mref) internal view returns (Execution memory) {
        return Execution(address(rail), 0, abi.encodeCall(PayoutRail.pay, (partner, amount, 1, mref, keccak256("payment"))));
    }

    function _check(Execution memory x) internal view returns (uint8 reason, uint8 tier) {
        (reason, tier,) = hook.check(account, x.target, x.value, x.callData);
    }

    function _checkBatch(Execution[] memory xs) internal view returns (uint8[] memory reasons, uint8[] memory tiers) {
        (reasons, tiers,) = hook.checkBatch(account, xs);
    }

    function _approveCall(Execution memory x) internal {
        bytes32 ch = P.callHash(account, x.target, x.value, x.callData);
        P.Tier2Approval memory a = P.Tier2Approval(account, ch, ++saltNonce, uint64(block.timestamp + 600));
        hook.registerApproval(a, _passkeyAuth(owner, _d(P.hash(a))));
    }

    /// Fair-value minOut for a metal buy (no spread) minus the slippage allowance.
    function _minOutBuy(uint256 usdcIn, int256 price, uint256 slippageBps) internal pure returns (uint256) {
        return (usdcIn * 1e20 / uint256(price)) * (10_000 - slippageBps) / 10_000;
    }

    function _minOutSell(uint256 metalIn, int256 price, uint256 slippageBps) internal pure returns (uint256) {
        return (metalIn * uint256(price) / 1e20) * (10_000 - slippageBps) / 10_000;
    }

    function _r(P.Reason r) internal pure returns (uint8) {
        return uint8(r);
    }
}
