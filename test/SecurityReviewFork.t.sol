// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "../contracts/interfaces/IERC4626Minimal.sol";
import {IIncomeForkStrategy, IIncomeForkMorpho} from "./OwnerIncomeWorldChainFork.t.sol";

/// @notice Genuine strategy state; local accounts only, never broadcasts.
contract SecurityReviewColdShareFeeForkTest is Test {
    address internal constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address internal constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address internal constant RE7 = 0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B;
    address internal constant OWNER = address(0xA11CE);
    address internal constant HEIR = address(0xB0B);
    address internal constant FEE = address(0xFEE);
    InheritanceVaultUSDCFactory internal factory;
    InheritanceVaultUSDC internal vault;

    function setUp() public {
        string memory rpc = vm.envOr("SECURITY_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, vm.envOr("SECURITY_FORK_BLOCK", uint256(35_837_437)));
        assertEq(block.chainid, 480);
        factory = new InheritanceVaultUSDCFactory(USDC, RE7, WLD, FEE, 1000);
        vm.prank(OWNER);
        vault = InheritanceVaultUSDC(payable(factory.createVault(HEIR, 30 days)));
        deal(USDC, OWNER, 100e6);
        vm.startPrank(OWNER);
        IERC20(USDC).approve(address(factory), 100e6);
        factory.depositWithMinShares(100e6, IERC4626Minimal(RE7).previewDeposit(100e6) * 9950 / 10_000);
        vm.stopPrank();
    }

    function _coldStrategy() internal {
        address morpho = IIncomeForkStrategy(RE7).MORPHO();
        uint256 length = IIncomeForkStrategy(RE7).withdrawQueueLength();
        for (uint256 i; i < length; ++i) {
            (address loan, address collateral, address oracle, address irm,) =
                IIncomeForkMorpho(morpho).idToMarketParams(IIncomeForkStrategy(RE7).withdrawQueue(i));
            vm.cool(loan);
            vm.cool(collateral);
            vm.cool(oracle);
            vm.cool(irm);
        }
        vm.cool(morpho);
        vm.cool(RE7);
    }

    function testColdShareExitChargesFeeOnRealPositiveGain() public {
        vm.warp(block.timestamp + 5 days);
        uint256 shares = IERC20(RE7).balanceOf(address(vault));
        uint256 gross = IERC4626Minimal(RE7).convertToAssets(shares);
        uint256 fee = (gross - vault.costBasis()) * 1000 / 10_000;
        assertGt(fee, 0, "fixture must have positive fee-bearing yield");
        uint256 expectedFeeShares = shares * fee / gross;
        assertGt(expectedFeeShares, 0);
        emit log_named_uint("expected USDC gain fee", fee);
        emit log_named_uint("expected fee shares", expectedFeeShares);

        // A normal transaction starts with cold external storage. No broken
        // quote, malicious strategy, constrained caller gas or forged price.
        _coldStrategy();
        vm.prank(OWNER);
        factory.withdrawSharesFromMyVault(OWNER, shares);
        assertEq(IERC20(RE7).balanceOf(OWNER), shares - expectedFeeShares);
        assertEq(IERC20(RE7).balanceOf(FEE), expectedFeeShares);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.accountedShares(), 0);
    }
}
