// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultUSDCBase} from "./InheritanceVaultUSDCBase.t.sol";
import {MorphoRewardsTest} from "./MorphoRewards.t.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";

/// @dev Same storage layout as MockERC20, but a rejected fee mutates before returning false.
/// Etching this code into the funded fixture proves the nested revert unwinds token effects.
contract MutatingFalseFeeToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return to != address(0xFEE);
    }
}

/// @notice Independent regressions for failure isolation and deferred-beneficiary accounting.
contract USDCSecurityRemediationTest is InheritanceVaultUSDCBase {
    event DeferredRewardsSettled(address indexed recipient, uint256 grossAssets);
    event RewardsClaimed(uint256 amount, uint256 shares, address indexed recipient);

    function _outage() internal {
        vm.mockCallRevert(
            vault.MERKL_DISTRIBUTOR(),
            abi.encodeWithSignature("claimed(address,address)", address(vault), address(wld)),
            bytes("getter outage")
        );
    }

    function testUSDCPrincipalQuoteExcludesRewardsAndGiftShareGainFeesDuringOutage() public {
        _deposit(100e6);
        _externalReward(5 ether);
        wld.mint(address(vault), 10 ether);
        usdc.mint(address(vault), 7e6);
        re7.mint(address(vault), 20 ether);
        _gain(1.2e6);
        _outage();
        (uint256 shares, uint256 gross, uint256 net, uint256 fee, bool valued) = vault.principalPosition();
        assertEq(shares, 120 ether);
        assertEq(gross, 151e6);
        assertEq(fee, 2e6);
        assertEq(net, 149e6);
        assertTrue(valued);
        re7.setRate(0.8e6);
        (, gross, net, fee, valued) = vault.principalPosition();
        assertEq(gross, 103e6);
        assertEq(net, 103e6);
        assertEq(fee, 0);
        assertTrue(valued);
        re7.setBrokenQuote(true);
        (, gross, net, fee, valued) = vault.principalPosition();
        assertEq(gross, 7e6);
        assertEq(net, 7e6);
        assertEq(fee, 0);
        assertFalse(valued);
    }

    function testUSDCGiftOnlyDeferredRecoveryDoesNotReportCanonicalRewards() public {
        wld.mint(address(vault), 10 ether);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        vm.clearMockedCalls();
        vm.expectEmit(true, false, false, true, address(vault));
        emit DeferredRewardsSettled(heir, 10 ether);
        vm.expectEmit(true, false, false, true, address(vault));
        emit RewardsClaimed(0, 0, heir);
        assertEq(factory.processRewardsFor(address(vault), 0), 10 ether);
        assertEq(wld.balanceOf(heir), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertFalse(vault.rewardsDeferred());
    }

    function testMalformedGetterDoesNotBlockUSDCInheritance() public {
        _deposit(100e6);
        _eligible();
        vm.mockCall(vault.MERKL_DISTRIBUTOR(), abi.encodeWithSignature("claimed(address,address)"), hex"01");
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
    }

    function testGasExhaustingGetterDoesNotBlockUSDCInheritance() public {
        _deposit(100e6);
        _eligible();
        vm.etch(vault.MERKL_DISTRIBUTOR(), hex"5b600056");
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
    }

    function testAtomicCashHelperRejectsEveryExternalCaller() public {
        _deposit(100e6);
        address[4] memory callers = [owner, heir, address(factory), stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
            vm.prank(callers[i]);
            vault.redeemInheritance(100 ether, 0);
        }
        assertEq(re7.balanceOf(address(vault)), 100 ether);
    }

    function testStrategyCallbackCannotReenterAtomicCashHelper() public {
        _deposit(100e6);
        _gain(1.2e6);
        re7.setCallback(address(vault), abi.encodeCall(vault.redeemInheritance, (100 ether, 0)));
        _eligible();
        factory.executeInheritance(address(vault));
        assertFalse(re7.callbackSucceeded());
        assertEq(usdc.balanceOf(heir), 118e6);
        assertEq(usdc.balanceOf(operator), 2e6);
        assertEq(re7.balanceOf(address(vault)), 0);
    }

    function testOutageWithGiftsAndLateCanonicalRewardsPreservesFixedHeir() public {
        _deposit(100e6);
        wld.mint(address(vault), 10 ether);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
        assertEq(vault.inheritanceRecipient(), heir);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        // Owner attempts cannot appropriate the unknown balance during the outage.
        vm.prank(owner);
        (bool sweepSucceeded,) =
            address(vault).call(abi.encodeWithSignature("ownerSweepAfterSettlement(address)", owner));
        if (sweepSucceeded) assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(wld.balanceOf(owner), 0);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        vm.clearMockedCalls();
        _externalReward(5 ether);
        wld.mint(address(vault), 3 ether);
        factory.processRewardsFor(address(vault), 0);
        assertEq(wld.balanceOf(heir), 17.5 ether);
        assertEq(wld.balanceOf(operator), 0.5 ether);
        assertEq(wld.balanceOf(address(vault)), 0);
        assertEq(vault.unprocessedRewards(), 0);
        factory.processRewardsFor(address(vault), 0);
        assertEq(wld.balanceOf(heir), 17.5 ether);
        wld.mint(address(vault), 2 ether);
        vm.prank(owner);
        vault.ownerSweepAfterSettlement(owner);
        assertEq(wld.balanceOf(owner), 2 ether);
        assertEq(wld.balanceOf(heir), 17.5 ether);
    }

    function testEmptyRewardBalanceDoesNotRequireAnotherPaidSettlement() public {
        _deposit(100e6);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(heir), 100e6);
        assertFalse(vault.rewardsDeferred());
    }

    function testOutageDoesNotRequireAnyRewardHistoryToExitUSDC() public {
        _deposit(100e6);
        _outage();
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 100e6);
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(re7.balanceOf(address(vault)), 0);
    }

    function testRejectedCashFeeRollsBackRedemptionAndPaysReceiptFee() public {
        _deposit(100e6);
        _gain(1.2e6);
        _eligible();
        uint256 backingBefore = usdc.balanceOf(address(re7));
        vm.mockCallRevert(address(usdc), abi.encodeCall(IERC20.transfer, (operator, 2e6)), bytes("recipient blocked"));
        factory.executeInheritance(address(vault));
        uint256 feeShares = uint256(100 ether) * 2e6 / 120e6;
        assertEq(re7.balanceOf(operator), feeShares);
        assertEq(re7.balanceOf(heir), 100 ether - feeShares);
        assertEq(re7.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(re7)), backingBefore);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(heir), 0);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.inheritanceRecipient(), heir);
        assertGt(vault.claimedAt(), 0);
    }

    function testFeeTokenMutationBeforeFalseIsRevertedWithRedemption() public {
        _deposit(100e6);
        _gain(1.2e6);
        _eligible();
        uint256 backingBefore = usdc.balanceOf(address(re7));
        MutatingFalseFeeToken code = new MutatingFalseFeeToken();
        vm.etch(address(usdc), address(code).code);
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(address(re7)), backingBefore);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(re7.balanceOf(operator) + re7.balanceOf(heir), 100 ether);
        assertEq(vault.accountedShares(), 0);
    }

    function testFalseCashFeeReturnAlsoRollsBackBeforeSharePayout() public {
        _deposit(100e6);
        _gain(1.2e6);
        _eligible();
        uint256 backingBefore = usdc.balanceOf(address(re7));
        vm.mockCall(address(usdc), abi.encodeCall(IERC20.transfer, (operator, 2e6)), abi.encode(false));
        factory.executeInheritance(address(vault));
        assertEq(usdc.balanceOf(address(re7)), backingBefore);
        assertEq(re7.balanceOf(operator) + re7.balanceOf(heir), 100 ether);
        assertEq(vault.accountedShares(), 0);
    }
}

contract WLDSecurityRemediationTest is MorphoRewardsTest {
    event DeferredRewardsSettled(address indexed recipient, uint256 grossAssets);
    event RewardsClaimed(uint256 amount, uint256 shares, address indexed recipient);

    function _outage() internal {
        vm.mockCallRevert(
            vault.MERKL_DISTRIBUTOR(),
            abi.encodeWithSignature("claimed(address,address)", address(vault), address(wld)),
            bytes("getter outage")
        );
    }

    function testWLDPrincipalQuoteExcludesIdleAndGiftShareGainFeesDuringOutage() public {
        _deposit(100 ether);
        _externalReward(5 ether);
        wld.mint(address(vault), 10 ether);
        morpho.mint(address(vault), 20 ether);
        _gain(1.2 ether);
        _outage();
        (uint256 shares, uint256 gross, uint256 net, uint256 fee, bool valued) = vault.principalPosition();
        assertEq(shares, 120 ether);
        assertEq(gross, 144 ether);
        assertEq(fee, 2 ether);
        assertEq(net, 142 ether);
        assertTrue(valued);
        morpho.setRate(0.8 ether);
        (, gross, net, fee, valued) = vault.principalPosition();
        assertEq(gross, 96 ether);
        assertEq(net, 96 ether);
        assertEq(fee, 0);
        assertTrue(valued);
        morpho.setBrokenQuote(true);
        (, gross, net, fee, valued) = vault.principalPosition();
        assertEq(gross, 0);
        assertEq(net, 0);
        assertEq(fee, 0);
        assertFalse(valued);
    }

    function testWLDGiftOnlyDeferredRecoveryDoesNotReportCanonicalRewards() public {
        wld.mint(address(vault), 10 ether);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        vm.clearMockedCalls();
        vm.expectEmit(true, false, false, true, address(vault));
        emit DeferredRewardsSettled(heir, 10 ether);
        vm.expectEmit(true, false, false, true, address(vault));
        emit RewardsClaimed(0, 0, heir);
        assertEq(factory.processRewardsFor(address(vault), 0), 10 ether);
        assertEq(wld.balanceOf(heir), 10 ether);
        assertEq(wld.balanceOf(operator), 0);
        assertFalse(vault.rewardsDeferred());
    }

    function testOversizedUint208GetterDoesNotBlockWLDInheritance() public {
        _deposit(100 ether);
        _eligible();
        vm.mockCall(
            vault.MERKL_DISTRIBUTOR(),
            abi.encodeWithSignature("claimed(address,address)"),
            abi.encode(type(uint256).max)
        );
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
    }

    function testGasExhaustingGetterDoesNotBlockWLDInheritance() public {
        _deposit(100 ether);
        _eligible();
        vm.etch(vault.MERKL_DISTRIBUTOR(), hex"5b600056");
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
    }

    function testOutageDefersMixedIdleButReleasesPrincipalAndLateRewards() public {
        _deposit(100 ether);
        _externalReward(4 ether);
        wld.mint(address(vault), 6 ether);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(vault.inheritanceRecipient(), heir);
        vm.clearMockedCalls();
        _externalReward(9 ether);
        wld.mint(address(vault), 3 ether);
        factory.processRewardsFor(address(vault), 0);
        assertEq(wld.balanceOf(heir), 117.1 ether);
        assertEq(wld.balanceOf(operator), 0.9 ether);
        assertEq(wld.balanceOf(address(vault)), 0);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testEmptyRewardBalanceDoesNotRequireAnotherPaidSettlement() public {
        _deposit(100 ether);
        _eligible();
        _outage();
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
        assertFalse(vault.rewardsDeferred());
    }

    function testOutageFullOwnerExitLeavesUnknownIdleIntact() public {
        _deposit(100 ether);
        _externalReward(4 ether);
        wld.mint(address(vault), 6 ether);
        _outage();
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 100 ether);
        assertEq(wld.balanceOf(owner), 1000 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(morpho.balanceOf(address(vault)), 0);
        vm.clearMockedCalls();
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 9.6 ether);
        assertEq(wld.balanceOf(owner), 1009.6 ether);
        assertEq(wld.balanceOf(operator), 0.4 ether);
    }

    function testOutagePartialOwnerExitUsesSharesInsteadOfUnknownIdle() public {
        _deposit(100 ether);
        _externalReward(4 ether);
        wld.mint(address(vault), 6 ether);
        _outage();
        _withdraw(20 ether);
        assertEq(wld.balanceOf(address(vault)), 10 ether);
        assertEq(morpho.balanceOf(address(vault)), 80 ether);
        assertEq(wld.balanceOf(owner), 920 ether);
    }
}
