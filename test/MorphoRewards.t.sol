// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultMorphoTest} from "./InheritanceVaultMorpho.t.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";

contract MorphoRewardsTest is InheritanceVaultMorphoTest {
    MockMerklDistributor internal distributor;

    function setUp() public override {
        super.setUp();
        MockMerklDistributor implementation = new MockMerklDistributor();
        vm.etch(vault.MERKL_DISTRIBUTOR(), address(implementation).code);
        distributor = MockMerklDistributor(vault.MERKL_DISTRIBUTOR());
        wld.mint(address(distributor), 1000 ether);
    }

    function _reward(uint256 cumulative) internal returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = keccak256("unrelated reward leaf");
        bytes32 leaf = keccak256(abi.encode(address(vault), address(wld), cumulative));
        distributor.setRoot(
            leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf))
        );
    }

    function _externalReward(uint256 cumulative) internal {
        bytes32[] memory proof = _reward(cumulative);
        distributor.setOperator(stranger, true);
        address[] memory users = new address[](1);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        users[0] = address(vault);
        tokens[0] = address(wld);
        amounts[0] = cumulative;
        proofs[0] = proof;
        vm.prank(stranger);
        distributor.claim(users, tokens, amounts, proofs);
        assertEq(vault.totalRewardsClaimed(), cumulative);
        assertEq(wld.balanceOf(stranger), 0);
    }

    function testExternallyDeliveredRewardsPayTheSameFeeWithoutReinvestment() public {
        _deposit(100 ether);
        _externalReward(10 ether);
        assertEq(vault.unprocessedRewards(), 10 ether);
        (,,, uint256 net, uint256 fee,,) = vault.position();
        assertEq(net, 109 ether);
        assertEq(fee, 1 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, net);
        assertEq(wld.balanceOf(owner), 1009 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testPartialCashExitSeparatesExternalRewardsFromGifts() public {
        _externalReward(10 ether);
        wld.mint(address(vault), 10 ether);
        _withdraw(10 ether);
        assertEq(vault.unprocessedRewards(), 5 ether);
        assertEq(wld.balanceOf(operator), 0.5 ether);
        _withdraw(10 ether);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 1019 ether);
    }

    function testExternalRewardsCanBeProcessedOrProofReplayedExactlyOnce() public {
        _deposit(100 ether);
        uint256 ping = vault.lastPing();
        _externalReward(10 ether);
        assertEq(factory.processRewardsFor(address(vault), 10 ether), 10 ether);
        assertEq(factory.processRewardsFor(address(vault), 0), 0);
        assertEq(factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0), 0);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.accountedShares(), 110 ether);
        assertEq(vault.lastPing(), ping);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testUnavailableReinvestmentCannotLockExternalRewardCashOrPrincipalExit() public {
        _deposit(100 ether);
        _externalReward(10 ether);
        morpho.setBrokenQuote(true);
        vm.mockCallRevert(
            address(morpho), abi.encodeWithSelector(morpho.previewDeposit.selector), bytes("deposit unavailable")
        );
        vm.expectRevert();
        factory.processRewardsFor(address(vault), 0);
        assertEq(vault.unprocessedRewards(), 10 ether);
        // Neither direct reward cash nor receipt custody requires a deposit quote.
        _withdraw(10 ether);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(morpho.balanceOf(owner), 100 ether);
        assertEq(vault.realizedLoss(), 0);
        assertFalse(vault.hasAssets());
    }

    function testFullExitCombinesShareLossAndExternalRewardsBeforeFee() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _externalReward(30 ether);
        (,,, uint256 net, uint256 fee,,) = vault.position();
        assertEq(fee, 1 ether);
        assertEq(net, 109 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, net);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testExternalRewardsParticipateInBothCashAndReceiptInheritance() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        morpho.setLiquidity(0);
        _externalReward(30 ether);
        wld.mint(address(vault), 5 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(morpho.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(heir), 34 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testSettledOwnerSweepRoutesOnlyExternalRewardsToTheFixedHeir() public {
        _deposit(100 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        _externalReward(10 ether);
        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 900 ether);
        assertFalse(vault.hasAssets());
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testSettledArchiveRecoverySeparatesExternalRewardsAndDonations() public {
        _deposit(100 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        vm.prank(owner);
        factory.releaseMyVault();
        _externalReward(10 ether);
        wld.mint(address(vault), 5 ether);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 905 ether);
        assertFalse(vault.hasAssets());
        _externalReward(20 ether);
        factory.processRewardsFor(address(vault), 0);
        assertEq(wld.balanceOf(heir), 118 ether);
        assertEq(wld.balanceOf(operator), 2 ether);
    }

    function testLateExternalRewardsOffsetProvenLossAndUnknownQuoteCannotInventLoss() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(vault.realizedLoss(), 20 ether);
        _externalReward(30 ether);
        vault.processRewards(0);
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.realizedLoss(), 0);
    }

    function testProcessRewardsRejectsForgedRegistryMembership() public {
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.processRewardsFor(stranger, 0);
    }

    function testProvenRewardsCompoundWithoutInflatingCapitalAndExitPaysTenPercent() public {
        _deposit(100 ether);
        uint256 ping = vault.lastPing();
        bytes32[] memory proof = _reward(10 ether);
        vm.prank(stranger);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.accountedShares(), 110 ether);
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(vault.lastPing(), ping);
        assertEq(wld.balanceOf(stranger), 0);
        assertEq(wld.allowance(address(vault), address(morpho)), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 109 ether);
        assertEq(wld.balanceOf(owner), 1009 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testRewardReplayDoesNotMintOrChargeTwice() public {
        _deposit(100 ether);
        bytes32[] memory proof = _reward(10 ether);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        assertEq(factory.claimRewardsFor(address(vault), 10 ether, proof, 0), 0);
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(morpho.balanceOf(address(vault)), 110 ether);
        factory.claimRewardsFor(address(vault), 15 ether, _reward(15 ether), 0);
        assertEq(vault.totalRewardsClaimed(), 15 ether);
        assertEq(morpho.balanceOf(address(vault)), 115 ether);
    }

    function testRewardFailureIsAtomicAndCannotCountAnIdleDonation() public {
        _deposit(100 ether);
        wld.mint(address(vault), 5 ether);
        bytes32[] memory proof = _reward(10 ether);
        vm.expectRevert(InheritanceVaultMorpho.SlippageExceeded.selector);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 11 ether);
        assertEq(distributor.claimed(address(vault), address(wld)), 0);
        assertEq(vault.totalRewardsClaimed(), 0);
        assertEq(wld.balanceOf(address(vault)), 5 ether);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 10 ether);
        assertEq(wld.balanceOf(address(vault)), 5 ether);
        assertEq(vault.costBasis(), 100 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 114 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testProofIsBoundToVaultTokenAndCumulativeAmount() public {
        bytes32[] memory proof = _reward(10 ether);
        vm.expectRevert(MockMerklDistributor.InvalidProof.selector);
        factory.claimRewardsFor(address(vault), 11 ether, proof, 0);
        vm.prank(stranger);
        InheritanceVaultMorpho other = InheritanceVaultMorpho(payable(factory.createVault(heir, 30 days)));
        vm.expectRevert(MockMerklDistributor.InvalidProof.selector);
        factory.claimRewardsFor(address(other), 10 ether, proof, 0);
        assertEq(vault.totalRewardsClaimed(), 0);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.claimRewardsFor(stranger, 10 ether, proof, 0);
    }

    function testRewardCannotReenterVaultOrFactory() public {
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
    }

    function testExpiredAndChallengeRewardsNeverRenewTimer() public {
        _deposit(100 ether);
        uint256 ping = vault.lastPing();
        vm.warp(vault.deadline());
        factory.claimRewardsFor(address(vault), 5 ether, _reward(5 ether), 0);
        assertTrue(vault.isExpired());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        uint256 end = vault.challengeEndsAt();
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        assertEq(vault.lastPing(), ping);
        assertEq(vault.challengeEndsAt(), end);
        vm.warp(end);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testPartialClosedLossOffsetsLaterInterestAndRewards() public {
        _deposit(100 ether);
        morpho.setRate(0.5 ether);
        _withdraw(25 ether);
        assertEq(vault.realizedLoss(), 25 ether);
        _gain(1.2 ether);
        factory.claimRewardsFor(address(vault), 20 ether, _reward(20 ether), 0);
        (,,, uint256 net, uint256 fee,,) = vault.position();
        assertApproxEqAbs(fee, 0.5 ether, 1); // 80 value - 50 remaining basis - 25 closed loss.
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, net);
        assertEq(wld.balanceOf(operator), fee);
        assertEq(vault.realizedLoss(), 0);
    }

    function testLossRecoveryRewardsAfterFullOwnerExitAreFeeFree() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _withdraw(80 ether);
        assertEq(vault.realizedLoss(), 20 ether);
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 10 ether);
        assertEq(vault.realizedLoss(), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
        factory.claimRewardsFor(address(vault), 30 ether, _reward(30 ether), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 19 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(vault.realizedLoss(), 0);
    }

    function testLateRewardsAfterReleaseStillPayFixedHeirWithLossOffset() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 80 ether);
        assertEq(vault.realizedLoss(), 20 ether);
        vm.prank(owner);
        factory.releaseMyVault();
        assertEq(factory.vaultOf(owner), address(0));
        assertTrue(factory.knownVaults(address(vault)));
        bytes32[] memory proof = _reward(10 ether);
        vm.prank(stranger);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        assertEq(wld.balanceOf(heir), 90 ether);
        assertEq(wld.balanceOf(operator), 0);
        factory.claimRewardsFor(address(vault), 40 ether, _reward(40 ether), 0);
        assertEq(wld.balanceOf(heir), 118 ether);
        assertEq(wld.balanceOf(operator), 2 ether);
        assertEq(wld.balanceOf(address(vault)), 0);
        assertEq(wld.balanceOf(stranger), 0);
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(vault.costBasis(), 0);
    }

    function testBoundedInvalidRewardInputsDoNotTouchCapital() public {
        _deposit(100 ether);
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(InheritanceVaultMorpho.InvalidRewards.selector);
        vault.claimRewards(1, proof, 0);
        proof = new bytes32[](65);
        vm.expectRevert(InheritanceVaultMorpho.InvalidRewards.selector);
        vault.claimRewards(1, proof, 0);
        proof = _reward(1);
        vm.expectRevert(InheritanceVaultMorpho.InvalidRewards.selector);
        vault.claimRewards(0, proof, 0);
        assertEq(vault.costBasis(), 100 ether);
    }

    function testRewardsAfterEmptyUnsettledReleaseCanStillBeInherited() public {
        _deposit(100 ether);
        _withdraw(100 ether);
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(stranger, 30 days);
        vm.stopPrank();
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        assertEq(vault.costBasis(), 0);
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        vm.prank(stranger);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 9 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(factory.vaultOf(owner), next);
        assertEq(wld.balanceOf(next), 0);
        assertEq(morpho.balanceOf(next), 0);
    }

    function testMatchingSelfReportedProvenanceCannotForgeFactoryMembership() public {
        InheritanceVaultMorpho forged = new InheritanceVaultMorpho(
            owner, heir, address(wld), 30 days, address(factory), address(morpho), operator, 1000
        );
        assertFalse(factory.knownVaults(address(forged)));
        bytes32[] memory proof = _reward(1 ether);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.claimRewardsFor(address(forged), 1 ether, proof, 0);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.executeInheritance(address(forged));
    }

    function testUnknownShareValuationCannotInventLossForAFutureCashExit() public {
        _deposit(100 ether);
        morpho.setBrokenQuote(true);
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, 100 ether);
        assertEq(morpho.balanceOf(owner), 100 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.costBasis(), 0);
        morpho.setBrokenQuote(false);
        _deposit(100 ether);
        morpho.setRate(1.1 ether);
        wld.mint(address(morpho), 20 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
    }

    function testUnknownValuationPreservesOnlyPreviouslyProvenLoss() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 80 ether);
        assertEq(vault.realizedLoss(), 20 ether);
        _deposit(100 ether);
        morpho.setBrokenQuote(true);
        uint256 returnedShares = morpho.balanceOf(address(vault));
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, returnedShares);
        assertEq(vault.realizedLoss(), 20 ether);
        morpho.setBrokenQuote(false);
        factory.claimRewardsFor(address(vault), 40 ether, _reward(40 ether), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 38 ether);
        assertEq(wld.balanceOf(operator), 2 ether);
        assertEq(vault.realizedLoss(), 0);
    }

    function testReleasedCancelledRewardsCanBeRecoveredWithoutTouchingCurrentVault() public {
        vm.prank(owner);
        factory.cancelMyInheritance();
        vm.warp(vault.deadline());
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(stranger, 30 days);
        vm.stopPrank();
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        wld.mint(address(vault), 3 ether);
        morpho.setLiquidity(0);
        uint256 nextPing = InheritanceVaultMorpho(payable(next)).lastPing();
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(morpho.balanceOf(owner), 9 ether);
        assertEq(morpho.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 1003 ether);
        assertFalse(vault.hasAssets());
        assertEq(factory.vaultOf(owner), next);
        assertEq(InheritanceVaultMorpho(payable(next)).lastPing(), nextPing);
        assertEq(morpho.balanceOf(next), 0);
    }

    function testArchivedRecoveryCancelsOriginalReviewAndPaysOnlyItsOwner() public {
        vm.warp(vault.deadline());
        vm.prank(owner);
        factory.releaseMyVault();
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        assertGt(vault.claimFiledAt(), 0);
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(vault));
        assertGt(vault.claimFiledAt(), 0);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(vault.claimFiledAt(), 0);
        assertEq(morpho.balanceOf(owner), 9 ether);
        assertEq(morpho.balanceOf(heir), 0);
    }

    function testSettledArchiveRecoveryCannotTakeFixedHeirsLateReward() public {
        _deposit(100 ether);
        _eligible();
        factory.executeInheritance(address(vault));
        vm.prank(owner);
        factory.releaseMyVault();
        factory.claimRewardsFor(address(vault), 10 ether, _reward(10 ether), 0);
        wld.mint(address(vault), 3 ether);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(wld.balanceOf(heir), 109 ether);
        assertEq(wld.balanceOf(operator), 1 ether);
        assertEq(wld.balanceOf(owner), 903 ether);
        assertEq(vault.inheritanceRecipient(), heir);
    }

    function testRecoveryRejectsCurrentAndForeignVaults() public {
        _deposit(100 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(vault));
        InheritanceVaultMorpho forged = new InheritanceVaultMorpho(
            owner, heir, address(wld), 30 days, address(factory), address(morpho), operator, 1000
        );
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorphoFactory.NotOurVault.selector);
        factory.recoverArchivedVault(address(forged));
        assertEq(vault.costBasis(), 100 ether);
        assertEq(morpho.balanceOf(address(vault)), 100 ether);
    }
}
