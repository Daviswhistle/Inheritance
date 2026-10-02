// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultUSDC} from "../contracts/InheritanceVaultUSDC.sol";
import {InheritanceVaultUSDCFactory} from "../contracts/InheritanceVaultUSDCFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUSDC, MockRe7USDC} from "./mocks/MockRe7USDC.sol";
import {MockMerklDistributor} from "./mocks/MockMerklDistributor.sol";

abstract contract InheritanceVaultUSDCBase is Test {
    MockUSDC internal usdc;
    MockERC20 internal wld;
    MockRe7USDC internal re7;
    MockMerklDistributor internal distributor;
    InheritanceVaultUSDCFactory internal factory;
    InheritanceVaultUSDC internal vault;
    address internal owner = address(0xA11CE);
    address internal heir = address(0xB0B);
    address internal operator = address(0xFEE);
    address internal stranger = address(0xBAD);

    function setUp() public virtual {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        wld = new MockERC20("Worldcoin", "WLD");
        re7 = new MockRe7USDC(address(usdc));
        factory = new InheritanceVaultUSDCFactory(address(usdc), address(re7), address(wld), operator, 1000);
        vm.prank(owner);
        vault = InheritanceVaultUSDC(payable(factory.createVault(heir, 30 days)));
        MockMerklDistributor implementation = new MockMerklDistributor();
        vm.etch(vault.MERKL_DISTRIBUTOR(), address(implementation).code);
        distributor = MockMerklDistributor(vault.MERKL_DISTRIBUTOR());
        usdc.mint(owner, 1000e6);
        wld.mint(address(distributor), 1000 ether);
    }

    function _deposit(uint256 assets) internal {
        vm.startPrank(owner);
        usdc.approve(address(factory), assets);
        factory.depositWithMinShares(assets, re7.previewDeposit(assets));
        vm.stopPrank();
    }

    function _gain(uint256 rate) internal {
        re7.setRate(rate);
        usdc.mint(address(re7), 1000e6);
    }

    function _withdraw(uint256 assets) internal {
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, assets);
    }

    function _eligible() internal {
        vm.warp(vault.deadline());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        vm.warp(vault.challengeEndsAt());
    }

    function _reward(uint256 cumulative) internal returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = keccak256("explicit local USDC-vault WLD reward fixture");
        bytes32 leaf = keccak256(abi.encode(address(vault), address(wld), cumulative));
        distributor.setRoot(
            leaf < proof[0] ? keccak256(abi.encode(leaf, proof[0])) : keccak256(abi.encode(proof[0], leaf))
        );
    }

    function _claim(uint256 cumulative) internal returns (uint256) {
        return factory.claimRewardsFor(address(vault), cumulative, _reward(cumulative), 0);
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
}
