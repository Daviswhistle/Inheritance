// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "../contracts/interfaces/IERC4626Minimal.sol";

interface IUSDCForkMerkl {
    function getMerkleRoot() external view returns (bytes32);
    function toggleOperator(address user, address operator) external;
    function claim(
        address[] calldata users,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external;
}

/// @notice Genuine World Chain state/bytecode on an opt-in local fork only.
/// No broadcast, signatures, funded wallet or actual earning claim is involved.
contract USDCWorldChainForkTest is Test {
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address constant RE7_USDC = 0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B;
    address constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);
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
        assertEq(IERC4626Minimal(RE7_USDC).asset(), USDC);
        factory = new InheritanceVaultUSDCFactory(USDC, RE7_USDC, WLD, operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultUSDC(payable(factory.createVault(heir, 30 days)));
        deal(USDC, owner, 100e6);
        vm.startPrank(owner);
        IERC20(USDC).approve(address(factory), 100e6);
        uint256 quote = IERC4626Minimal(RE7_USDC).previewDeposit(100e6);
        factory.depositWithMinShares(100e6, quote * 9950 / 10_000);
        vm.stopPrank();
    }

    function _eligible() internal {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
    }

    /// @dev Explicit local root/funding fixture. The real Distributor and WLD
    /// execute the claim; injecting a root does not establish campaign eligibility.
    function _injectedReward(uint256 cumulative) internal returns (bytes32[] memory proof) {
        address distributor = vault.MERKL_DISTRIBUTOR();
        assertGt(distributor.code.length, 0);
        deal(WLD, distributor, IERC20(WLD).balanceOf(distributor) + cumulative);
        bytes32 oldRoot = IUSDCForkMerkl(distributor).getMerkleRoot();
        assertTrue(oldRoot != bytes32(0), "active fixture root must exist");
        proof = new bytes32[](1);
        proof[0] = keccak256("explicit local USDC-vault WLD reward root fixture");
        bytes32 leaf = keccak256(abi.encode(address(vault), WLD, cumulative));
        bytes32 root = leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf));
        bool replaced;
        for (uint256 i; i < 256; ++i) {
            if (vm.load(distributor, bytes32(i)) == oldRoot) {
                vm.store(distributor, bytes32(i), root);
                replaced = true;
            }
        }
        assertTrue(replaced, "active root storage must be found");
        assertEq(IUSDCForkMerkl(distributor).getMerkleRoot(), root);
    }

    function testRealRe7USDCDepositAndFullOwnerRedemption() public {
        assertGt(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(), 100e6);
        assertEq(IERC20(USDC).allowance(address(vault), RE7_USDC), 0);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 99e6);
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
        assertGe(IERC20(USDC).balanceOf(owner), 99e6);
        assertLe(IERC20(USDC).balanceOf(operator), 1e6);
    }

    function testRealRe7CashInheritanceAfterReview() public {
        _eligible();
        uint256 gasBefore = gasleft();
        factory.executeInheritance(address(vault));
        emit log_named_uint("USDC cash inheritance gas (local fork)", gasBefore - gasleft());
        assertGt(vault.claimedAt(), 0);
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
        assertEq(IERC20(RE7_USDC).balanceOf(heir), 0);
        assertGe(IERC20(USDC).balanceOf(heir), 99e6);
    }

    function testRealWalletReceiptRedemptionNoSecondServiceFee() public {
        uint256 shares = IERC20(RE7_USDC).balanceOf(address(vault));
        vm.prank(owner);
        factory.withdrawSharesFromMyVault(owner, shares);
        uint256 feeShares = IERC20(RE7_USDC).balanceOf(operator);
        shares = IERC20(RE7_USDC).balanceOf(owner);
        vm.startPrank(owner);
        IERC20(RE7_USDC).approve(address(factory), shares);
        factory.redeemWalletShares(shares, 99e6);
        vm.stopPrank();
        assertEq(IERC20(RE7_USDC).balanceOf(operator), feeShares);
        assertEq(IERC20(USDC).balanceOf(operator), 0);
        assertEq(IERC20(RE7_USDC).balanceOf(owner), 0);
        assertGe(IERC20(USDC).balanceOf(owner), 99e6);
    }

    function testRealDistributorInjectedWLDStaysSeparateUntilFullExit() public {
        uint256 shares = IERC20(RE7_USDC).balanceOf(address(vault));
        uint256 ping = vault.lastPing();
        bytes32[] memory proof = _injectedReward(10 ether);
        uint256 gasBefore = gasleft();
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        emit log_named_uint("USDC-vault WLD claim gas (injected local root)", gasBefore - gasleft());
        assertEq(vault.totalRewardsClaimed(), 10 ether);
        assertEq(vault.unprocessedRewards(), 10 ether);
        assertEq(vault.costBasis(), 100e6);
        assertEq(vault.lastPing(), ping);
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), shares);
        assertEq(IERC20(WLD).balanceOf(address(vault)), 10 ether);
        vm.prank(owner);
        factory.withdrawAllFromMyVault(owner, 99e6);
        assertGe(IERC20(USDC).balanceOf(owner), 99e6);
        assertEq(IERC20(WLD).balanceOf(owner), 9 ether);
        assertEq(IERC20(WLD).balanceOf(operator), 1 ether);
        assertEq(vault.unprocessedRewards(), 0);
    }

    function testSimulatedIlliquidityTransfersRealReceiptIdleUSDCAndWLD() public {
        bytes32[] memory proof = _injectedReward(10 ether);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        deal(USDC, address(vault), 5e6);
        _eligible();
        vm.mockCallRevert(
            RE7_USDC,
            abi.encodeWithSelector(IERC4626Minimal.redeem.selector),
            abi.encode("local simulated Re7 liquidity failure")
        );
        factory.executeInheritance(address(vault));
        assertGt(vault.claimedAt(), 0);
        assertGt(IERC20(RE7_USDC).balanceOf(heir), 0);
        assertEq(IERC20(RE7_USDC).balanceOf(address(vault)), 0);
        assertEq(IERC20(USDC).balanceOf(heir), 5e6);
        assertEq(IERC20(WLD).balanceOf(heir), 9 ether);
        assertEq(IERC20(WLD).balanceOf(operator), 1 ether);
    }

    function testExternalRealDistributorLateWLDCannotBeRecoveredByOwner() public {
        _eligible();
        factory.executeInheritance(address(vault));
        vm.startPrank(owner);
        factory.releaseMyVault();
        address next = factory.createVault(address(0xC0FFEE), 30 days);
        vm.stopPrank();
        bytes32[] memory proof = _injectedReward(10 ether);
        address distributor = vault.MERKL_DISTRIBUTOR();
        address externalOperator = address(0xC1A1);
        vm.prank(address(vault));
        IUSDCForkMerkl(distributor).toggleOperator(address(vault), externalOperator);
        address[] memory users = new address[](1);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        users[0] = address(vault);
        tokens[0] = WLD;
        amounts[0] = 10 ether;
        proofs[0] = proof;
        vm.prank(externalOperator);
        IUSDCForkMerkl(distributor).claim(users, tokens, amounts, proofs);
        assertEq(vault.unprocessedRewards(), 10 ether);
        deal(WLD, address(vault), 13 ether);
        vm.prank(owner);
        factory.recoverArchivedVault(address(vault));
        assertEq(IERC20(WLD).balanceOf(heir), 9 ether);
        assertEq(IERC20(WLD).balanceOf(operator), 1 ether);
        assertEq(IERC20(WLD).balanceOf(owner), 3 ether);
        assertEq(vault.unprocessedRewards(), 0);
        assertEq(factory.vaultOf(owner), next);
        assertEq(IERC20(WLD).balanceOf(next), 0);
        assertEq(IERC20(RE7_USDC).balanceOf(next), 0);
    }

    function testColdRealTokensExhaustedStrategyWithIdleUSDCAndWLDGift() public {
        bytes32[] memory proof = _injectedReward(10 ether);
        factory.claimRewardsFor(address(vault), 10 ether, proof, 0);
        deal(USDC, address(vault), 5e6);
        deal(WLD, address(vault), 15 ether);
        _eligible();
        address originalCode = address(0x0F0123);
        vm.etch(originalCode, RE7_USDC.code);
        ForkExhaustedQuoteWrapper wrapper = new ForkExhaustedQuoteWrapper(originalCode);
        vm.etch(RE7_USDC, address(wrapper).code);
        vm.cool(address(factory));
        vm.cool(address(vault));
        vm.cool(RE7_USDC);
        vm.cool(USDC);
        vm.cool(WLD);
        vm.cool(vault.MERKL_DISTRIBUTOR());
        vm.cool(originalCode);
        vm.cool(address(vault));
        uint256 gasBefore = gasleft();
        factory.executeInheritance(address(vault));
        uint256 bodyGas = gasBefore - gasleft();
        uint256 padded = (bodyGas + 21_600) * 12 / 10;
        emit log_named_uint("cold real-token failure body gas", bodyGas);
        emit log_named_uint("cold real-token failure conservative padded tx gas", padded);
        assertLe(padded, 900_000);
        assertGt(IERC20(RE7_USDC).balanceOf(heir), 0);
        assertEq(IERC20(USDC).balanceOf(heir), 5e6);
        assertEq(IERC20(WLD).balanceOf(heir), 14 ether);
        assertEq(IERC20(WLD).balanceOf(operator), 1 ether);
    }
}

contract ForkExhaustedQuoteWrapper {
    address private immutable original;

    constructor(address original_) {
        original = original_;
    }

    fallback() external {
        if (msg.sig == IERC4626Minimal.redeem.selector || msg.sig == IERC4626Minimal.previewRedeem.selector) {
            assembly {
                invalid()
            }
        }
        address target = original;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}
