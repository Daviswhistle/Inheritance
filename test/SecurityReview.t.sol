// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IMerklDistributor} from "../contracts/interfaces/IMerklDistributor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";
import {MockUSDC, MockRe7USDC} from "./mocks/MockRe7USDC.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";
import {InheritanceVaultTokens} from "../contracts/InheritanceVaultTokens.sol";
import {InheritanceVaultTokensFactoryOnePerOwner} from "../contracts/InheritanceVaultTokensFactoryOnePerOwner.sol";

contract ReviewForceETH {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

/// @notice Characterization proofs for the November 3 security review.
/// Passing tests demonstrate the reported failure conditions, not their remediation.
contract SecurityReviewTest is Test {
    address internal constant OWNER = address(0xA11CE);
    address internal constant HEIR = address(0xB0B);
    address internal constant FEE = address(0xFEE);
    address internal constant DISTRIBUTOR = 0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae;

    MockERC20 internal wld;
    MockERC4626 internal morpho;
    MockUSDC internal usdc;
    MockRe7USDC internal re7;
    InheritanceVaultMorphoFactory internal wldFactory;
    InheritanceVaultUSDCFactory internal usdcFactory;
    InheritanceVaultMorpho internal wldVault;
    InheritanceVaultUSDC internal usdcVault;

    function setUp() public {
        vm.warp(1_000_000);
        wld = new MockERC20("Worldcoin", "WLD");
        morpho = new MockERC4626(address(wld));
        usdc = new MockUSDC();
        re7 = new MockRe7USDC(address(usdc));
        vm.etch(DISTRIBUTOR, address(new MockMerklDistributor()).code);
        wldFactory = new InheritanceVaultMorphoFactory(address(wld), address(morpho), FEE, 1000);
        usdcFactory = new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(wld), FEE, 1000);
        wld.mint(OWNER, 100 ether);
        usdc.mint(OWNER, 100e6);
        vm.startPrank(OWNER);
        wldVault = InheritanceVaultMorpho(payable(wldFactory.createVault(HEIR, 30 days)));
        usdcVault = InheritanceVaultUSDC(payable(usdcFactory.createVault(HEIR, 30 days)));
        wld.approve(address(wldFactory), 100 ether);
        usdc.approve(address(usdcFactory), 100e6);
        wldFactory.depositWithMinShares(100 ether, 100 ether);
        usdcFactory.depositWithMinShares(100e6, 100 ether);
        vm.stopPrank();
    }

    function _breakRewardView() internal returns (bytes memory reason) {
        reason = abi.encodeWithSignature("Error(string)", "reward view unavailable");
        vm.mockCallRevert(DISTRIBUTOR, abi.encodeWithSelector(IMerklDistributor.claimed.selector), reason);
    }

    function _matureClaims() internal {
        vm.warp(wldVault.deadline());
        vm.startPrank(HEIR);
        wldFactory.fileClaimFor(address(wldVault));
        usdcFactory.fileClaimFor(address(usdcVault));
        vm.stopPrank();
        vm.warp(wldVault.challengeEndsAt());
    }

    function testWLDPrincipalCashExitsDependOnMerklWithoutAnyRewards() public {
        bytes memory reason = _breakRewardView();
        vm.startPrank(OWNER);
        vm.expectRevert(reason);
        wldFactory.withdrawFromMyVault(OWNER, 100 ether);
        vm.expectRevert(reason);
        wldFactory.withdrawAllFromMyVault(OWNER, 100 ether);
        assertEq(wld.balanceOf(OWNER), 0);
        assertEq(wldVault.costBasis(), 100 ether);
        // Only the living owner can choose this independent escape route.
        wldFactory.withdrawSharesFromMyVault(OWNER, 100 ether);
        vm.stopPrank();
        assertEq(morpho.balanceOf(OWNER), 100 ether);
    }

    function testUSDCFullPrincipalExitDependsOnMerklButPartialExitDoesNot() public {
        bytes memory reason = _breakRewardView();
        vm.startPrank(OWNER);
        vm.expectRevert(reason);
        usdcFactory.withdrawAllFromMyVault(OWNER, 100e6);
        assertEq(usdcVault.costBasis(), 100e6);
        usdcFactory.withdrawFromMyVault(OWNER, 100e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(OWNER), 100e6);
        assertEq(usdcVault.costBasis(), 0);
    }

    function testBothInheritancesDependOnMerklWithoutAnyRewards() public {
        _matureClaims();
        bytes memory reason = _breakRewardView();
        vm.expectRevert(reason);
        wldFactory.executeInheritance(address(wldVault));
        vm.expectRevert(reason);
        usdcFactory.executeInheritance(address(usdcVault));
        assertEq(wldVault.claimedAt(), 0);
        assertEq(usdcVault.claimedAt(), 0);
        assertEq(morpho.balanceOf(address(wldVault)), 100 ether);
        assertEq(re7.balanceOf(address(usdcVault)), 100 ether);
        assertEq(morpho.balanceOf(HEIR), 0);
        assertEq(re7.balanceOf(HEIR), 0);
    }

    function testRejectedFeeTransferBlocksInheritanceWithoutShareFallback() public {
        re7.setRate(1_200_000);
        usdc.mint(address(re7), 20e6);
        _matureClaims();
        bytes memory reason = abi.encodeWithSignature("Error(string)", "fee recipient blocked");
        vm.mockCallRevert(address(usdc), abi.encodeCall(IERC20.transfer, (FEE, 2e6)), reason);
        vm.expectRevert(reason);
        usdcFactory.executeInheritance(address(usdcVault));
        assertEq(usdcVault.claimedAt(), 0);
        assertEq(usdc.balanceOf(HEIR), 0);
        assertEq(re7.balanceOf(HEIR), 0);
        assertEq(re7.balanceOf(address(usdcVault)), 100 ether);
        // The successful strategy redeem and its share burn rolled back.
        assertEq(usdc.balanceOf(address(re7)), 120e6);
        // The heir cannot request the owner's receipt-share escape route.
        vm.prank(HEIR);
        vm.expectRevert(InheritanceVaultUSDC.NotOwner.selector);
        usdcVault.ownerWithdrawShares(100 ether, HEIR);
        // An available owner can still renew and withdraw transferable shares.
        vm.startPrank(OWNER);
        usdcFactory.pingMyVault();
        usdcFactory.withdrawSharesFromMyVault(OWNER, 100 ether);
        vm.stopPrank();
        assertGt(re7.balanceOf(OWNER), 0);
        assertGt(re7.balanceOf(FEE), 0);
    }
}

/// @notice This prototype is outside the configured production/UI routes.
contract SecurityReviewPrototypeTest is Test {
    function testForcedETHPermanentlyPreventsPrototypeSlotRelease() public {
        vm.warp(1_000_000);
        address owner = address(0xA11CE);
        MockERC20 token = new MockERC20("Token", "TKN");
        InheritanceVaultTokensFactoryOnePerOwner factory = new InheritanceVaultTokensFactoryOnePerOwner();
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(owner);
        address vault = factory.createVault(address(0xB0B), tokens, 1 days);
        // No owner approval is needed to force ETH into a rejecting receiver.
        vm.deal(address(this), 1);
        new ReviewForceETH{value: 1}(payable(vault));
        assertEq(vault.balance, 1);
        vm.warp(InheritanceVaultTokens(payable(vault)).deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();
        assertEq(factory.vaultOf(owner), vault);
        vm.prank(owner);
        (bool sweepExists,) = vault.call(abi.encodeWithSignature("sweepEth(address)", owner));
        assertFalse(sweepExists);
        assertEq(vault.balance, 1);
    }
}
