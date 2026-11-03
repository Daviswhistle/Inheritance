// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultTokens} from "../contracts/InheritanceVaultTokens.sol";
import {InheritanceVaultTokensFactoryOnePerOwner} from "../contracts/InheritanceVaultTokensFactoryOnePerOwner.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PrototypeForceETH {
    constructor(address payable to) payable {
        selfdestruct(to);
    }
}

contract PrototypeETHReceiver {
    InheritanceVaultTokens public vault;
    bool public reject;
    bool public reenter;
    bool public blocked;

    constructor(bool reject_) {
        reject = reject_;
    }

    function setVault(InheritanceVaultTokens vault_) external {
        vault = vault_;
    }

    function sweep(bool reenter_) external {
        reenter = reenter_;
        vault.sweepEth(payable(address(this)));
    }

    receive() external payable {
        require(!reject, "reject");
        if (reenter) {
            (bool ok, bytes memory reason) =
                address(vault).call(abi.encodeCall(vault.sweepEth, (payable(address(this)))));
            blocked = !ok
                && keccak256(reason) == keccak256(abi.encodeWithSelector(InheritanceVaultTokens.Reentrancy.selector));
        }
    }
}

contract PrototypeSecurityRemediationTest is Test {
    address owner = address(0xA11CE);
    address heir = address(0xB0B);
    address recipient = address(0xCAFE);
    MockERC20 token;
    InheritanceVaultTokensFactoryOnePerOwner factory;
    InheritanceVaultTokens vault;

    function setUp() public {
        vm.warp(1_000_000);
        vm.deal(address(this), 10 ether);
        token = new MockERC20("Token", "TKN");
        factory = new InheritanceVaultTokensFactoryOnePerOwner();
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(owner);
        vault = InheritanceVaultTokens(payable(factory.createVault(heir, tokens, 1 days)));
    }

    function force(uint256 amount) internal {
        new PrototypeForceETH{value: amount}(payable(address(vault)));
    }

    function testForcedETHRecoveryAllowsSlotReleaseAndReplacement() public {
        force(1);
        vm.warp(vault.deadline());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();
        vm.startPrank(owner);
        vault.sweepEth(payable(recipient));
        assertTrue(factory.releaseMyVault());
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        address replacement = factory.createVault(heir, tokens, 1 days);
        vm.stopPrank();
        assertEq(recipient.balance, 1);
        assertEq(factory.vaultOf(owner), replacement);
        assertTrue(replacement != address(vault));
    }

    function testOwnerChoosesETHRecipientBeforeAndAfterExpiryWithoutTakingTokens() public {
        token.mint(address(vault), 10 ether);
        force(1 ether);
        vm.prank(owner);
        vault.sweepEth(payable(recipient));
        vm.warp(vault.deadline());
        force(2 ether);
        vm.prank(owner);
        vault.sweepEth(payable(recipient));
        assertEq(recipient.balance, 3 ether);
        assertEq(token.balanceOf(address(vault)), 10 ether);
        vault.claimAllAllowed();
        assertEq(token.balanceOf(heir), 10 ether);
    }

    function testRejectsUnauthorizedInvalidAndEmptySweeps() public {
        force(1);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultTokens.NotOwner.selector);
        vault.sweepEth(payable(heir));
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultTokens.InvalidAddress.selector);
        vault.sweepEth(payable(address(0)));
        vault.sweepEth(payable(recipient));
        vm.expectRevert(InheritanceVaultTokens.NothingToTransfer.selector);
        vault.sweepEth(payable(recipient));
        vm.stopPrank();
    }

    function testRejectingRecipientPreservesBalanceAndSweepCanRetry() public {
        PrototypeETHReceiver rejecting = new PrototypeETHReceiver(true);
        force(1 ether);
        vm.startPrank(owner);
        vm.expectRevert(InheritanceVaultTokens.EthTransferFailed.selector);
        vault.sweepEth(payable(address(rejecting)));
        assertEq(address(vault).balance, 1 ether);
        vault.sweepEth(payable(recipient));
        vm.stopPrank();
        assertEq(recipient.balance, 1 ether);
    }

    function testOwnerRecipientCannotReenterSweep() public {
        PrototypeETHReceiver receiver = new PrototypeETHReceiver(false);
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vault = new InheritanceVaultTokens(address(receiver), heir, tokens, 1 days);
        receiver.setVault(vault);
        force(1 ether);
        receiver.sweep(true);
        assertTrue(receiver.blocked());
        assertEq(address(receiver).balance, 1 ether);
        force(1 ether);
        receiver.sweep(false);
        assertEq(address(receiver).balance, 2 ether);
    }

    function testDirectETHStillRejected() public {
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok);
        assertEq(address(vault).balance, 0);
    }
}
