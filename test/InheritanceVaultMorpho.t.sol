// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";
import {YieldMath} from "../contracts/libraries/YieldMath.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";
import {InheritanceVaultMorphoDeployer} from "../contracts/InheritanceVaultMorphoDeployer.sol";

contract InheritanceVaultMorphoTest is Test {
    MockERC20 internal wld;
    MockERC4626 internal morpho;
    InheritanceVaultMorphoFactory internal factory;
    InheritanceVaultMorpho internal vault;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);
    address internal stranger = address(0xBAD);

    function setUp() public virtual {
        vm.warp(1_000_000);
        wld = new MockERC20("Worldcoin", "WLD");
        morpho = new MockERC4626(address(wld));
        factory = new InheritanceVaultMorphoFactory(address(wld), address(morpho), operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultMorpho(payable(factory.createVault(heir, 30 days)));
        MockMerklDistributor rewards = new MockMerklDistributor();
        vm.etch(vault.MERKL_DISTRIBUTOR(), address(rewards).code);
        wld.mint(owner, 1000 ether);
    }

    function _deposit(uint256 amount) internal {
        vm.startPrank(owner);
        wld.approve(address(factory), amount);
        factory.depositWithMinShares(amount, morpho.previewDeposit(amount));
        vm.stopPrank();
    }

    function _gain(uint256 rate) internal {
        morpho.setRate(rate);
        wld.mint(address(morpho), 1000 ether);
    }

    function _eligible() internal {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
    }

    function _withdraw(uint256 assets) internal {
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, assets);
    }

    function testImmutableHelperOnlyCreatesChildrenThroughItsFactory() public {
        address helperAddress = vm.computeCreateAddress(address(factory), 1);
        InheritanceVaultMorphoDeployer helper = InheritanceVaultMorphoDeployer(helperAddress);
        assertEq(helper.factory(), address(factory));
        assertEq(helper.WLD(), address(wld));
        assertEq(helper.strategy(), address(morpho));
        assertEq(helper.feeRecipient(), operator);
        assertEq(helper.performanceFeeBps(), 1000);
        assertEq(vault.factory(), address(factory));
        assertTrue(factory.knownVaults(address(vault)));
        vm.expectRevert(InheritanceVaultMorphoDeployer.NotFactory.selector);
        helper.createVault(stranger, heir, 30 days);
        assertEq(factory.vaultOf(stranger), address(0));
    }

    function testDepositKeepsPersonalReceiptCustodyAndClearsApproval() public {
        _deposit(100 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
        assertEq(morpho.balanceOf(address(factory)), 0);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(wld.allowance(address(vault), address(morpho)), 0);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testFeesOnlyOnPositiveRealizedNetGain() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        uint256 before = wld.balanceOf(owner);
        _withdraw(110 ether);
        assertEq(wld.balanceOf(owner) - before, 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.accountedShares(), 0);
    }

    function testNoFeeOnPrincipal() public {
        _deposit(100 ether);
        _withdraw(100 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(wld.balanceOf(owner), 1000 ether);
    }

    function testNoFeeOnLoss() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _withdraw(80 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(wld.balanceOf(owner), 980 ether);
    }

    function testLossRecoveryAfterFreshDepositIsNotCharged() public {
        _deposit(100 ether);
        morpho.setRate(0.5 ether);
        _deposit(50 ether);
        _gain(0.75 ether);
        _withdraw(150 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(wld.balanceOf(owner), 1000 ether);
    }

    function testLossThresholdSurvivesPartialWithdrawals() public {
        _deposit(100 ether);
        morpho.setRate(0.5 ether);
        _withdraw(25 ether);
        assertEq(vault.costBasis(), 50 ether);
        _gain(1 ether);
        _withdraw(50 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testPartialWithdrawalsChargeOnlyDisposedGain() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        _withdraw(55 ether);
        assertEq(wld.balanceOf(operator), 0.5 ether);
        assertEq(vault.costBasis(), 50 ether);
        assertEq(vault.accountedShares(), 50 ether);
        _withdraw(55 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testUnsolicitedWldDoesNotBecomeFeeBearingInterest() public {
        _deposit(100 ether);
        wld.mint(address(vault), 50 ether);
        _gain(1.1 ether);
        _withdraw(160 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 1059 ether);
    }

    function testUnsolicitedSharesAreProtectedButNotFeeBearing() public {
        _deposit(100 ether);
        morpho.mint(address(vault), 100 ether);
        _gain(1.1 ether);
        _withdraw(220 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.costBasis(), 0);
    }

    function testCashInheritanceTransfersNetYieldToFixedHeir() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        _eligible();
        vm.prank(stranger);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(stranger), 0);
        assertEq(morpho.balanceOf(address(vault)), 0);
        assertGt(vault.claimedAt(), 0);
    }

    function testIlliquidInheritanceTransfersReceiptsInsteadOfBlocking() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        morpho.setLiquidity(0);
        wld.mint(address(vault), 5 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 5 ether);
        uint256 feeShares = YieldMath.mulDiv(100 ether, 1 ether, 110 ether);
        assertEq(morpho.balanceOf(operator), feeShares);
        assertEq(morpho.balanceOf(heir), 100 ether - feeShares);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.costBasis(), 0);
        assertGt(vault.claimedAt(), 0);
    }

    function testHeirRedeemsInheritedSharesWithoutSecondFee() public {
        testIlliquidInheritanceTransfersReceiptsInsteadOfBlocking();
        uint256 shares = morpho.balanceOf(heir);
        uint256 expected = morpho.previewRedeem(shares);
        morpho.setLiquidity(type(uint256).max);
        vm.startPrank(heir);
        morpho.approve(address(factory), shares);
        factory.redeemWalletShares(shares, expected);
        vm.stopPrank();
        assertEq(wld.balanceOf(heir), 5 ether + expected);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(morpho.balanceOf(address(factory)), 0);
    }

    function testUnavailableQuoteCannotLockInheritanceReceipts() public {
        _deposit(100 ether);
        morpho.setBrokenQuote(true);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(morpho.balanceOf(heir), 100 ether);
        assertEq(morpho.balanceOf(operator), 0);
    }

    function testOwnerCanExitSharesWithoutCashLiquidity() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        morpho.setLiquidity(0);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        assertGt(morpho.balanceOf(owner), 98 ether);
        assertEq(morpho.balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testOwnerCanExitWithBrokenQuote() public {
        _deposit(100 ether);
        morpho.setBrokenQuote(true);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        assertEq(morpho.balanceOf(owner), 100 ether);
    }

    function testOwnerMayRenewAfterSevenDaysUntilActualPayment() public {
        _deposit(100 ether);
        _eligible();
        vm.warp(block.timestamp + 20 days);
        vm.prank(owner);
        factory.pingMyVault();
        assertTrue(vault.ownerStillActive());
        assertEq(vault.claimFiledAt(), 0);
        vm.expectRevert(InheritanceVaultMorpho.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
    }

    function testNoClaimMeansNoAutomaticPayment() public {
        _deposit(100 ether);
        vm.warp(vault.deadline() + 8 days);
        vm.expectRevert(InheritanceVaultMorpho.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
    }

    function testReviewPeriodCannotBeSkipped() public {
        _deposit(100 ether);
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt() - 1);
        vm.expectRevert(InheritanceVaultMorpho.ChallengeStillRunning.selector);
        factory.executeInheritance(address(vault));
    }

    function testStrangerCannotFileClaimOrRedirectWithdrawal() public {
        _deposit(100 ether);
        vm.warp(vault.deadline());
        vm.startPrank(stranger);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotHeir.selector);
        factory.fileClaimFor(address(vault));
        vm.expectRevert(InheritanceVaultMorpho.NotOwner.selector);
        vault.ownerWithdrawWLD(100 ether, stranger);
        vm.stopPrank();
    }

    function testProtectedSharesCannotEscapeThroughTokenRescue() public {
        _deposit(100 ether);
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultMorpho.ProtectedToken.selector);
        factory.rescueFromMyVault(address(morpho), 100 ether, owner);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        vm.stopPrank();
    }

    function testDepositSlippageFailureRollsBackTransferAndApproval() public {
        vm.startPrank(owner);
        wld.approve(address(factory), 100 ether);
        vm.expectRevert(InheritanceVaultMorpho.SlippageExceeded.selector);
        factory.depositWithMinShares(100 ether, 101 ether);
        vm.stopPrank();
        assertEq(wld.balanceOf(owner), 1000 ether);
        assertEq(morpho.balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 0);
    }

    function testIlliquidCashWithdrawalIsAtomic() public {
        _deposit(100 ether);
        morpho.setLiquidity(0);
        vm.prank(owner);
        vm.expectRevert();
        factory.withdrawFromMyVault(owner, 100 ether);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
    }

    function testExpiredDepositsAreRejectedAndRolledBack() public {
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        wld.approve(address(factory), 100 ether);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.depositWithMinShares(100 ether, 100 ether);
        vm.stopPrank();
        assertEq(wld.balanceOf(owner), 1000 ether);
    }

    function testAlreadySettledCannotRenewOrPayTwice() public {
        _deposit(100 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.pingMyVault();
        vm.expectRevert(InheritanceVaultMorpho.AlreadyClaimed.selector);
        factory.executeInheritance(address(vault));
    }

    function testSlotCannotReleaseWithOnlyReceiptShares() public {
        _deposit(100 ether);
        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorphoFactory.VaultNotEmpty.selector);
        factory.releaseMyVault();
    }

    function testSettledDonationsCanBeRecoveredWithoutReopeningClaim() public {
        _deposit(100 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        wld.mint(address(vault), 1 ether);
        morpho.mint(address(vault), 2 ether);
        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(morpho.balanceOf(owner), 2 ether);
        assertEq(wld.balanceOf(operator), 0);
        vm.prank(owner);
        assertTrue(factory.releaseMyVault());
    }

    function testCancellationAllowsOwnerToWithdrawAfterExpiry() public {
        _deposit(100 ether);
        vm.prank(owner);
        factory.cancelMyInheritance();
        vm.warp(vault.deadline());
        _withdraw(100 ether);
        assertEq(wld.balanceOf(owner), 1000 ether);
    }

    function testUnderlyingCannotReenterInheritance() public {
        _deposit(100 ether);
        _eligible();
        morpho.setCallback(address(factory), abi.encodeCall(factory.executeInheritance, (address(vault))));
        factory.executeInheritance(address(vault));
        assertFalse(morpho.callbackSucceeded());
        assertEq(wld.balanceOf(heir), 100 ether);
    }

    function testForeignFactoryVaultCannotBeExecuted() public {
        InheritanceVaultMorphoFactory other =
            new InheritanceVaultMorphoFactory(address(wld), address(morpho), operator, 1000);
        vm.prank(owner);
        address foreign = other.createVault(heir, 30 days);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.executeInheritance(foreign);
    }

    function testInvalidUnderlyingAndExcessFeeRejected() public {
        MockERC20 wrong = new MockERC20("Other", "BAD");
        vm.expectRevert(InheritanceVaultMorphoFactory.InvalidStrategy.selector);
        new InheritanceVaultMorphoFactory(address(wrong), address(morpho), operator, 1000);
        vm.expectRevert(InheritanceVaultMorphoFactory.InvalidFee.selector);
        new InheritanceVaultMorphoFactory(address(wld), address(morpho), operator, 1001);
    }

    function testPositionSeparatesNetValueFromLiquidity() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        morpho.setLiquidity(20 ether);
        (uint256 idle, uint256 shares, uint256 gross, uint256 net, uint256 fee, uint256 liquid, bool valued) =
            vault.position();
        assertEq(idle, 0);
        assertEq(shares, 100 ether);
        assertEq(gross, 110 ether);
        assertEq(net, 109 ether);
        assertEq(fee, 1 ether);
        assertEq(liquid, 20 ether);
        assertTrue(valued);
    }

    function testPositionReportsUnavailableValuationWithoutHidingShares() public {
        _deposit(100 ether);
        morpho.setBrokenQuote(true);
        (, uint256 shares,,,, uint256 liquid, bool valued) = vault.position();
        assertEq(shares, 100 ether);
        assertEq(liquid, 0);
        assertFalse(valued);
    }

    function testFuzzFeeNeverChargesMoreThanPositiveGain(uint96 depositRaw, uint64 rateRaw) public {
        uint256 assets = bound(uint256(depositRaw), 1 ether, 1000 ether);
        uint256 rate = bound(uint256(rateRaw), 0.1 ether, 5 ether);
        _deposit(assets);
        _gain(rate);
        uint256 gross = morpho.convertToAssets(morpho.balanceOf(address(vault)));
        wld.mint(address(morpho), gross);
        _eligible();
        factory.executeInheritance(address(vault));
        uint256 expected = gross > assets ? (gross - assets) / 10 : 0;
        assertEq(wld.balanceOf(operator), expected);
        assertEq(vault.costBasis(), 0);
    }

    function testFuzzFullPrecisionMath(uint128 x, uint128 y, uint128 denominator) public pure {
        uint256 d = uint256(denominator) + 1;
        assertEq(YieldMath.mulDiv(x, y, d), uint256(x) * uint256(y) / d);
    }

    function testFullPrecisionMathExceeding256BitProduct() public pure {
        assertEq(YieldMath.mulDiv(1 << 200, 1 << 100, 1 << 100), 1 << 200);
        assertEq(YieldMath.mulDivUp(11, 11, 10), 13);
    }

    function testFullOwnerExitWithFractionalShareRateLeavesNoDust() public {
        _deposit(100 ether);
        _gain(1.21 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 116 ether);
        assertEq(morpho.balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 0);
        assertEq(wld.balanceOf(operator), 2.1 ether);
        assertEq(wld.balanceOf(owner), 1018.9 ether);
    }

    function testFullExitMinimumRollsBackFeesAndShareBurn() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.SlippageExceeded.selector);
        factory.withdrawAllFromMyVault(owner, 110 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testWalletRedeemMinimumRollsBackReceiptTransfer() public {
        _deposit(100 ether);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        vm.startPrank(owner);
        morpho.approve(address(factory), 100 ether);
        vm.expectRevert(InheritanceVaultMorphoFactory.SlippageExceeded.selector);
        factory.redeemWalletShares(100 ether, 101 ether);
        vm.stopPrank();
        assertEq(morpho.balanceOf(owner), 100 ether);
        assertEq(morpho.balanceOf(address(factory)), 0);
        assertEq(wld.balanceOf(owner), 900 ether);
    }

    function testGasExhaustingStrategyStillHandsOverSharesWithinExecutionCap() public {
        _deposit(100 ether);
        _eligible();
        morpho.setGasFailure(true, true);
        factory.executeInheritance{gas: 750_000}(address(vault));
        assertEq(morpho.balanceOf(heir), 100 ether);
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(morpho.balanceOf(operator), 0);
    }

    function testForcedEthBlocksReleaseUntilOwnerSweep() public {
        vm.prank(owner);
        factory.cancelMyInheritance();
        vm.warp(vault.deadline());
        vm.deal(address(vault), 1 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorphoFactory.VaultNotEmpty.selector);
        factory.releaseMyVault();
        vm.prank(owner);
        factory.sweepEthFromMyVault(payable(owner));
        assertEq(owner.balance, 1 ether);
        vm.prank(owner);
        assertTrue(factory.releaseMyVault());
    }

    function testHeirAndPeriodStayFrozenAfterExpiryUntilRenewal() public {
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.updateMyHeir(stranger);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.changeMyPeriod(60 days);
        factory.pingMyVault();
        factory.updateMyHeir(stranger);
        factory.changeMyPeriod(60 days);
        vm.stopPrank();
        assertEq(vault.heir(), stranger);
        assertEq(vault.heartbeatInterval(), 60 days);
    }

    function testLifecycleViewsAgreeWithIrreversibleSettlement() public {
        _deposit(100 ether);
        assertEq(vault.totalAssets(), 100 ether);
        assertEq(vault.timeRemaining(), 30 days);
        assertFalse(vault.claimPending());
        assertFalse(vault.claimableNow());
        vm.warp(vault.deadline());
        assertEq(vault.timeRemaining(), 0);
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        assertTrue(vault.claimPending());
        assertTrue(vault.challengeRunning());
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultMorpho.AlreadyFiled.selector);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        assertTrue(vault.claimableNow());
        vm.prank(heir);
        factory.finalizeClaimFor(address(vault));
        assertFalse(vault.claimableNow());
        assertFalse(vault.isExpired());
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(vault.heir(), address(0));
        assertEq(vault.totalAssets(), 0);
    }

    function testIdleOnlyInheritanceIsFeeFreeAndEmptyClaimStaysRetryable() public {
        _eligible();
        vm.expectRevert(InheritanceVaultMorpho.NothingToTransfer.selector);
        factory.executeInheritance(address(vault));
        assertEq(vault.claimedAt(), 0);
        wld.mint(address(vault), 4 ether);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 4 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testRescueCannotTouchEitherProtectedAssetOrPreemptInheritance() public {
        _deposit(100 ether);
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        stray.mint(address(vault), 3 ether);
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultMorpho.ProtectedToken.selector);
        factory.rescueFromMyVault(address(wld), 100 ether, owner);
        factory.rescueFromMyVault(address(stray), 3 ether, owner);
        vm.expectRevert(InheritanceVaultMorpho.NotSettled.selector);
        factory.sweepSettledVaultFor(owner);
        vm.stopPrank();
        assertEq(stray.balanceOf(owner), 3 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
    }

    function testUnauthorizedDirectAndGatewayClaimsAreRejected() public {
        _deposit(100 ether);
        _eligible();
        vm.startPrank(stranger);
        vm.expectRevert(InheritanceVaultMorpho.NotHeir.selector);
        vault.finalizeClaim();
        vm.expectRevert(InheritanceVaultMorphoFactory.NotHeir.selector);
        factory.finalizeClaimFor(address(vault));
        vm.expectRevert(InheritanceVaultMorpho.NotHeir.selector);
        vault.fileClaim();
        vm.expectRevert(InheritanceVaultMorphoFactory.NoVault.selector);
        factory.withdrawFromMyVault(stranger, 100 ether);
        vm.stopPrank();
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
        assertEq(vault.claimedAt(), 0);
    }

    function testInvalidExitInputsCannotBurnCapitalOrBypassConsentBounds() public {
        _deposit(100 ether);
        vm.startPrank(owner);
        assertEq(factory.myVault(), address(vault));
        vm.expectRevert(InheritanceVaultMorphoFactory.AlreadyHasVault.selector);
        factory.createVault(heir, 30 days);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotExpired.selector);
        factory.releaseMyVault();
        vm.expectRevert(InheritanceVaultMorpho.InvalidAmount.selector);
        factory.withdrawSharesFromMyVault(owner, 101 ether);
        vm.expectRevert(InheritanceVaultMorpho.InvalidAmount.selector);
        factory.withdrawFromMyVault(owner, 0);
        vm.expectRevert(InheritanceVaultMorpho.InvalidAddress.selector);
        factory.withdrawFromMyVault(address(vault), 1 ether);
        vm.expectRevert(InheritanceVaultMorpho.InvalidAddress.selector);
        factory.updateMyHeir(address(0));
        vm.expectRevert(InheritanceVaultMorpho.HeartbeatOutOfRange.selector);
        factory.changeMyPeriod(366 days);
        vm.expectRevert(InheritanceVaultMorphoFactory.InvalidAmount.selector);
        factory.redeemWalletShares(0, 1);
        vm.stopPrank();
        assertEq(vault.costBasis(), 100 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
    }
}
