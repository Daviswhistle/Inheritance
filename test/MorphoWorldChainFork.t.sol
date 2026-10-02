// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultMorpho} from "../contracts/InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "../contracts/interfaces/IERC4626Minimal.sol";

interface IMerklRoot {
    function getMerkleRoot() external view returns (bytes32);
    function toggleOperator(address user, address operator) external;
    function claim(
        address[] calldata users,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external;
}

/// @notice Genuine World Chain bytecode/state on a local fork. Opt-in RPC only;
/// no signature, funded wallet, broadcast, or real deposit is used.
contract MorphoWorldChainForkTest is Test {
    address constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address constant MORPHO_VAULT = 0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);
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
        assertEq(IERC4626Minimal(MORPHO_VAULT).asset(), WLD);
        factory = new InheritanceVaultMorphoFactory(WLD, MORPHO_VAULT, operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultMorpho(payable(factory.createVault(heir, 30 days)));
        deal(WLD, owner, 100 ether);
        vm.startPrank(owner);
        IERC20(WLD).approve(address(factory), 100 ether);
        uint256 quote = IERC4626Minimal(MORPHO_VAULT).previewDeposit(100 ether);
        factory.depositWithMinShares(100 ether, quote * 9950 / 10_000);
        vm.stopPrank();
    }

    function testRealMorphoDepositAndFullOwnerRedemption() public {
        assertGt(IERC20(MORPHO_VAULT).balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 100 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 99 ether);
        assertEq(IERC20(MORPHO_VAULT).balanceOf(address(vault)), 0);
        assertGe(IERC20(WLD).balanceOf(owner), 99 ether);
        assertLe(IERC20(WLD).balanceOf(operator), 1 ether);
    }

    function testRealMorphoCashInheritanceAfterReview() public {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        uint256 gasBefore = gasleft();
        factory.executeInheritance(address(vault));
        emit log_named_uint("cash inheritance gas (local fork)", gasBefore - gasleft());
        assertGt(vault.claimedAt(), 0);
        assertEq(IERC20(MORPHO_VAULT).balanceOf(address(vault)), 0);
        assertGe(IERC20(WLD).balanceOf(heir), 99 ether);
    }

    function testRealReceiptTransferAndWalletRedemption() public {
        uint256 shares = IERC20(MORPHO_VAULT).balanceOf(address(vault));
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, shares);
        shares = IERC20(MORPHO_VAULT).balanceOf(owner);
        vm.startPrank(owner);
        IERC20(MORPHO_VAULT).approve(address(factory), shares);
        factory.redeemWalletShares(shares, 99 ether);
        vm.stopPrank();
        assertEq(IERC20(MORPHO_VAULT).balanceOf(owner), 0);
        assertGe(IERC20(WLD).balanceOf(owner), 99 ether);
    }

    /// The canonical distributor and WLD/Morpho bytecode are real. Only its
    /// reward root is injected locally; this does not prove earning eligibility.
    function testRealDistributorAndMorphoWithInjectedRewardRoot() public {
        address distributor = vault.MERKL_DISTRIBUTOR();
        assertGt(distributor.code.length, 0);
        assertGe(IERC20(WLD).balanceOf(distributor), 10 ether);
        bytes32 oldRoot = IMerklRoot(distributor).getMerkleRoot();
        assertTrue(oldRoot != bytes32(0));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("local fork reward fixture");
        bytes32 leaf = keccak256(abi.encode(address(vault), WLD, uint256(10 ether)));
        bytes32 root = leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf));
        bool replaced;
        for (uint256 i; i < 256; ++i) {
            if (vm.load(distributor, bytes32(i)) == oldRoot) {
                vm.store(distributor, bytes32(i), root);
                replaced = true;
            }
        }
        assertTrue(replaced, "active root storage must be found");
        assertEq(IMerklRoot(distributor).getMerkleRoot(), root);
        uint256 ping = vault.lastPing();
        uint256 gasBefore = gasleft();
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        emit log_named_uint("canonical reward claim and compounding gas (injected local root)", gasBefore - gasleft());
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(vault.costBasis(), 100 ether);
        assertEq(vault.lastPing(), ping);
        assertEq(IERC20(WLD).balanceOf(address(vault)), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 108 ether);
        assertGe(IERC20(WLD).balanceOf(owner), 108 ether);
        assertApproxEqAbs(IERC20(WLD).balanceOf(operator), 1 ether, 1e12);
    }

    function testSimulatedRedemptionFailureTransfersRealReceiptToken() public {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        vm.mockCallRevert(
            MORPHO_VAULT,
            abi.encodeWithSelector(IERC4626Minimal.redeem.selector),
            abi.encode("local simulated liquidity failure")
        );
        factory.executeInheritance(address(vault));
        assertGt(vault.claimedAt(), 0);
        assertGt(IERC20(MORPHO_VAULT).balanceOf(heir), 0);
        assertEq(IERC20(MORPHO_VAULT).balanceOf(address(vault)), 0);
    }

    function testExternalCanonicalRewardAfterInheritanceCannotBeSweptByOwner() public {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
        factory.executeInheritance(address(vault));
        uint256 heirBefore = IERC20(WLD).balanceOf(heir);
        uint256 feeBefore = IERC20(WLD).balanceOf(operator);
        uint256 ownerBefore = IERC20(WLD).balanceOf(owner);
        address distributor = vault.MERKL_DISTRIBUTOR();
        bytes32 oldRoot = IMerklRoot(distributor).getMerkleRoot();
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("external operator local fork reward");
        bytes32 leaf = keccak256(abi.encode(address(vault), WLD, uint256(10 ether)));
        bytes32 root = leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf));
        bool replaced;
        for (uint256 i; i < 256; ++i) {
            if (vm.load(distributor, bytes32(i)) == oldRoot) {
                vm.store(distributor, bytes32(i), root);
                replaced = true;
            }
        }
        assertTrue(replaced);
        address externalOperator = address(0xC1A1);
        // Local-only operator authorization; the Distributor code is genuine.
        vm.prank(address(vault));
        IMerklRoot(distributor).toggleOperator(address(vault), externalOperator);
        address[] memory users = new address[](1);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        users[0] = address(vault);
        tokens[0] = WLD;
        amounts[0] = 10 ether;
        proofs[0] = proof;
        vm.prank(externalOperator);
        IMerklRoot(distributor).claim(users, tokens, amounts, proofs);
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(vault.unprocessedRewards(), 10 ether);
        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(IERC20(WLD).balanceOf(owner), ownerBefore);
        assertApproxEqAbs(IERC20(WLD).balanceOf(heir) - heirBefore, 9 ether, 1e12);
        assertApproxEqAbs(IERC20(WLD).balanceOf(operator) - feeBefore, 1 ether, 1e12);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(IERC20(WLD).balanceOf(address(vault)), 0);
    }
}
