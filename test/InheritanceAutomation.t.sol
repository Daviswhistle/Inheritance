// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultWLD} from "../contracts/InheritanceVaultWLD.sol";
import {InheritanceVaultWLDFactoryOnePerOwner} from "../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// All getters can be forged, but an outsider cannot forge the factory's owner slot.
contract FakeAutomationVault {
    address public factory;
    address public WLD;
    address public owner;
    bool public invoked;

    constructor(address factory_, address wld_, address owner_) {
        factory = factory_;
        WLD = wld_;
        owner = owner_;
    }

    function finalizeClaim() external {
        invoked = true;
    }
}

/// Local RPC fixture for a previously deployed factory without the automation method.
contract LegacyAutomationFactory {
    address public immutable WLD;

    constructor(address wld_) {
        WLD = wld_;
    }
}

contract InheritanceAutomationTest is Test {
    InheritanceVaultWLDFactoryOnePerOwner factory;
    InheritanceVaultWLD vault;
    MockERC20 wld;
    address owner = address(0xA11CE);
    address heir = address(0xB0B);
    address keeper = address(0xC0FFEE);

    function setUp() public {
        wld = new MockERC20("Worldcoin", "WLD");
        factory = new InheritanceVaultWLDFactoryOnePerOwner(address(wld));
        vm.prank(owner);
        vault = InheritanceVaultWLD(payable(factory.createVault(heir, 1 days)));
        wld.mint(address(vault), 100 ether);
    }

    function _file() private {
        vm.warp(vault.lastPing() + vault.heartbeatInterval());
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
    }

    function _ready() private {
        _file();
        vm.warp(vault.claimFiledAt() + vault.CHALLENGE_PERIOD());
    }

    function test_StrangerExecutesButFundsOnlyReachStoredHeir() public {
        _ready();
        vm.prank(keeper);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(keeper), 0);
        assertEq(wld.balanceOf(owner), 0);
        assertEq(wld.balanceOf(address(vault)), 0);
        assertGt(vault.claimedAt(), 0);
    }

    function testFuzz_ExecutorCannotRedirect(address executor) public {
        _ready();
        vm.prank(executor);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(address(vault)), 0);
    }

    function test_RequestAndOriginalFinalizerRemainHeirOnly() public {
        vm.warp(vault.lastPing() + vault.heartbeatInterval());
        vm.prank(keeper);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotHeir.selector);
        factory.fileClaimFor(address(vault));
        _ready();
        vm.prank(keeper);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotHeir.selector);
        factory.finalizeClaimFor(address(vault));
    }

    function test_EarlyExecutionFails() public {
        _file();
        vm.warp(vault.claimFiledAt() + vault.CHALLENGE_PERIOD() - 1);
        vm.prank(keeper);
        vm.expectRevert(InheritanceVaultWLD.ChallengeStillRunning.selector);
        factory.executeInheritance(address(vault));
    }

    function test_NoRequestCannotExecute() public {
        vm.warp(vault.lastPing() + vault.heartbeatInterval());
        vm.expectRevert(InheritanceVaultWLD.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
    }

    function test_RenewAfterReviewStillPreventsExecution() public {
        _ready();
        vm.prank(owner);
        factory.pingMyVault();
        vm.prank(keeper);
        vm.expectRevert(InheritanceVaultWLD.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(address(vault)), 100 ether);
    }

    function test_CancelledInheritanceCannotExecute() public {
        _ready();
        vm.startPrank(owner);
        factory.pingMyVault();
        factory.cancelMyInheritance();
        vm.stopPrank();
        vm.expectRevert(InheritanceVaultWLD.NotExpiredYet.selector);
        factory.executeInheritance(address(vault));
    }

    function test_AlreadySettledCannotPayTwice() public {
        _ready();
        factory.executeInheritance(address(vault));
        wld.mint(address(vault), 3 ether);
        vm.expectRevert(InheritanceVaultWLD.AlreadyClaimed.selector);
        factory.executeInheritance(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether);
        assertEq(wld.balanceOf(address(vault)), 3 ether);
    }

    function test_EmptyClaimCannotExecute() public {
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, 100 ether);
        _ready();
        vm.expectRevert(InheritanceVaultWLD.NothingToTransfer.selector);
        factory.executeInheritance(address(vault));
    }

    function test_ForeignFactoryVaultIsRejected() public {
        InheritanceVaultWLDFactoryOnePerOwner foreignFactory = new InheritanceVaultWLDFactoryOnePerOwner(address(wld));
        address foreign = foreignFactory.createVault(heir, 1 days);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(foreign);
    }

    function test_ForgedGettersCannotForgeCanonicalSlot() public {
        FakeAutomationVault fake = new FakeAutomationVault(address(factory), address(wld), owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(address(fake));
        assertFalse(fake.invoked());
    }

    function test_UnexpectedTokenIsRejected() public {
        FakeAutomationVault fake = new FakeAutomationVault(address(factory), keeper, owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(address(fake));
        assertFalse(fake.invoked());
    }

    function test_ReleasedVaultIsRejected() public {
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, 100 ether);
        vm.warp(vault.lastPing() + vault.heartbeatInterval());
        vm.prank(owner);
        factory.releaseMyVault();
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(address(vault));
    }

    function test_EoaAndZeroAreRejected() public {
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(keeper);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotOurVault.selector);
        factory.executeInheritance(address(0));
    }
}
