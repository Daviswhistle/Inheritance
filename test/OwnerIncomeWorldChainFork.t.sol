// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "../contracts/interfaces/IERC4626Minimal.sol";

interface IIncomeForkStrategy {
    function MORPHO() external view returns (address);
    function withdrawQueueLength() external view returns (uint256);
    function withdrawQueue(uint256 index) external view returns (bytes32);
}

interface IIncomeForkMorpho {
    function idToMarketParams(bytes32 id) external view returns (address, address, address, address, uint256);
}

/// Genuine Re7 lending state on a local fork. No signatures or broadcasts.
contract OwnerIncomeWorldChainForkTest is Test {
    address constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address constant RE7_WLD = 0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f;
    address constant RE7_USDC = 0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B;
    address constant OWNER = address(0xA11CE);
    address constant HEIR = address(0xB0B);
    address constant FEE = address(0xFEE);

    InheritanceVaultUSDCFactory internal usdcFactory;
    InheritanceVaultUSDC internal usdcVault;
    InheritanceVaultMorphoFactory internal wldFactory;
    InheritanceVaultMorpho internal wldVault;

    function setUp() public {
        string memory rpc = vm.envOr("INCOME_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, 35_837_437);
        assertEq(block.chainid, 480);
        usdcFactory = new InheritanceVaultUSDCFactory(USDC, RE7_USDC, WLD, FEE, 1000);
        vm.prank(OWNER);
        usdcVault = InheritanceVaultUSDC(payable(usdcFactory.createVault(HEIR, 30 days)));
        deal(USDC, OWNER, 100e6);
        vm.startPrank(OWNER);
        IERC20(USDC).approve(address(usdcFactory), 100e6);
        usdcFactory.depositWithMinShares(100e6, IERC4626Minimal(RE7_USDC).previewDeposit(100e6) * 9950 / 10_000);
        vm.stopPrank();
        wldFactory = new InheritanceVaultMorphoFactory(WLD, RE7_WLD, FEE, 1000);
        vm.prank(OWNER);
        wldVault = InheritanceVaultMorpho(payable(wldFactory.createVault(HEIR, 30 days)));
        deal(WLD, OWNER, 100 ether);
        vm.startPrank(OWNER);
        IERC20(WLD).approve(address(wldFactory), 100 ether);
        wldFactory.depositWithMinShares(100 ether, IERC4626Minimal(RE7_WLD).previewDeposit(100 ether) * 9950 / 10_000);
        vm.stopPrank();
    }

    // Forge setup/deposit calls can warm the markets. Clear every dependency so
    // the quote exercises the same cold storage reads as a separate eth_call.
    function _coldStrategy(address strategy) internal {
        IIncomeForkStrategy re7 = IIncomeForkStrategy(strategy);
        address morpho = re7.MORPHO();
        uint256 length = re7.withdrawQueueLength();
        for (uint256 i; i < length; ++i) {
            (address loan, address collateral, address oracle, address irm,) =
                IIncomeForkMorpho(morpho).idToMarketParams(re7.withdrawQueue(i));
            vm.cool(loan);
            vm.cool(collateral);
            vm.cool(oracle);
            vm.cool(irm);
        }
        vm.cool(morpho);
        vm.cool(strategy);
    }

    function testColdRe7USDCQuoteAndIncomePreserveCapital() public {
        InheritanceVaultUSDCFactory factory = usdcFactory;
        InheritanceVaultUSDC vault = usdcVault;
        uint256 ping = vault.lastPing();
        vm.warp(block.timestamp + 5 days);
        uint256 tracked = vault.accountedShares();
        _coldStrategy(RE7_USDC);
        (bool oldQuote,) = RE7_USDC.staticcall{gas: 150_000}(abi.encodeCall(IERC4626Minimal.convertToAssets, (tracked)));
        assertFalse(oldQuote, "regression fixture must exceed the former cold quote cap");
        _coldStrategy(RE7_USDC);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertTrue(valued);
        assertGt(gross, 0);
        assertGt(available, 0);
        assertEq(fee, gross * 1000 / 10_000);
        assertEq(net, gross - fee);
        _coldStrategy(RE7_USDC);
        vm.prank(OWNER);
        uint256 received = factory.withdrawIncomeFromMyVault(OWNER, available);
        assertGe(received, available);
        assertEq(IERC20(USDC).balanceOf(OWNER), received);
        uint256 charged = IERC20(USDC).balanceOf(FEE);
        assertEq(charged, (received + charged) * 1000 / 10_000);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.lastPing(), ping);
        assertEq(vault.heir(), HEIR);
        assertGe(IERC4626Minimal(RE7_USDC).convertToAssets(vault.accountedShares()), 100e6);
        _coldStrategy(RE7_USDC);
        (,,, available, valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 0);
        vm.prank(OWNER);
        factory.withdrawAllFromMyVault(OWNER, 100e6);
        assertEq(IERC20(USDC).balanceOf(FEE), charged, "harvested income must not be charged again");
    }

    function testColdRe7WLDQuoteAndIncomePreserveCapital() public {
        InheritanceVaultMorphoFactory factory = wldFactory;
        InheritanceVaultMorpho vault = wldVault;
        uint256 ping = vault.lastPing();
        vm.warp(block.timestamp + 5 days);
        _coldStrategy(RE7_WLD);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertTrue(valued);
        assertGt(gross, 0);
        assertGt(available, 0);
        assertEq(fee, gross * 1000 / 10_000);
        assertEq(net, gross - fee);
        _coldStrategy(RE7_WLD);
        vm.prank(OWNER);
        uint256 received = factory.withdrawIncomeFromMyVault(OWNER, available);
        assertGe(received, available);
        assertEq(IERC20(WLD).balanceOf(OWNER), received);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.lastPing(), ping);
        assertEq(vault.heir(), HEIR);
        assertGe(IERC4626Minimal(RE7_WLD).convertToAssets(vault.accountedShares()), 100 ether);
        _coldStrategy(RE7_WLD);
        (,,, available, valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 0);
    }
}
