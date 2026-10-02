// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultUSDCBase} from "./InheritanceVaultUSDCBase.t.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";

contract USDCRewardsTest is InheritanceVaultUSDCBase {
    function testCanonicalWLDHeldWithoutChangingUSDCCapitalOrTimer() public {
        _deposit(100e6);
        uint256 ping = vault.lastPing();
        assertEq(_claim(10 ether), 10 ether);
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(vault.unprocessedRewards(), 10 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.accountedShares(), 100 ether);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(vault.lastPing(), ping);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(wld.allowance(address(vault), address(re7)), 0);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testExternalCanonicalRewardsFeeAndGiftsAreSeparate() public {
        _externalReward(10 ether);
        wld.mint(address(vault), 5 ether);
        (uint256 held, uint256 feeBearing, uint256 net, uint256 fee) = vault.rewardPosition();
        assertEq(held, 15 ether);
        assertEq(feeBearing, 10 ether);
        assertEq(net, 14 ether);
        assertEq(fee, 1 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 14 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(vault.totalRewardsClaimed(), 10 ether);
    }

    function testRewardOnlyFullExitWithoutUSDC() public {
        _claim(10 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(wld.balanceOf(owner), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(operator), 0);
        assertFalse(vault.hasAssets());
    }

    function testRewardOnlyFullExitCannotSatisfyPositiveUSDCMinimum() public {
        _claim(10 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.SlippageExceeded.selector);
        factory.withdrawAllFromMyVault(owner, 1);
        assertEq(vault.unprocessedRewards(), 10 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testRewardOnlyInheritanceSettlesBothCanonicalAndGiftWLD() public {
        _claim(10 ether);
        wld.mint(address(vault), 3 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertGt(vault.claimedAt(), 0);
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(wld.balanceOf(heir), 12 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(heir), 0);
        assertFalse(vault.hasAssets());
    }

    function testWLDGiftsHaveNoFeeEvenAfterPriorCanonicalPayout() public {
        _claim(10 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        wld.mint(address(vault), 5 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 14 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testUSDCLossDoesNotReduceWLDRewardFeeOrGetRecoveredByWLD() public {
        _deposit(100e6);
        re7.setRate(500_000);
        _withdraw(50e6);
        assertEq(vault.realizedLoss(), 50e6);
        _claim(100 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 90 ether);
        assertEq(wld.balanceOf(operator), 10 ether);
        assertEq(vault.realizedLoss(), 50e6);
        _deposit(50e6);
        _gain(1e6);
        _withdraw(100e6);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(vault.realizedLoss(), 0);
    }

    function testFullUSDCShareLossAndWLDRewardsEachHaveIndependentFee() public {
        _deposit(100e6);
        re7.setRate(800_000);
        _externalReward(30 ether);
        (,,, uint256 net, uint256 fee,,) = vault.position();
        assertEq(net, 80e6);
        assertEq(fee, 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, net);
        assertEq(wld.balanceOf(owner), 27 ether);
        assertEq(wld.balanceOf(operator), 3 ether);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(vault.realizedLoss(), 20e6);
    }

    function testLiveProcessIsNoopAndDoesNotConsumeRewardAccounting() public {
        _externalReward(10 ether);
        uint256 ping = vault.lastPing();
        re7.setBrokenQuote(true);
        assertEq(factory.processRewardsFor(address(vault), 0), 0);
        assertEq(vault.unprocessedRewards(), 10 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(vault.lastPing(), ping);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 9 ether);
    }

    function testNonzeroRewardMinSharesRejectedWithoutTransferOrAccounting() public {
        bytes32[] memory proof = _reward(10 ether);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 1);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.processRewardsFor(address(vault), 1);
        assertEq(vault.totalRewardsClaimed(), 0);
        assertEq(wld.balanceOf(address(vault)), 0);
    }

    function testCumulativeReplayNeverChargesTwice() public {
        assertEq(_claim(10 ether), 10 ether);
        assertEq(_claim(10 ether), 0);
        assertEq(vault.unprocessedRewards(), 10 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(_claim(10 ether), 0);
        assertEq(_claim(20 ether), 10 ether);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 18 ether);
        assertEq(wld.balanceOf(operator), 2 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testExternalDeliveryCanBeReplayedWithoutReclassifyingGifts() public {
        _externalReward(10 ether);
        wld.mint(address(vault), 5 ether);
        assertEq(_claim(10 ether), 0);
        assertEq(factory.processRewardsFor(address(vault), 0), 0);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 14 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testInvalidProofBoundedInputsAndForeignTokenLeafRejected() public {
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        vault.claimRewards(10 ether, proof, 0);
        proof = new bytes32[](65);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        vault.claimRewards(10 ether, proof, 0);
        proof = _reward(10 ether);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        vault.claimRewards(0, proof, 0);
        proof[0] = keccak256("invalid sibling");
        vm.expectRevert(MockMerklDistributor.InvalidProof.selector);
        vault.claimRewards(10 ether, proof, 0);
        bytes32 leaf = keccak256(abi.encode(address(vault), address(usdc), uint256(10e6)));
        distributor.setRoot(
            leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf))
        );
        vm.expectRevert(MockMerklDistributor.InvalidProof.selector);
        vault.claimRewards(10e6, proof, 0);
        assertEq(vault.totalRewardsClaimed(), 0);
    }

    function testMissingCanonicalDeliveryRevertsClaimAtomically() public {
        bytes32[] memory proof = _reward(10 ether);
        vm.mockCall(
            address(wld), abi.encodeWithSelector(wld.transfer.selector, address(vault), 10 ether), abi.encode(true)
        );
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        assertEq(vault.totalRewardsClaimed(), 0);
        assertEq(wld.balanceOf(address(vault)), 0);
    }

    function testPendingCanonicalRewardsNeverExceedCustodiedWLDBalance() public {
        _externalReward(10 ether);
        vm.prank(address(vault));
        assertTrue(wld.transfer(stranger, 1 ether));
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        vault.rewardPosition();
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.processRewardsFor(address(vault), 0);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.withdrawRewardsFromMyVault(owner);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.InvalidRewards.selector);
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(vault.unprocessedRewards(), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
    }

    function testRewardsOnExpiryAndDuringReviewNeverRenewTimer() public {
        _deposit(100e6);
        uint256 ping = vault.lastPing();
        vm.warp(vault.deadline());
        _claim(5 ether);
        assertTrue(vault.isExpired());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        uint256 end = vault.challengeEndsAt();
        _claim(10 ether);
        assertEq(vault.lastPing(), ping);
        assertEq(vault.challengeEndsAt(), end);
        vm.warp(end);
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
        assertEq(wld.balanceOf(heir), 9 ether);
    }

    function testClaimAndGatewayDistributorReentrancyBothFail() public {
        bytes32[] memory proof = _reward(10 ether);
        distributor.setCallback(address(vault), abi.encodeCall(vault.claimRewards, (10 ether, proof, 0)));
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        assertFalse(distributor.callbackSucceeded());
        proof = _reward(20 ether);
        distributor.setCallback(
            address(factory), abi.encodeCall(factory.claimRewardsFor, (address(vault), 20 ether, proof, 0))
        );
        factory.claimRewardsFor(address(vault), 20 ether, proof, 0);
        assertFalse(distributor.callbackSucceeded());
        assertEq(vault.totalRewardsClaimed(), 20 ether);
        assertEq(wld.balanceOf(address(vault)), 20 ether);
    }

    function testRewardWithdrawAuthorizationExpiryAndRenewal() public {
        _claim(10 ether);
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawRewards(stranger);
        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawRewardsFromMyVault(owner);
        vm.prank(owner);
        factory.pingMyVault();
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 9 ether);
    }

    function testLateClaimAfterReleasePaysFixedHeirDespiteUSDCClosedLoss() public {
        _deposit(100e6);
        re7.setRate(800_000);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(vault.realizedLoss(), 20e6);
        vm.prank(owner);
        factory.releaseMyVault();
        assertEq(factory.vaultOf(owner), address(0));
        bytes32[] memory proof = _reward(10 ether);
        vm.prank(stranger);
        assertEq(factory.claimRewardsFor(address(vault), 10 ether, proof, 0), 10 ether);
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(stranger), 0);
        assertEq(vault.realizedLoss(), 20e6);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(_claim(10 ether), 0);
    }

    function testLateExternalDeliveryProcessedOnlyOnceToFixedHeir() public {
        _claim(1 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        _externalReward(11 ether);
        assertEq(vault.unprocessedRewards(), 10 ether);
        vm.prank(stranger);
        assertEq(factory.processRewardsFor(address(vault), 0), 10 ether);
        assertEq(factory.processRewardsFor(address(vault), 0), 0);
        assertEq(wld.balanceOf(heir), 9.9 ether);
        assertEq(wld.balanceOf(operator), 1.1 ether);
        assertEq(wld.balanceOf(stranger), 0);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testSettledSweepPaysCanonicalHeirBeforeRecoveringThreeGiftTypes() public {
        _deposit(100e6);
        _eligible();
        factory.executeInheritance(address(vault));
        _externalReward(10 ether);
        usdc.mint(address(vault), 5e6);
        wld.mint(address(vault), 3 ether);
        re7.mint(address(vault), 2 ether);
        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(usdc.balanceOf(owner), 905e6);
        assertEq(wld.balanceOf(owner), 3 ether);
        assertEq(re7.balanceOf(owner), 2 ether);
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(re7.balanceOf(operator), 0);
        assertFalse(vault.hasAssets());
    }

    function testSettledSweepWithOnlyLateCanonicalWLDDoesNotPayOwner() public {
        _claim(1 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        _externalReward(11 ether);
        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(wld.balanceOf(owner), 0);
        assertEq(wld.balanceOf(heir), 9.9 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testSettledArchiveRecoveryDoesNotTouchReplacementVault() public {
        _deposit(100e6);
        _eligible();
        factory.executeInheritance(address(vault));
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(stranger, 365 days);
        usdc.approve(address(factory), 10e6);
        factory.depositWithMinShares(10e6, 10 ether);
        vm.stopPrank();
        uint256 ping = InheritanceVaultUSDC(payable(next)).lastPing();
        _externalReward(10 ether);
        wld.mint(address(vault), 3 ether);
        usdc.mint(address(vault), 5e6);
        re7.mint(address(vault), 2 ether);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(owner), 3 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(owner), 895e6);
        assertEq(re7.balanceOf(owner), 2 ether);
        assertEq(factory.vaultOf(owner), next);
        assertEq(InheritanceVaultUSDC(payable(next)).lastPing(), ping);
        assertEq(re7.balanceOf(next), 10 ether);
        assertEq(wld.balanceOf(next), 0);
        assertEq(InheritanceVaultUSDC(payable(next)).costBasis(), 10e6);
    }

    function testExpiredEmptyArchiveLaterWLDCanBeInheritedByOriginalHeir() public {
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(stranger, 30 days);
        vm.stopPrank();
        _claim(10 ether);
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(factory.vaultOf(owner), next);
        assertEq(wld.balanceOf(next), 0);
        assertEq(re7.balanceOf(next), 0);
    }

    function testArchivedRecoveryBeforeSettlementRenewsAndCancelsReview() public {
        vm.warp(vault.deadline());
        vm.prank(owner);
        factory.releaseMyVault();
        _claim(10 ether);
        usdc.mint(address(vault), 3e6);
        re7.mint(address(vault), 2 ether);
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        assertGt(vault.claimFiledAt(), 0);
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(vault));
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(vault.claimFiledAt(), 0);
        assertTrue(vault.ownerStillActive());
        assertEq(wld.balanceOf(owner), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(owner), 1003e6);
        assertEq(re7.balanceOf(owner), 2 ether);
        assertEq(wld.balanceOf(heir), 0);
        assertFalse(vault.hasAssets());
    }

    function testCancelledArchivedRewardOnlyRecoveryPaysOriginalOwner() public {
        vm.prank(owner);
        factory.cancelMyInheritance();
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(stranger, 30 days);
        vm.stopPrank();
        _externalReward(10 ether);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(wld.balanceOf(owner), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(factory.vaultOf(owner), next);
        assertFalse(vault.hasAssets());
    }

    function testRecoveryRejectsCurrentEmptyAndForgedVaults() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(vault));
        vm.warp(vault.deadline());
        vm.prank(owner);
        factory.releaseMyVault();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.InvalidAmount.selector);
        factory.recoverArchivedVault(address(vault));
        InheritanceVaultUSDC forged = new InheritanceVaultUSDC(
            owner, heir, address(usdc), address(wld), 30 days, address(factory), address(re7), operator, 1000
        );
        bytes32[] memory proof = _reward(10 ether);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.claimRewardsFor(address(forged), 10 ether, proof, 0);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDCFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(forged));
    }

    function testFullUSDCLossStillSettlesWithWLDAndRetainsSeparateLossLedger() public {
        _deposit(100e6);
        re7.setRate(0);
        _claim(10 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(vault.realizedLoss(), 100e6);
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(usdc.balanceOf(heir), 0);
        assertGt(vault.claimedAt(), 0);
        _claim(20 ether);
        assertEq(wld.balanceOf(heir), 18 ether);
        assertEq(wld.balanceOf(operator), 2 ether);
        assertEq(vault.realizedLoss(), 100e6);
    }

    function testWLDAtomHasNoRoundedFeeButIsAccountedOnce() public {
        _claim(1);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner), 1);
        assertEq(wld.balanceOf(operator), 0);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(_claim(1), 0);
    }

    function testFuzzCanonicalRewardFeeExcludesAllDirectWLDGifts(uint96 rewardRaw, uint96 giftRaw) public {
        uint256 rewards = bound(uint256(rewardRaw), 1, 100 ether);
        uint256 gift = bound(uint256(giftRaw), 0, 100 ether);
        _externalReward(rewards);
        wld.mint(address(vault), gift);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(operator), rewards / 10);
        assertEq(wld.balanceOf(owner), rewards + gift - rewards / 10);
        assertEq(vault.unprocessedRewards(), 0);
    }
}
