// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {InheritanceVaultMorphoDeployer} from "../contracts/InheritanceVaultMorphoDeployer.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {InheritanceVaultUSDCDeployer} from "../contracts/InheritanceVaultUSDCDeployer.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";
import {MockUSDC} from "./mocks/MockRe7USDC.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";
import {InheritanceVaultUSDCBase} from "./InheritanceVaultUSDCBase.t.sol";

abstract contract OwnerIncomeEventAssertions is Test {
    bytes32 internal constant INCOME_WITHDRAWN_TOPIC = keccak256("IncomeWithdrawn(address,uint256,uint256,uint256)");

    function _incomeEvent(Vm.Log[] memory logs, address emitter, address recipient)
        internal
        returns (uint256 gross, uint256 fee, uint256 net)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != emitter || logs[i].topics.length != 2) continue;
            if (logs[i].topics[0] != INCOME_WITHDRAWN_TOPIC) continue;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), recipient);
            (gross, fee, net) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            return (gross, fee, net);
        }
        fail("IncomeWithdrawn event missing");
        return (0, 0, 0);
    }
}

contract OwnerIncomeUSDC is OwnerIncomeEventAssertions, InheritanceVaultUSDCBase {
    function testUSDCIncomeHarvestReturnsNetAndDoesNotTaxAgainOnFullExit() public {
        _deposit(100e6);
        _gain(1_100_000);
        uint256 initialShares = vault.accountedShares();
        uint256 timer = vault.lastPing();
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10e6);
        assertEq(fee, 1e6);
        assertEq(net, 9e6);
        assertEq(available, 9e6);
        assertTrue(valued);

        uint256 feeBefore = usdc.balanceOf(operator);
        vm.recordLogs();
        vm.prank(owner);
        uint256 returned = factory.withdrawIncomeFromMyVault(operator, available);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 disposed, uint256 paidFee, uint256 eventNet) = _incomeEvent(logs, address(vault), operator);
        assertEq(returned, available);
        assertEq(eventNet, returned);
        assertEq(disposed - paidFee, eventNet);
        assertEq(usdc.balanceOf(operator) - feeBefore, disposed);
        assertLt(vault.accountedShares(), initialShares);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.lastPing(), timer);

        (,,, available, valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 0);
        uint256 feeAfterIncome = usdc.balanceOf(operator);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(usdc.balanceOf(operator), feeAfterIncome);
        assertEq(vault.costBasis(), 0);
    }

    function testUSDCClosedLossReserveSurvivesIncomeHarvest() public {
        _deposit(100e6);
        re7.setRate(800_000);
        _withdraw(80e6);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.realizedLoss(), 20e6);

        _deposit(100e6);
        re7.setRate(1_040_000);
        usdc.mint(address(vault), 25e6);
        re7.mint(address(vault), 100 ether);
        wld.mint(address(vault), 7 ether);
        _claim(50 ether);
        (uint256 gross, uint256 fee,, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10e6);
        assertEq(fee, 1e6);
        assertTrue(valued);

        uint256 directGift = usdc.balanceOf(address(vault));
        uint256 giftShares = re7.balanceOf(address(vault)) - vault.accountedShares();
        uint256 rewardGift = wld.balanceOf(address(vault));
        vm.prank(owner);
        uint256 netReceived = factory.withdrawIncomeFromMyVault(owner, available);
        assertEq(netReceived, available);
        assertEq(usdc.balanceOf(address(vault)), directGift);
        assertEq(re7.balanceOf(address(vault)) - vault.accountedShares(), giftShares);
        assertEq(wld.balanceOf(address(vault)), rewardGift);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.realizedLoss(), 20e6);
        assertEq(vault.unprocessedRewards(), 50 ether);

        uint256 wldOwnerBefore = wld.balanceOf(owner);
        vm.prank(owner);
        factory.withdrawRewardsFromMyVault(owner);
        assertEq(wld.balanceOf(owner) - wldOwnerBefore, 52 ether);
        assertEq(wld.balanceOf(operator), 5 ether);
        assertEq(wld.balanceOf(address(vault)), 0);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(vault.realizedLoss(), 20e6);
    }

    function testUSDCPartialLiquidityAndLiquidityProbeFailureAreSafe() public {
        _deposit(100e6);
        _gain(1_300_000);
        re7.setLiquidity(5e6);
        (,,, uint256 available, bool valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 4_500_000);
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.costBasis(), 100e6);
        assertGe(re7.convertToAssets(vault.accountedShares()), 100e6);

        re7.setBrokenLiquidity(true);
        (,,, available, valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 0);
        vm.prank(owner);
        vm.expectRevert();
        factory.withdrawIncomeFromMyVault(owner, 0);

        re7.setBrokenLiquidity(false);
        re7.setGasFailure(false, true);
        (uint256 gross,,, uint256 noQuoteLiquidity, bool noQuoteValue) = vault.incomePosition();
        assertEq(gross, 0);
        assertEq(noQuoteLiquidity, 0);
        assertFalse(noQuoteValue);
        vm.prank(owner);
        vm.expectRevert();
        factory.withdrawIncomeFromMyVault{gas: 750_000}(owner, 0);
    }

    function testUSDCMinNetAuthExpiryAndRenewal() public {
        _deposit(100e6);
        _gain(1_100_000);
        (,,, uint256 available,) = vault.incomePosition();
        uint256 shares = vault.accountedShares();
        uint256 timer = vault.lastPing();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.SlippageExceeded.selector);
        factory.withdrawIncomeFromMyVault(owner, available + 1);
        assertEq(vault.accountedShares(), shares);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.lastPing(), timer);

        vm.prank(heir);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        vault.ownerWithdrawIncome(owner, 0);
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultUSDCFactory.NoVault.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);

        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.Expired.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        vm.prank(owner);
        factory.pingMyVault();
        uint256 renewedAt = vault.lastPing();
        (,,, available,) = vault.incomePosition();
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.lastPing(), renewedAt);
        assertEq(vault.claimedAt(), 0);
    }

    function testUSDCOneAtomYieldCannotPassProtectedThreshold() public {
        _deposit(1);
        re7.setRate(2_000_000);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 1);
        assertEq(fee, 0);
        assertEq(net, 1);
        assertEq(available, 0);
        assertTrue(valued);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultUSDC.NothingToTransfer.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        assertEq(vault.costBasis(), 1);
        assertEq(vault.accountedShares(), re7.balanceOf(address(vault)));
    }

    function testUSDCIncomeCallbackCannotReenter() public {
        _deposit(100e6);
        _gain(1_100_000);
        (,,, uint256 available,) = vault.incomePosition();
        re7.setCallback(address(factory), abi.encodeCall(factory.executeInheritance, (address(vault))));
        vm.prank(owner);
        factory.withdrawIncomeFromMyVault(owner, available);
        assertFalse(re7.callbackSucceeded());
        assertEq(vault.costBasis(), 100e6);
    }

    function testUSDCIncomeDoesNotConsumeRewardOrMoveCodeStorageSurface() public {
        address deployerAddress = vm.computeCreateAddress(address(factory), 1);
        InheritanceVaultUSDCDeployer deployer = InheritanceVaultUSDCDeployer(deployerAddress);
        address firstPart = vm.computeCreateAddress(deployerAddress, 1);
        address secondPart = vm.computeCreateAddress(deployerAddress, 2);
        bytes memory firstCode = firstPart.code;
        bytes memory secondCode = secondPart.code;
        assertGt(firstCode.length, 1);
        assertGt(secondCode.length, 1);
        assertLe(firstCode.length, 24_576);
        assertLe(secondCode.length, 24_576);
        assertEq(uint8(firstCode[0]), 0);
        assertEq(uint8(secondCode[0]), 0);
        assertLt(address(deployer).code.length, 24_576);

        _deposit(100e6);
        _gain(1_100_000);
        _claim(10 ether);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10e6);
        assertEq(fee, 1e6);
        assertEq(net, 9e6);
        assertTrue(valued);
        uint256 rewardsBefore = wld.balanceOf(address(vault));
        vm.prank(owner);
        factory.withdrawIncomeFromMyVault(owner, available);
        assertEq(wld.balanceOf(address(vault)), rewardsBefore);
        assertEq(vault.unprocessedRewards(), 10 ether);
    }
}

contract OwnerIncomeMorpho is OwnerIncomeEventAssertions {
    MockERC20 internal wld;
    MockERC4626 internal morpho;
    MockMerklDistributor internal distributor;
    InheritanceVaultMorphoFactory internal factory;
    InheritanceVaultMorpho internal vault;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);
    address internal stranger = address(0xBAD);

    function setUp() public {
        vm.warp(1_000_000);
        wld = new MockERC20("Worldcoin", "WLD");
        morpho = new MockERC4626(address(wld));
        factory = new InheritanceVaultMorphoFactory(address(wld), address(morpho), operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultMorpho(payable(factory.createVault(heir, 30 days)));
        MockMerklDistributor implementation = new MockMerklDistributor();
        vm.etch(vault.MERKL_DISTRIBUTOR(), address(implementation).code);
        distributor = MockMerklDistributor(vault.MERKL_DISTRIBUTOR());
        wld.mint(owner, 1000 ether);
        wld.mint(address(distributor), 1000 ether);
    }

    function testWLDIncomeHarvestReturnsNetAndDoesNotTaxAgainOnFullExit() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        uint256 initialShares = vault.accountedShares();
        uint256 timer = vault.lastPing();
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10 ether);
        assertEq(fee, 1 ether);
        assertEq(net, 9 ether);
        assertGt(available, net - 10);
        assertLt(available, net);
        assertTrue(valued);

        uint256 feeBefore = wld.balanceOf(operator);
        vm.recordLogs();
        vm.prank(owner);
        uint256 returned = factory.withdrawIncomeFromMyVault(owner, available);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 disposed, uint256 paidFee, uint256 eventNet) = _incomeEvent(logs, address(vault), owner);
        assertEq(returned, available);
        assertEq(eventNet, returned);
        assertEq(disposed - paidFee, eventNet);
        assertEq(wld.balanceOf(owner), 900 ether + returned);
        assertEq(wld.balanceOf(operator) - feeBefore, paidFee);
        assertLt(vault.accountedShares(), initialShares);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.lastPing(), timer);

        (,,, available, valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 0);
        uint256 feeAfterIncome = wld.balanceOf(operator);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.NothingToTransfer.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 0);
        assertEq(wld.balanceOf(operator), feeAfterIncome);
        assertEq(vault.costBasis(), 0);
    }

    function testWLDCashOnlyHarvestContinuesWhenShareLiquidityProbeFails() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        _externalReward(5 ether);
        wld.mint(address(vault), 100 ether);
        morpho.setBrokenLiquidity(true);
        uint256 sharesBefore = vault.accountedShares();
        uint256 timer = vault.lastPing();
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 15 ether);
        assertEq(fee, 1.5 ether);
        assertEq(net, 13.5 ether);
        assertEq(available, 4.5 ether);
        assertTrue(valued);

        uint256 feeBefore = wld.balanceOf(operator);
        vm.recordLogs();
        vm.prank(owner);
        uint256 returned = factory.withdrawIncomeFromMyVault(operator, available);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 disposed, uint256 paidFee, uint256 eventNet) = _incomeEvent(logs, address(vault), operator);
        assertEq(disposed, 5 ether);
        assertEq(paidFee, 0.5 ether);
        assertEq(eventNet, 4.5 ether);
        assertEq(returned, 4.5 ether);
        assertEq(wld.balanceOf(operator) - feeBefore, 5 ether);
        assertEq(wld.balanceOf(address(vault)), 100 ether);
        assertEq(vault.accountedShares(), sharesBefore);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.realizedLoss(), 0);
        assertEq(vault.lastPing(), timer);
    }

    function testWLDCompoundedRewardsAreManagedIncomeAndDirectGiftsStayExcluded() public {
        _deposit(100 ether);
        _claim(10 ether);
        uint256 trackedBeforeGift = vault.accountedShares();
        wld.mint(address(vault), 50 ether);
        morpho.mint(address(vault), 100 ether);
        _gain(1 ether);
        (uint256 gross, uint256 fee,, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10 ether);
        assertEq(fee, 1 ether);
        assertTrue(valued);
        assertGt(trackedBeforeGift, 100 ether);
        uint256 directCashBefore = wld.balanceOf(address(vault));
        uint256 giftedShares = morpho.balanceOf(address(vault)) - vault.accountedShares();
        vm.prank(owner);
        uint256 returned = factory.withdrawIncomeFromMyVault(owner, available);
        assertEq(returned, available);
        assertEq(wld.balanceOf(address(vault)), directCashBefore);
        assertEq(morpho.balanceOf(address(vault)) - vault.accountedShares(), giftedShares);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testWLDClosedLossReserveIsUnchangedByIncomeHarvest() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, 80 ether);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.realizedLoss(), 20 ether);

        _deposit(100 ether);
        morpho.setRate(1.04 ether);
        (uint256 gross, uint256 fee,, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10 ether);
        assertEq(fee, 1 ether);
        assertTrue(valued);
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.realizedLoss(), 20 ether);
        assertGe(morpho.convertToAssets(vault.accountedShares()), 120 ether);
    }

    function testWLDCashRewardsAboveClosedLossReserveLeaveTheReserveUntouched() public {
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, 80 ether);
        assertEq(vault.realizedLoss(), 20 ether);

        morpho.setRate(1 ether);
        _deposit(100 ether);
        morpho.setRate(0.8 ether);
        _externalReward(50 ether);
        wld.mint(address(vault), 7 ether);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 10 ether);
        assertEq(fee, 1 ether);
        assertEq(net, 9 ether);
        assertEq(available, 9 ether);
        assertTrue(valued);

        uint256 sharesBefore = vault.accountedShares();
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.accountedShares(), sharesBefore);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.realizedLoss(), 20 ether);
        assertEq(vault.unprocessedRewards(), 40 ether);
        assertEq(wld.balanceOf(address(vault)), 47 ether);
        assertGe(morpho.convertToAssets(vault.accountedShares()) + vault.unprocessedRewards(), 120 ether);
    }

    function testWLDPartialLiquidityAndQuoteGasFailureAreFailClosed() public {
        _deposit(100 ether);
        _gain(1.3 ether);
        _externalReward(5 ether);
        morpho.setLiquidity(3 ether);
        (,,, uint256 available, bool valued) = vault.incomePosition();
        assertTrue(valued);
        assertEq(available, 7.2 ether - 1);
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.costBasis(), 100 ether);
        assertGe(morpho.convertToAssets(vault.accountedShares()), 100 ether);

        morpho.setGasFailure(false, true);
        (uint256 gross,,, uint256 noQuoteLiquidity, bool noQuoteValue) = vault.incomePosition();
        assertEq(gross, 0);
        assertEq(noQuoteLiquidity, 0);
        assertFalse(noQuoteValue);
        vm.prank(owner);
        vm.expectRevert();
        factory.withdrawIncomeFromMyVault{gas: 750_000}(owner, 0);
    }

    function testWLDMinNetAuthorizationExpiryAndRenewal() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        (,,, uint256 available,) = vault.incomePosition();
        uint256 shares = vault.accountedShares();
        uint256 timer = vault.lastPing();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.SlippageExceeded.selector);
        factory.withdrawIncomeFromMyVault(owner, available + 1);
        assertEq(vault.accountedShares(), shares);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.lastPing(), timer);

        vm.prank(heir);
        vm.expectRevert(InheritanceVaultMorpho.NotOwner.selector);
        vault.ownerWithdrawIncome(owner, 0);
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultMorphoFactory.NoVault.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);

        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.Expired.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        vm.prank(owner);
        factory.pingMyVault();
        uint256 renewedAt = vault.lastPing();
        (,,, available,) = vault.incomePosition();
        vm.prank(owner);
        assertEq(factory.withdrawIncomeFromMyVault(owner, available), available);
        assertEq(vault.lastPing(), renewedAt);
        assertEq(vault.claimedAt(), 0);
    }

    function testWLDOneAtomYieldCannotBeWithdrawnAsIncome() public {
        _deposit(1);
        morpho.setRate(2 ether);
        (uint256 gross, uint256 fee, uint256 net, uint256 available, bool valued) = vault.incomePosition();
        assertEq(gross, 1);
        assertEq(fee, 0);
        assertEq(net, 1);
        assertEq(available, 0);
        assertTrue(valued);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultMorpho.NothingToTransfer.selector);
        factory.withdrawIncomeFromMyVault(owner, 0);
        assertEq(vault.costBasis(), 1);
        assertEq(vault.accountedShares(), morpho.balanceOf(address(vault)));
    }

    function testWLDCreationCodePartsAreInertAndDeployerOnlyCreatesThroughFactory() public {
        address deployerAddress = vm.computeCreateAddress(address(factory), 1);
        InheritanceVaultMorphoDeployer deployer = InheritanceVaultMorphoDeployer(deployerAddress);
        address firstPart = vm.computeCreateAddress(deployerAddress, 1);
        address secondPart = vm.computeCreateAddress(deployerAddress, 2);
        bytes memory firstCode = firstPart.code;
        bytes memory secondCode = secondPart.code;
        assertGt(firstCode.length, 1);
        assertGt(secondCode.length, 1);
        assertLe(firstCode.length, 24_576);
        assertLe(secondCode.length, 24_576);
        assertEq(uint8(firstCode[0]), 0);
        assertEq(uint8(secondCode[0]), 0);
        assertLt(address(deployer).code.length, 24_576);
        vm.expectRevert(InheritanceVaultMorphoDeployer.NotFactory.selector);
        deployer.createVault(stranger, heir, 30 days);
        vm.prank(stranger);
        address child = factory.createVault(heir, 30 days);
        assertEq(InheritanceVaultMorpho(payable(child)).owner(), stranger);
        assertEq(InheritanceVaultMorpho(payable(child)).factory(), address(factory));
    }

    function testWLDIncomeCallbackCannotReenter() public {
        _deposit(100 ether);
        _gain(1.1 ether);
        (,,, uint256 available,) = vault.incomePosition();
        morpho.setCallback(address(factory), abi.encodeCall(factory.executeInheritance, (address(vault))));
        vm.prank(owner);
        factory.withdrawIncomeFromMyVault(owner, available);
        assertFalse(morpho.callbackSucceeded());
        assertEq(vault.costBasis(), 100 ether);
    }

    function _deposit(uint256 amount) private {
        vm.startPrank(owner);
        wld.approve(address(factory), amount);
        factory.depositWithMinShares(amount, morpho.previewDeposit(amount));
        vm.stopPrank();
    }

    function _gain(uint256 rate) private {
        morpho.setRate(rate);
        wld.mint(address(morpho), 1000 ether);
    }

    function _claim(uint256 cumulative) private {
        bytes32[] memory proof = _setRewardRoot(cumulative);
        factory.claimRewardsFor(address(vault), cumulative, proof, 0);
    }

    function _externalReward(uint256 cumulative) private {
        bytes32[] memory proof = _setRewardRoot(cumulative);
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
    }

    function _setRewardRoot(uint256 cumulative) private returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = keccak256("OwnerIncome Morpho reward fixture");
        bytes32 leaf = keccak256(abi.encode(address(vault), address(wld), cumulative));
        distributor.setRoot(
            leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf))
        );
    }
}
