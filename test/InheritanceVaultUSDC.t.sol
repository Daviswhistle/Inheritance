// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultUSDCBase} from "./InheritanceVaultUSDCBase.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {InheritanceVaultUSDCDeployer} from "../contracts/InheritanceVaultUSDCDeployer.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {YieldMath} from "../contracts/libraries/YieldMath.sol";

contract InheritanceVaultUSDCTest is InheritanceVaultUSDCBase {
    function testSixDecimalUSDCToEighteenDecimalSharesAndImmutableIdentity() public {
        assertEq(usdc.decimals(), 6);
        assertEq(re7.decimals(), 18);
        assertEq(re7.previewDeposit(100e6), 100 ether);
        _deposit(100e6);
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.rewardToken(), address(wld));
        assertEq(address(vault.strategy()), address(re7));
        assertEq(vault.owner(), owner);
        assertEq(vault.heir(), heir);
        assertEq(vault.factory(), address(factory));
        assertEq(factory.asset(), address(usdc));
        assertEq(factory.rewardToken(), address(wld));
        assertEq(factory.strategy(), address(re7));
        assertEq(factory.feeRecipient(), operator);
        assertEq(factory.performanceFeeBps(), 1000);
        vm.prank(owner);
        assertEq(factory.myVault(), address(vault));
        assertEq(re7.balanceOf(address(vault)), 100 ether);
        assertEq(re7.balanceOf(address(factory)), 0);
        assertEq(vault.accountedShares(), 100 ether);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(usdc.allowance(address(vault), address(re7)), 0);
    }

    function testImmutableHelperOnlyFactoryCanCreateChildren() public {
        InheritanceVaultUSDCDeployer helper = InheritanceVaultUSDCDeployer(vm.computeCreateAddress(address(factory), 1));
        assertEq(helper.factory(), address(factory));
        assertEq(helper.asset(), address(usdc));
        assertEq(helper.rewardToken(), address(wld));
        assertEq(helper.strategy(), address(re7));
        assertEq(helper.feeRecipient(), operator);
        assertEq(helper.performanceFeeBps(), 1000);
        assertTrue(factory.knownVaults(address(vault)));
        vm.expectRevert(InheritanceVaultUSDCDeployer.NotFactory.selector);
        helper.createVault(stranger, heir, 30 days);
    }

    function testCashFeeOnlyPositiveRealizedUSDCGain() public {
        _deposit(100e6);
        _gain(1_100_000);
        _withdraw(110e6);
        assertEq(usdc.balanceOf(owner), 1009e6);
        assertEq(usdc.balanceOf(operator), 1e6);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testPrincipalHasNoFee() public {
        _deposit(100e6);
        _withdraw(100e6);
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(usdc.balanceOf(operator), 0);
    }

    function testLossHasNoFeeAndCreatesOnlyUSDCRecoveryThreshold() public {
        _deposit(100e6);
        re7.setRate(800_000);
        _withdraw(80e6);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(vault.realizedLoss(), 20e6);
    }

    function testClosedLossOffsetsLaterUSDCGain() public {
        _deposit(100e6);
        re7.setRate(500_000);
        _withdraw(25e6);
        assertEq(vault.realizedLoss(), 25e6);
        assertEq(vault.costBasis(), 50e6);
        _gain(1_600_000);
        _withdraw(80e6);
        assertEq(usdc.balanceOf(operator), 500_000);
        assertEq(vault.realizedLoss(), 0);
    }

    function testFreshDepositDoesNotResetRemainingCapitalThreshold() public {
        _deposit(100e6);
        re7.setRate(500_000);
        _deposit(50e6);
        _gain(750_000);
        _withdraw(150e6);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(owner), 1000e6);
    }

    function testPartialExitChargesOnlyDisposedGainAndLeavesWLD() public {
        _deposit(100e6);
        _gain(1_100_000);
        _claim(10 ether);
        _withdraw(55e6);
        assertEq(usdc.balanceOf(operator), 500_000);
        assertEq(vault.costBasis(), 50e6);
        assertEq(vault.accountedShares(), 50 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
        _withdraw(55e6);
        assertEq(usdc.balanceOf(operator), 1e6);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
    }

    function testIdleUSDCGiftNotInvestedOrFeeBearing() public {
        usdc.mint(address(vault), 50e6);
        _deposit(100e6);
        assertEq(usdc.balanceOf(address(vault)), 50e6);
        _gain(1_100_000);
        _withdraw(160e6);
        assertEq(usdc.balanceOf(operator), 1e6);
        assertEq(usdc.balanceOf(owner), 1059e6);
    }

    function testIdleGiftExitDoesNotTouchBasisOrShares() public {
        _deposit(100e6);
        usdc.mint(address(vault), 10e6);
        _withdraw(10e6);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.accountedShares(), 100 ether);
        assertEq(usdc.balanceOf(operator), 0);
    }

    function testReceiptGiftsDiluteFeeBearingShareAllocation() public {
        _deposit(100e6);
        re7.mint(address(vault), 100 ether);
        _gain(1_100_000);
        _withdraw(220e6);
        assertEq(usdc.balanceOf(operator), 1e6);
        assertEq(usdc.balanceOf(owner), 1119e6);
    }

    function testPartialReceiptGiftExitLeavesProportionalBasis() public {
        _deposit(100e6);
        re7.mint(address(vault), 100 ether);
        _gain(1_100_000);
        _withdraw(110e6);
        assertEq(vault.accountedShares(), 50 ether);
        assertEq(vault.costBasis(), 50e6);
        assertEq(usdc.balanceOf(operator), 500_000);
    }

    function testFullExitRedeemsEveryShareAndPaysSeparateWLD() public {
        _deposit(100e6);
        _gain(1_333_333);
        _claim(10 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 129_999_970);
        assertEq(re7.balanceOf(address(vault)), 0);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.costBasis(), 0);
        assertEq(usdc.balanceOf(operator), 3_333_330);
        assertEq(wld.balanceOf(owner), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertFalse(vault.hasAssets());
    }

    function testFullLossOwnerExitBurnsSharesEvenWithZeroPayout() public {
        _deposit(100e6);
        re7.setRate(0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(re7.balanceOf(address(vault)), 0);
        assertEq(vault.realizedLoss(), 100e6);
        assertEq(vault.costBasis(), 0);
        assertEq(usdc.balanceOf(operator), 0);
    }

    function testFullLossInheritanceSettlesZeroUSDC() public {
        _deposit(100e6);
        re7.setRate(0);
        _eligible();
        factory.executeInheritance(address(vault));
        assertGt(vault.claimedAt(), 0);
        assertEq(vault.realizedLoss(), 100e6);
        assertEq(usdc.balanceOf(heir), 0);
        assertEq(re7.balanceOf(address(vault)), 0);
    }

    function testOneUSDCAtomMapsToReceiptUnitsAndExitsWithoutFee() public {
        _deposit(1);
        assertEq(re7.balanceOf(address(vault)), 1e12);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 1);
        assertFalse(vault.hasAssets());
        assertEq(usdc.balanceOf(operator), 0);
    }

    function testZeroAndSlippageInputsAreAtomic() public {
        vm.startPrank(owner);
        usdc.approve(address(factory), 100e6);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.depositWithMinShares(0, 1);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.depositWithMinShares(100e6, 0);
        vm.expectRevert(InheritanceVaultUSDC.SlippageExceeded.selector);
        factory.depositWithMinShares(100e6, 101 ether);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.withdrawFromMyVault(owner, 0);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.withdrawSharesFromMyVault(owner, 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(vault.costBasis(), 0);
        assertEq(re7.balanceOf(address(vault)), 0);
    }

    function testFullExitMinimumUSDCIgnoresWLDAndRollsBackEverything() public {
        _deposit(100e6);
        _claim(100 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.SlippageExceeded.selector);
        factory.withdrawAllFromMyVault(owner, 101e6);
        assertEq(re7.balanceOf(address(vault)), 100 ether);
        assertEq(wld.balanceOf(address(vault)), 100 ether);
        assertEq(vault.unprocessedRewards(), 100 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testIlliquidCashExitIsAtomic() public {
        _deposit(100e6);
        re7.setLiquidity(0);
        vm.prank(owner);
        vm.expectRevert();
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(re7.balanceOf(address(vault)), 100 ether);
        assertEq(vault.costBasis(), 100e6);
    }

    function testOwnerShareExitChargesUSDCGainInSharesAndLeavesRewards() public {
        _deposit(100e6);
        _gain(1_100_000);
        _claim(10 ether);
        re7.setLiquidity(0);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        uint256 feeShares = YieldMath.mulDiv(100 ether, 1e6, 110e6);
        assertEq(re7.balanceOf(owner), 100 ether - feeShares);
        assertEq(re7.balanceOf(operator), feeShares);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testUnknownShareQuoteWaivesFeeAndDoesNotInventLoss() public {
        _deposit(100e6);
        re7.setBrokenQuote(true);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        assertEq(re7.balanceOf(owner), 100 ether);
        assertEq(re7.balanceOf(operator), 0);
        assertEq(vault.realizedLoss(), 0);
        re7.setBrokenQuote(false);
        _deposit(100e6);
        _gain(1_100_000);
        _withdraw(110e6);
        assertEq(usdc.balanceOf(operator), 1e6);
    }

    function testUnknownValuationRetainsPreviouslyProvenUSDCLossOnly() public {
        _deposit(100e6);
        re7.setRate(800_000);
        _withdraw(80e6);
        _deposit(100e6);
        re7.setBrokenQuote(true);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 125 ether);
        assertEq(vault.realizedLoss(), 20e6);
        assertEq(vault.costBasis(), 0);
    }

    function testCashInheritancePaysBothAssetsAndTheirIndependentFees() public {
        _deposit(100e6);
        _gain(1_100_000);
        _claim(10 ether);
        usdc.mint(address(vault), 5e6);
        wld.mint(address(vault), 3 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 114e6);
        assertEq(usdc.balanceOf(operator), 1e6);
        assertEq(wld.balanceOf(heir), 12 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(vault.heir(), address(0));
        assertFalse(vault.hasAssets());
    }

    function testInheritanceEventHasCommonTopicAndUSDCUnits() public {
        _deposit(100e6);
        _eligible();
        vm.recordLogs();
        factory.executeInheritance(address(vault));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("InheritanceFinalized(address,uint256,uint256)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == topic) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(heir))));
                (uint256 amount, uint256 at) = abi.decode(logs[i].data, (uint256, uint256));
                assertEq(amount, 100e6);
                assertEq(at, vault.claimedAt());
                found = true;
            }
        }
        assertTrue(found);
    }

    function testIlliquidInheritancePaysIdleUSDCWLDAndReceiptShares() public {
        _deposit(100e6);
        _gain(1_100_000);
        re7.setLiquidity(0);
        _claim(10 ether);
        usdc.mint(address(vault), 5e6);
        wld.mint(address(vault), 3 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        uint256 feeShares = YieldMath.mulDiv(100 ether, 1e6, 110e6);
        assertEq(re7.balanceOf(heir), 100 ether - feeShares);
        assertEq(re7.balanceOf(operator), feeShares);
        assertEq(usdc.balanceOf(heir), 5e6);
        assertEq(wld.balanceOf(heir), 12 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testBrokenQuoteCannotBlockInheritanceOfAllThreeAssets() public {
        _deposit(100e6);
        _claim(10 ether);
        usdc.mint(address(vault), 5e6);
        re7.setBrokenQuote(true);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(re7.balanceOf(heir), 100 ether);
        assertEq(re7.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(heir), 5e6);
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(vault.realizedLoss(), 0);
    }

    function testGasExhaustionCannotBlockReceiptFallback() public {
        _deposit(100e6);
        _claim(10 ether);
        re7.setGasFailure(true, true);
        _eligible();
        uint256 beforeGas = gasleft();
        factory.executeInheritance(address(vault));
        emit log_named_uint("bounded USDC receipt inheritance gas", beforeGas - gasleft());
        assertEq(re7.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(vault.realizedLoss(), 0);
        assertGt(vault.claimedAt(), 0);
    }

    function testWalletReceiptRedemptionHasNoSecondServiceFee() public {
        _deposit(100e6);
        _gain(1_100_000);
        re7.setLiquidity(0);
        _eligible();
        factory.executeInheritance(address(vault));
        uint256 shares = re7.balanceOf(heir);
        uint256 feeShares = re7.balanceOf(operator);
        uint256 assets = re7.previewRedeem(shares);
        re7.setLiquidity(type(uint256).max);
        vm.startPrank(heir);
        re7.approve(address(factory), shares);
        assertEq(factory.redeemWalletShares(shares, assets), assets);
        vm.stopPrank();
        assertEq(re7.balanceOf(operator), feeShares);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(re7.balanceOf(address(factory)), 0);
        assertEq(usdc.balanceOf(heir), assets);
    }

    function testWalletRedemptionSlippageAndZeroChecksAreAtomic() public {
        _deposit(100e6);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        vm.startPrank(owner);
        re7.approve(address(factory), 100 ether);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidAmount.selector);
        factory.redeemWalletShares(0, 1);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidAmount.selector);
        factory.redeemWalletShares(100 ether, 0);
        vm.expectRevert(InheritanceVaultUSDCFactory.SlippageExceeded.selector);
        factory.redeemWalletShares(100 ether, 101e6);
        vm.stopPrank();
        assertEq(re7.balanceOf(owner), 100 ether);
        assertEq(re7.balanceOf(address(factory)), 0);
    }

    function testExactDeadlineAndReviewBoundaries() public {
        _deposit(100e6);
        vm.warp(vault.deadline() - 1);
        assertTrue(vault.ownerStillActive());
        assertEq(vault.timeRemaining(), 1);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultUSDC.NotExpiredYet.selector);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.deadline());
        assertTrue(vault.isExpired());
        assertTrue(vault.isSettled());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        assertTrue(vault.claimPending());
        assertEq(vault.timeRemaining(), 0);
        vm.warp(vault.challengeEndsAt() - 1);
        assertTrue(vault.challengeRunning());
        vm.expectRevert(InheritanceVaultUSDC.ChallengeStillRunning.selector);
        factory.executeInheritance(address(vault));
        vm.warp(vault.challengeEndsAt());
        assertTrue(vault.claimableNow());
        factory.executeInheritance(address(vault));
    }

    function testOwnerRenewalCancelsReviewEvenAfterChallengeEnds() public {
        _deposit(100e6);
        _eligible();
        vm.warp(block.timestamp + 20 days);
        vm.prank(owner);
        factory.pingMyVault();
        assertTrue(vault.ownerStillActive());
        assertFalse(vault.claimPending());
        assertEq(vault.challengeEndsAt(), 0);
        vm.expectRevert(InheritanceVaultUSDC.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
    }

    function testHeirAndPeriodUpdatePreserveLastPing() public {
        uint256 ping = vault.lastPing();
        vm.startPrank(owner);
        factory.updateMyHeir(stranger);
        factory.changeMyPeriod(1 days);
        vm.stopPrank();
        assertEq(vault.heir(), stranger);
        assertEq(vault.deadline(), ping + 1 days);
        assertEq(vault.lastPing(), ping);
    }

    function testCancellationAllowsBothCurrencyWithdrawalsAfterExpiry() public {
        _deposit(100e6);
        _claim(10 ether);
        vm.prank(owner);
        factory.cancelMyInheritance();
        vm.warp(vault.deadline());
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 100e6);
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(wld.balanceOf(owner), 9 ether);
        assertTrue(vault.inheritanceCancelled());
    }

    function testExpiryAndReviewBlockOwnerExitsAndConfiguration() public {
        _deposit(100e6);
        _claim(10 ether);
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawFromMyVault(owner, 1e6);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawRewardsFromMyVault(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawSharesFromMyVault(owner, 1 ether);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.updateMyHeir(stranger);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.changeMyPeriod(365 days);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.cancelMyInheritance();
        usdc.approve(address(factory), 1e6);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.depositWithMinShares(1e6, 1 ether);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 900e6);
    }

    function testClaimAuthorizationAndRepeatChecks() public {
        _deposit(100e6);
        vm.warp(vault.deadline());
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotHeir.selector);
        factory.fileClaimFor(address(vault));
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotHeir.selector);
        vault.fileClaim();
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultUSDC.AlreadyFiled.selector);
        factory.fileClaimFor(address(vault));
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotHeir.selector);
        factory.finalizeClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        vm.prank(heir);
        factory.finalizeClaimFor(address(vault));
        vm.expectRevert(InheritanceVaultUSDC.AlreadyClaimed.selector);
        factory.executeInheritance(address(vault));
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.pingMyVault();
    }

    function testUnfiledOrEmptyInheritanceCannotPay() public {
        vm.warp(vault.deadline() + 8 days);
        vm.expectRevert(InheritanceVaultUSDC.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.executeInheritance(address(vault));
        assertEq(vault.claimedAt(), 0);
    }

    function testStrangerCannotCallOwnerPaths() public {
        vm.startPrank(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ping();
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.updateHeir(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawAsset(1, stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawRewards(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawShares(1, stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawAllAssets(stranger, 0);
        vm.expectRevert(InheritanceVaultUSDCFactory.NoVault.selector);
        factory.withdrawRewardsFromMyVault(stranger);
        vm.stopPrank();
    }

    function testSelfAndZeroRecipientsRejected() public {
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        factory.updateMyHeir(address(vault));
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        factory.updateMyHeir(address(0));
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        factory.withdrawRewardsFromMyVault(address(vault));
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        factory.withdrawAllFromMyVault(address(0), 0);
        vm.stopPrank();
    }

    function testAllThreeTokensProtectedButUnknownTokenRescueWorks() public {
        MockERC20 unknown = new MockERC20("Gift", "GIFT");
        unknown.mint(address(vault), 7 ether);
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.ProtectedToken.selector);
        factory.rescueFromMyVault(address(usdc), 1, owner);
        vm.expectRevert(InheritanceVaultUSDC.ProtectedToken.selector);
        factory.rescueFromMyVault(address(wld), 1, owner);
        vm.expectRevert(InheritanceVaultUSDC.ProtectedToken.selector);
        factory.rescueFromMyVault(address(re7), 1, owner);
        factory.rescueFromMyVault(address(unknown), 7 ether, owner);
        vm.stopPrank();
        assertEq(unknown.balanceOf(owner), 7 ether);
    }

    function testETHRejectedButForcedETHMayBeSwept() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        vm.deal(address(vault), 1 ether);
        uint256 before = owner.balance;
        vm.prank(owner);
        factory.sweepEthFromMyVault(payable(owner));
        assertEq(owner.balance, before + 1 ether);
        assertEq(address(vault).balance, 0);
    }

    function testOnlyEmptySettledSlotsReleaseAndKnownMembershipRemains() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotExpired.selector);
        factory.releaseMyVault();
        wld.mint(address(vault), 1);
        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.VaultNotEmpty.selector);
        factory.releaseMyVault();
        vm.prank(owner);
        factory.pingMyVault();
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        vm.warp(vault.deadline());
        vm.deal(address(vault), 1);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.VaultNotEmpty.selector);
        factory.releaseMyVault();
        vm.prank(owner);
        factory.sweepEthFromMyVault(payable(owner));
        vm.prank(owner);
        assertTrue(factory.releaseMyVault());
        assertEq(factory.vaultOf(owner), address(0));
        assertTrue(factory.knownVaults(address(vault)));
    }

    function testOneVaultPerOwnerAndCurrentReceiptPositionPreventsRelease() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.AlreadyHasVault.selector);
        factory.createVault(heir, 30 days);
        _deposit(100e6);
        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.VaultNotEmpty.selector);
        factory.releaseMyVault();
    }

    function testFactoryMembershipCannotBeForgedAndForeignFactoryRejected() public {
        InheritanceVaultUSDC forged = new InheritanceVaultUSDC(
            owner, heir, address(usdc), address(wld), 30 days, address(factory), address(re7), operator, 1000
        );
        assertFalse(factory.knownVaults(address(forged)));
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.executeInheritance(address(forged));
        InheritanceVaultUSDCFactory other =
            new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(wld), operator, 1000);
        vm.prank(owner);
        address foreign = other.createVault(heir, 30 days);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.executeInheritance(foreign);
    }

    function testPositionUsesUSDCUnitsAndReportsLiquiditySeparately() public {
        _deposit(100e6);
        _gain(1_100_000);
        _claim(100 ether);
        re7.setLiquidity(20e6);
        (uint256 idle, uint256 shares, uint256 gross, uint256 net, uint256 fee, uint256 liquid, bool valued) =
            vault.position();
        assertEq(idle, 0);
        assertEq(shares, 100 ether);
        assertEq(gross, 110e6);
        assertEq(net, 109e6);
        assertEq(fee, 1e6);
        assertEq(liquid, 20e6);
        assertTrue(valued);
    }

    function testPositionUnknownQuoteDoesNotHideSharesOrIncludeRewards() public {
        _deposit(100e6);
        usdc.mint(address(vault), 2e6);
        _claim(100 ether);
        re7.setBrokenQuote(true);
        (uint256 idle, uint256 shares, uint256 gross, uint256 net, uint256 fee, uint256 liquid, bool valued) =
            vault.position();
        assertEq(idle, 2e6);
        assertEq(shares, 100 ether);
        assertEq(gross, 2e6);
        assertEq(net, 2e6);
        assertEq(fee, 0);
        assertEq(liquid, 2e6);
        assertFalse(valued);
    }

    function testStrategyCannotReenterInheritance() public {
        _deposit(100e6);
        _eligible();
        re7.setCallback(address(factory), abi.encodeCall(factory.executeInheritance, (address(vault))));
        factory.executeInheritance(address(vault));
        assertFalse(re7.callbackSucceeded());
        assertEq(usdc.balanceOf(heir), 100e6);
    }

    function testFactoryConstructionRejectsCodeMismatchAndRewardCollisions() public {
        MockERC20 wrong = new MockERC20("Other", "BAD");
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidStrategy.selector);
        new InheritanceVaultUSDCFactory(address(wrong), address(re7), address(wld), operator, 1000);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidStrategy.selector);
        new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(usdc), operator, 1000);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidStrategy.selector);
        new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(re7), operator, 1000);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidStrategy.selector);
        new InheritanceVaultUSDCFactory(address(usdc), address(re7), stranger, operator, 1000);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidFee.selector);
        new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(wld), operator, 1001);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidAddress.selector);
        new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(wld), address(0), 1000);
    }

    function testVaultConstructionAndHeartbeatRejectInvalidValues() public {
        vm.startPrank(stranger);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        factory.createVault(address(0), 30 days);
        vm.expectRevert(InheritanceVaultUSDC.HeartbeatOutOfRange.selector);
        factory.createVault(heir, 1 days - 1);
        vm.expectRevert(InheritanceVaultUSDC.HeartbeatOutOfRange.selector);
        factory.createVault(heir, 365 days + 1);
        vm.stopPrank();
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.HeartbeatOutOfRange.selector);
        factory.changeMyPeriod(0);
        vm.expectRevert(InheritanceVaultUSDC.HeartbeatOutOfRange.selector);
        factory.changeMyPeriod(365 days + 1);
        vm.stopPrank();
    }

    function testDirectVaultConstructionRejectsInvalidStrategyFeeAndFactory() public {
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        new InheritanceVaultUSDC(
            owner, heir, address(usdc), address(usdc), 30 days, address(factory), address(re7), operator, 1000
        );
        vm.expectRevert(InheritanceVaultUSDC.InvalidFee.selector);
        new InheritanceVaultUSDC(
            owner, heir, address(usdc), address(wld), 30 days, address(factory), address(re7), operator, 1001
        );
        vm.expectRevert(InheritanceVaultUSDC.InvalidAddress.selector);
        new InheritanceVaultUSDC(
            owner, heir, address(usdc), address(wld), 30 days, address(0), address(re7), operator, 1000
        );
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.invest(100e6, 100 ether);
    }

    function testRejectedApprovalAndRejectedApprovalResetRollBackDeposit() public {
        vm.startPrank(owner);
        usdc.approve(address(factory), 100e6);
        vm.mockCall(
            address(usdc), abi.encodeWithSelector(usdc.approve.selector, address(re7), 100e6), abi.encode(false)
        );
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        factory.depositWithMinShares(100e6, 100 ether);
        vm.clearMockedCalls();
        vm.mockCall(address(usdc), abi.encodeWithSelector(usdc.approve.selector, address(re7), 0), abi.encode(false));
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        factory.depositWithMinShares(100e6, 100 ether);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(re7.balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testDishonestStrategyDepositAndWithdrawalResponsesCannotMoveCustody() public {
        vm.mockCall(address(re7), abi.encodeWithSelector(re7.deposit.selector), abi.encode(uint256(100 ether)));
        vm.startPrank(owner);
        usdc.approve(address(factory), 100e6);
        vm.expectRevert(InheritanceVaultUSDC.SlippageExceeded.selector);
        factory.depositWithMinShares(100e6, 100 ether);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 1000e6);
        vm.clearMockedCalls();
        _deposit(100e6);
        vm.mockCall(address(re7), abi.encodeWithSelector(re7.withdraw.selector), abi.encode(uint256(100 ether)));
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        factory.withdrawFromMyVault(owner, 100e6);
        assertEq(re7.balanceOf(address(vault)), 100 ether);
        assertEq(vault.costBasis(), 100e6);
        assertEq(usdc.balanceOf(owner), 900e6);
    }

    function testDishonestRedemptionCannotFinalizeOrChargeFee() public {
        _deposit(100e6);
        vm.mockCall(address(re7), abi.encodeWithSelector(re7.redeem.selector), abi.encode(uint256(100e6)));
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        factory.withdrawAllFromMyVault(owner, 0);
        _eligible();
        vm.expectRevert(InheritanceVaultUSDC.InvalidStrategy.selector);
        factory.executeInheritance(address(vault));
        assertEq(vault.claimedAt(), 0);
        assertEq(vault.inheritanceRecipient(), address(0));
        assertEq(vault.costBasis(), 100e6);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(heir), 0);
        assertEq(re7.balanceOf(address(vault)), 100 ether);
        vm.clearMockedCalls();
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
    }

    function testEmptyExitAndTooManySharesRevertWithoutMovingCapital() public {
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.withdrawAllFromMyVault(owner, 0);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.withdrawRewardsFromMyVault(owner);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.sweepEthFromMyVault(payable(owner));
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.withdrawSharesFromMyVault(owner, 1);
        vm.expectRevert(InheritanceVaultUSDC.NotSettled.selector);
        factory.sweepSettledVaultFor(owner);
        vm.stopPrank();
        _deposit(100e6);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidAmount.selector);
        factory.withdrawSharesFromMyVault(owner, 101 ether);
        assertEq(vault.costBasis(), 100e6);
        assertEq(re7.balanceOf(address(vault)), 100 ether);
    }

    function testDirectFinalizeRemainsHeirOnlyAndSettledReviewCannotReopen() public {
        _deposit(100e6);
        _eligible();
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotHeir.selector);
        vault.finalizeClaim();
        vm.prank(heir);
        vault.finalizeClaim();
        vm.prank(address(factory));
        vm.expectRevert(InheritanceVaultUSDC.AlreadyClaimed.selector);
        vault.fileClaim();
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.sweepSettledVaultFor(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawRewardsFromMyVault(owner);
        vm.stopPrank();
    }

    function testRejectedETHRecipientLeavesForcedETHRecoverable() public {
        vm.deal(address(vault), 1 ether);
        vm.etch(stranger, hex"60006000fd");
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.EthTransferFailed.selector);
        factory.sweepEthFromMyVault(payable(stranger));
        assertEq(address(vault).balance, 1 ether);
        vm.prank(owner);
        factory.sweepEthFromMyVault(payable(owner));
        assertEq(address(vault).balance, 0);
    }

    function testFuzzFeeOnlyUSDCGainWithDifferentDecimals(uint96 depositRaw, uint64 rateRaw) public {
        uint256 assets = bound(uint256(depositRaw), 1e6, 1000e6);
        uint256 rate = bound(uint256(rateRaw), 100_000, 5e6);
        _deposit(assets);
        _gain(rate);
        uint256 gross = re7.convertToAssets(re7.balanceOf(address(vault)));
        usdc.mint(address(re7), gross);
        _eligible();
        factory.executeInheritance(address(vault));
        uint256 expected = gross > assets ? (gross - assets) / 10 : 0;
        assertEq(usdc.balanceOf(operator), expected);
        assertEq(usdc.balanceOf(heir), gross - expected);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.accountedShares(), 0);
    }
}
