// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "../contracts/interfaces/IERC4626Minimal.sol";

interface IRemediationForkMerkl {
    function getMerkleRoot() external view returns (bytes32);
}

/// @notice Local fork only: actual token/strategy/distributor code; injected funds,
/// reward roots and failure mocks do not establish actual campaign eligibility.
abstract contract RemediationForkBase is Test {
    address constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address constant RE7_USDC = 0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B;
    address constant RE7_WLD = 0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);

    function _inject(address distributor, address child, uint256 cumulative)
        internal
        returns (bytes32[] memory proof)
    {
        deal(WLD, distributor, IERC20(WLD).balanceOf(distributor) + cumulative);
        bytes32 oldRoot = IRemediationForkMerkl(distributor).getMerkleRoot();
        assertTrue(oldRoot != bytes32(0));
        proof = new bytes32[](1);
        proof[0] = keccak256("remediation fork local fixture only");
        bytes32 leaf = keccak256(abi.encode(child, WLD, cumulative));
        bytes32 root = leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf));
        bool replaced;
        for (uint256 i; i < 256; ++i) {
            if (vm.load(distributor, bytes32(i)) == oldRoot) {
                vm.store(distributor, bytes32(i), root);
                replaced = true;
            }
        }
        assertTrue(replaced);
        assertEq(IRemediationForkMerkl(distributor).getMerkleRoot(), root);
    }

    function _coolRecordedDependencies() internal {
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        for (uint256 i; i < accesses.length; ++i) {
            vm.cool(accesses[i].account);
        }
    }

    function _cold(address gateway, address child, address receipt, address distributor) internal {
        vm.cool(gateway);
        vm.cool(child);
        vm.cool(receipt);
        vm.cool(WLD);
        vm.cool(USDC);
        vm.cool(distributor);
    }
}

contract USDCSecurityRemediationForkTest is RemediationForkBase {
    InheritanceVaultUSDCFactory internal factory;
    InheritanceVaultUSDC internal vault;

    function setUp() public {
        string memory rpc = vm.envOr("USDC_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, vm.envOr("USDC_FORK_BLOCK", uint256(35_799_795)));
        assertEq(block.chainid, 480);
        factory = new InheritanceVaultUSDCFactory(USDC, RE7_USDC, WLD, operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultUSDC(payable(factory.createVault(heir, 30 days)));
        deal(USDC, owner, 100e6);
        vm.startPrank(owner);
        IERC20(USDC).approve(address(factory), 100e6);
        factory.depositWithMinShares(100e6, IERC4626Minimal(RE7_USDC).previewDeposit(100e6) * 9950 / 10_000);
        vm.stopPrank();
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
    }

    function testRealColdPositiveYieldRejectedFeeRollsBackToExactReceiptPayout() public {
        vm.startStateDiffRecording();
        uint256 shares = IERC20(RE7_USDC).balanceOf(address(vault));
        uint256 gross = IERC4626Minimal(RE7_USDC).convertToAssets(shares);
        assertGt(gross, vault.costBasis(), "fixture must have real accrued positive yield");
        uint256 fee = (gross - vault.costBasis()) * 1000 / 10_000;
        assertGt(fee, 0);
        uint256 feeShares = shares * fee / gross;
        uint256 backingBefore = IERC20(USDC).balanceOf(RE7_USDC);
        uint256 totalSharesBefore = IERC20Supply(RE7_USDC).totalSupply();
        vm.mockCallRevert(
            USDC, abi.encodeWithSelector(IERC20.transfer.selector, operator), bytes("local recipient blacklist")
        );
        _coolRecordedDependencies();
        _cold(address(factory), address(vault), RE7_USDC, vault.MERKL_DISTRIBUTOR());
        factory.executeInheritance(address(vault));
        assertEq(IERC20(RE7_USDC).balanceOf(heir), shares - feeShares);
        assertEq(IERC20(RE7_USDC).balanceOf(operator), feeShares);
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
        assertEq(IERC20Supply(RE7_USDC).totalSupply(), totalSharesBefore, "failed redeem must not burn receipt supply");
        assertEq(IERC20(USDC).balanceOf(RE7_USDC), backingBefore);
        assertEq(IERC20(USDC).balanceOf(heir), 0);
        assertEq(IERC20(USDC).balanceOf(operator), 0);
        assertEq(vault.costBasis(), 0);
        assertEq(vault.accountedShares(), 0);
        assertEq(vault.inheritanceRecipient(), heir);
    }

    function testRealColdPositiveYieldNormalCashStillSucceeds() public {
        vm.startStateDiffRecording();
        uint256 shares = IERC20(RE7_USDC).balanceOf(address(vault));
        uint256 gross = IERC4626Minimal(RE7_USDC).previewRedeem(shares);
        assertGt(gross, vault.costBasis());
        uint256 fee = (gross - vault.costBasis()) * 1000 / 10_000;
        _coolRecordedDependencies();
        _cold(address(factory), address(vault), RE7_USDC, vault.MERKL_DISTRIBUTOR());
        factory.executeInheritance(address(vault));
        assertEq(IERC20(USDC).balanceOf(heir), gross - fee);
        assertEq(IERC20(USDC).balanceOf(operator), fee);
        assertEq(IERC20(RE7_USDC).balanceOf(heir), 0, "gas cap must not force ordinary cash into shares");
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
    }

    function testRealMerklOutagePreservesIdleAndRecoversLateCanonicalWithGifts() public {
        deal(WLD, address(vault), 10 ether);
        vm.mockCallRevert(
            vault.MERKL_DISTRIBUTOR(),
            abi.encodeWithSignature("claimed(address,address)"),
            bytes("local Merkl getter outage")
        );
        _cold(address(factory), address(vault), RE7_USDC, vault.MERKL_DISTRIBUTOR());
        factory.executeInheritance(address(vault));
        assertGt(IERC20(USDC).balanceOf(heir), 99e6);
        assertEq(IERC20(WLD).balanceOf(address(vault)), 10 ether);
        assertTrue(vault.rewardsDeferred());
        vm.clearMockedCalls();
        bytes32[] memory proof = _inject(vault.MERKL_DISTRIBUTOR(), address(vault), 5 ether);
        // Intervening gifts join the deferred beneficiary epoch.
        deal(WLD, address(vault), 13 ether);
        factory.claimRewardsFor(address(vault), 5 ether, proof, 0);
        assertEq(IERC20(WLD).balanceOf(heir), 17.5 ether);
        assertEq(IERC20(WLD).balanceOf(operator), 0.5 ether);
        assertEq(vault.unprocessedRewards(), 0);
        assertFalse(vault.rewardsDeferred());
        assertEq(IERC20(WLD).balanceOf(address(vault)), 0);
    }
}

interface IERC20Supply {
    function totalSupply() external view returns (uint256);
}

contract WLDSecurityRemediationForkTest is RemediationForkBase {
    InheritanceVaultMorphoFactory internal factory;
    InheritanceVaultMorpho internal vault;

    function setUp() public {
        string memory rpc = vm.envOr("MORPHO_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, vm.envOr("MORPHO_FORK_BLOCK", uint256(35_787_339)));
        assertEq(block.chainid, 480);
        factory = new InheritanceVaultMorphoFactory(WLD, RE7_WLD, operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultMorpho(payable(factory.createVault(heir, 30 days)));
        deal(WLD, owner, 100 ether);
        vm.startPrank(owner);
        IERC20(WLD).approve(address(factory), 100 ether);
        factory.depositWithMinShares(100 ether, IERC4626Minimal(RE7_WLD).previewDeposit(100 ether) * 9950 / 10_000);
        vm.stopPrank();
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
    }

    function testRealWLDMerklOutageExitsPrincipalThenReconcilesLateRewards() public {
        deal(WLD, address(vault), 10 ether);
        vm.mockCallRevert(
            vault.MERKL_DISTRIBUTOR(),
            abi.encodeWithSignature("claimed(address,address)"),
            bytes("local Merkl getter outage")
        );
        _cold(address(factory), address(vault), RE7_WLD, vault.MERKL_DISTRIBUTOR());
        factory.executeInheritance(address(vault));
        uint256 principalPayout = IERC20(WLD).balanceOf(heir);
        uint256 strategyFee = IERC20(WLD).balanceOf(operator);
        assertGt(principalPayout, 99 ether);
        assertEq(IERC20(WLD).balanceOf(address(vault)), 10 ether);
        assertTrue(vault.rewardsDeferred());
        vm.clearMockedCalls();
        bytes32[] memory proof = _inject(vault.MERKL_DISTRIBUTOR(), address(vault), 5 ether);
        deal(WLD, address(vault), 13 ether);
        factory.claimRewardsFor(address(vault), 5 ether, proof, 0);
        assertEq(IERC20(WLD).balanceOf(heir), principalPayout + 17.5 ether);
        assertEq(IERC20(WLD).balanceOf(operator), strategyFee + 0.5 ether);
        assertEq(vault.unprocessedRewards(), 0);
        assertFalse(vault.rewardsDeferred());
    }
}
