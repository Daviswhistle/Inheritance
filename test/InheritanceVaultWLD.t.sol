// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultWLD} from "../contracts/InheritanceVaultWLD.sol";
import {InheritanceVaultWLDFactoryOnePerOwner} from "../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC20NoReturn} from "./mocks/MockERC20NoReturn.sol";
import {MockERC20Reentrant} from "./mocks/MockERC20Reentrant.sol";

// 강제 입금된 ETH 는 `vm.deal` 로 잔액을 직접 만들어 흉내낸다.
// (SELFDESTRUCT 는 Cancun 에서 폐기 예정이라 테스트에서 쓰지 않는다)

contract InheritanceVaultWLDTest is Test {
    InheritanceVaultWLDFactoryOnePerOwner factory;
    InheritanceVaultWLD vault;
    MockERC20 wld;

    address owner = address(0xA11CE);
    address heir = address(0xB0B);
    address stranger = address(0xDEAD);

    uint256 constant HEARTBEAT = 30 days;

    function setUp() public {
        wld = new MockERC20("Worldcoin", "WLD");
        factory = new InheritanceVaultWLDFactoryOnePerOwner(address(wld));

        vm.prank(owner);
        vault = InheritanceVaultWLD(payable(factory.createVault(heir, HEARTBEAT)));

        wld.mint(address(vault), 100 ether);
    }

    function _expire() private {
        vm.warp(block.timestamp + HEARTBEAT);
    }

    // ================================================================
    //  Factory
    // ================================================================

    function test_Factory_StoresVaultAndEmits() public {
        assertEq(factory.vaultOf(owner), address(vault), "vaultOf");
        assertEq(vault.owner(), owner, "owner");
        assertEq(vault.heir(), heir, "heir");
        assertEq(vault.WLD(), address(wld), "WLD");
    }

    function test_RevertWhen_AlreadyHasVault() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.AlreadyHasVault.selector);
        factory.createVault(stranger, HEARTBEAT);
    }

    function test_HeirCanAlsoOwnOwnVault() public {
        // 상속인이라고 해서 자기 금고 생성이 막히면 안 된다 (프론트 버그의 회귀 테스트)
        vm.prank(heir);
        address heirVault = factory.createVault(stranger, HEARTBEAT);
        assertTrue(heirVault != address(0), "heir should be able to create a vault");
        assertEq(factory.vaultOf(heir), heirVault, "heir vaultOf");
    }

    function test_RevertWhen_ZeroHeir() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.InvalidAddress.selector);
        factory.createVault(address(0), HEARTBEAT);
    }

    function test_RevertWhen_FactoryWldIsEOA() public {
        // EOA 를 토큰으로 넘기면 금고가 자금을 영원히 못 옮기게 된다
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotAContract.selector);
        new InheritanceVaultWLDFactoryOnePerOwner(address(0xE0A));
    }

    function test_RevertWhen_FactoryWldIsZero() public {
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.InvalidAddress.selector);
        new InheritanceVaultWLDFactoryOnePerOwner(address(0));
    }

    function test_Factory_VaultsOf() public view {
        address[] memory arr = factory.vaultsOf(owner);
        assertEq(arr.length, 1, "len");
        assertEq(arr[0], address(vault), "elem");

        address[] memory empty = factory.vaultsOf(stranger);
        assertEq(empty.length, 0, "empty len");
    }

    // ================================================================
    //  회귀: 만기 후 소유자가 금고를 되살릴 수 있었음
    // ================================================================

    function test_RevertWhen_PingAfterExpiry() public {
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_RevertWhen_UpdateHeirAfterExpiry() public {
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeir(owner);
    }

    function test_RevertWhen_UpdateHeartbeatAfterExpiry() public {
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeartbeat(365 days);
    }

    function test_RevertWhen_CancelAfterExpiry() public {
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.cancelInheritance();
    }

    /// @dev 핵심 시나리오: 만기 후 owner 가 heir 를 자신으로 바꾼 뒤 claim 하여
    ///      전액을 되가져갈 수 있었어야 한다. 이제는 두 단계 모두 차단된다.
    function test_OwnerCannotStealBackAfterExpiry() public {
        _expire();

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeir(owner);

        // 우회 경로: ping 로 되살린 뒤 withdraw 시도
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(100 ether, owner);

        // 상속인은 그대로 수령한다
        vm.prank(stranger);
        vault.claim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");
    }

    // ================================================================
    //  회귀: claim 후 상태가 초기화되지 않아 이후 입금이 다시 sweep 가능했음
    // ================================================================

    function test_ClaimIsTerminal() public {
        _expire();
        vm.prank(stranger);
        vault.claim();

        assertTrue(vault.claimed(), "claimed");
        assertEq(vault.heir(), address(0), "heir cleared");
        assertFalse(vault.canClaim(), "canClaim after claim");

        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.AlreadyClaimed.selector);
        vault.claim();
    }

    function test_DepositAfterClaimIsNotSweepable() public {
        _expire();
        vm.prank(stranger);
        vault.claim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");

        // 만기 후 추가 입금 → 더 이상 아무도 가져갈 수 없다
        wld.mint(address(vault), 50 ether);

        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.AlreadyClaimed.selector);
        vault.claim();

        assertEq(wld.balanceOf(heir), 100 ether, "heir balance unchanged");
        assertEq(wld.balanceOf(address(vault)), 50 ether, "stranded in vault");
    }

    // ================================================================
    //  Claim
    // ================================================================

    function test_ClaimTransfersFullBalance() public {
        _expire();
        vm.expectEmit(true, false, false, true, address(vault));
        emit InheritanceVaultWLD.ClaimedWLD(heir, 100 ether);
        vm.prank(stranger);
        vault.claim();

        assertEq(wld.balanceOf(heir), 100 ether, "heir balance");
        assertEq(wld.balanceOf(address(vault)), 0, "vault drained");
        assertEq(vault.claimedAt(), block.timestamp, "claimedAt");
    }

    function test_ClaimIsPermissionless() public {
        _expire();
        vm.prank(address(0x9999));
        vault.claim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir balance");
    }

    function test_RevertWhen_ClaimBeforeExpiry() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotClaimableYet.selector);
        vault.claim();
    }

    function test_RevertWhen_ClaimEmptyVault() public {
        wld.mint(address(vault), 0); // drain
        // 잔액을 heir 로 강제 이동
        vm.prank(address(vault));
        wld.transfer(heir, 100 ether);
        assertEq(wld.balanceOf(address(vault)), 0, "empty");

        _expire();
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NothingToTransfer.selector);
        vault.claim();
    }

    function test_CanClaimExactlyAtDeadline() public {
        vm.warp(vault.lastPing() + HEARTBEAT - 1);
        assertFalse(vault.canClaim(), "just before");
        vm.warp(vault.lastPing() + HEARTBEAT);
        assertTrue(vault.canClaim(), "at deadline");
        assertEq(vault.timeRemaining(), 0, "timeRemaining");
    }

    // ================================================================
    //  Owner controls (만기 전)
    // ================================================================

    function test_PingResetsTimer() public {
        vm.warp(block.timestamp + 10 days);
        vm.prank(owner);
        vault.ping();
        assertEq(vault.lastPing(), block.timestamp, "lastPing");
        assertFalse(vault.canClaim(), "not claimable");
    }

    function test_UpdateHeir() public {
        vm.prank(owner);
        vault.updateHeir(stranger);
        assertEq(vault.heir(), stranger, "heir");
    }

    function test_RevertWhen_UpdateHeirToZero() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        vault.updateHeir(address(0));
    }

    function test_RevertWhen_HeartbeatTooShort() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.HeartbeatOutOfRange.selector);
        vault.updateHeartbeat(1 hours);
    }

    function test_RevertWhen_HeartbeatTooLong() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.HeartbeatOutOfRange.selector);
        vault.updateHeartbeat(366 days);
    }

    function test_HeartbeatBounds() public view {
        assertEq(vault.MIN_HEARTBEAT(), 1 days, "min");
        assertEq(vault.MAX_HEARTBEAT(), 365 days, "max");
    }

    function test_CancelInheritance() public {
        vm.prank(owner);
        vault.cancelInheritance();
        assertEq(vault.heir(), owner, "heir == owner");

        _expire();
        vm.prank(stranger);
        vault.claim();
        assertEq(wld.balanceOf(owner), 100 ether, "refunded to owner");
    }

    function test_RevertWhen_NonOwnerCalls() public {
        vm.startPrank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.ping();
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.updateHeir(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.updateHeartbeat(60 days);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.cancelInheritance();
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.ownerWithdrawWLD(1, stranger);
        vm.stopPrank();
    }

    // ================================================================
    //  Owner recovery
    // ================================================================

    function test_OwnerWithdrawBeforeExpiry() public {
        vm.prank(owner);
        vault.ownerWithdrawWLD(40 ether, owner);
        assertEq(wld.balanceOf(owner), 40 ether, "owner balance");
        assertEq(wld.balanceOf(address(vault)), 60 ether, "vault balance");
    }

    function test_RevertWhen_OwnerWithdrawAfterExpiry() public {
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(40 ether, owner);
    }

    function test_RevertWhen_WithdrawToZero() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        vault.ownerWithdrawWLD(1, address(0));
    }

    /// @dev 오입금 토큰은 만기 후에도 회수 가능해야 한다 (영구 잠금 방지)
    function test_RescueUnknownERC20AfterExpiry() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        stray.mint(address(vault), 7 ether);

        _expire();

        vm.prank(owner);
        vault.ownerRescueUnknownERC20(address(stray), 7 ether, owner);
        assertEq(stray.balanceOf(owner), 7 ether, "rescued");
        // WLD 는 이 경로로 회수할 수 없다
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.WldOnly.selector);
        vault.ownerRescueUnknownERC20(address(wld), 1, owner);
    }

    function test_RevertWhen_RescueToZero() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        vault.ownerRescueUnknownERC20(address(stray), 1, address(0));
    }

    // ================================================================
    //  ETH
    // ================================================================

    function test_RevertWhen_ReceiveEth() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "should reject ETH");
    }

    /// @dev 강제 입금된 ETH 는 소유자가 회수할 수 있어야 한다
    function test_SweepForcedEth() public {
        vm.deal(address(vault), 1 ether);
        assertEq(address(vault).balance, 1 ether, "eth landed");

        _expire(); // 만기 후에도 회수 가능해야 한다
        vm.prank(owner);
        vault.sweepEth(payable(owner));
        assertEq(owner.balance, 1 ether, "swept");
    }

    function test_RevertWhen_SweepNothing() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.NothingToTransfer.selector);
        vault.sweepEth(payable(owner));
    }

    // ================================================================
    //  비표준 토큰 (return 없음)
    // ================================================================

    function test_ClaimWorksWithNonStandardToken() public {
        MockERC20NoReturn odd = new MockERC20NoReturn();
        InheritanceVaultWLDFactoryOnePerOwner f2 = new InheritanceVaultWLDFactoryOnePerOwner(address(odd));

        vm.prank(owner);
        InheritanceVaultWLD v2 = InheritanceVaultWLD(payable(f2.createVault(heir, HEARTBEAT)));
        odd.mint(address(v2), 5 ether);

        vm.warp(block.timestamp + HEARTBEAT);
        vm.prank(stranger);
        v2.claim();
        assertEq(odd.balanceOf(heir), 5 ether, "non-standard token paid out");
    }

    // ================================================================
    //  Reentrancy
    // ================================================================

    function test_ReentrancyIsBlocked() public {
        MockERC20Reentrant evil = new MockERC20Reentrant();
        InheritanceVaultWLDFactoryOnePerOwner f3 = new InheritanceVaultWLDFactoryOnePerOwner(address(evil));

        vm.prank(owner);
        InheritanceVaultWLD v3 = InheritanceVaultWLD(payable(f3.createVault(heir, HEARTBEAT)));
        evil.mint(address(v3), 10 ether);
        evil.arm(address(v3));

        vm.warp(block.timestamp + HEARTBEAT);
        vm.prank(stranger);
        v3.claim();

        // 재진입 시도는 위에서 삼켜졌지만, 최종 상태는 안전해야 한다
        assertEq(evil.balanceOf(heir), 10 ether, "heir paid exactly once");
        assertEq(evil.balanceOf(address(v3)), 0, "vault drained");
        assertEq(evil.reentryAttempts(), 1, "reentry was attempted");
        assertTrue(v3.claimed(), "claimed");
    }

    // ================================================================
    //  releaseMyVault
    // ================================================================

    function test_ReleaseRequiresExpiryAndEmptyVault() public {
        // 만기 전에는 거절
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotExpired.selector);
        factory.releaseMyVault();

        // 만기되었어도 잔액이 있으면 거절
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();

        // 잔액 회수 후에는 성공
        vm.prank(stranger);
        vault.claim();
        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "released");
        assertEq(factory.vaultOf(owner), address(0), "slot freed");
    }

    function test_ReleaseBlockedByForcedEth() public {
        wld.mint(address(vault), 0);
        vm.prank(address(vault));
        wld.transfer(heir, 100 ether);
        _expire();

        vm.deal(address(vault), 1 ether);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();

        // ETH 를 회수하면 해제 가능
        vm.prank(owner);
        vault.sweepEth(payable(owner));
        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "released after sweep");
    }

    function test_RevertWhen_ReleaseWithoutVault() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NoVault.selector);
        factory.releaseMyVault();
    }

    function test_ReleaseThenCreateNewVault() public {
        _expire();
        vm.prank(stranger);
        vault.claim();

        vm.prank(owner);
        factory.releaseMyVault();

        vm.prank(owner);
        address v2 = factory.createVault(stranger, 60 days);
        assertEq(factory.vaultOf(owner), v2, "new vault");
    }

    /// @dev 회귀: claim() 후 canClaim() 이 false 가 되므로, 슬롯 해제 조건이
    ///      canClaim() 만 보면 상속을 이미 수령한 사용자가 영원히 새 금고를 못 만든다.
    function test_ReleaseWorksAfterClaimEvenThoughCanClaimIsFalse() public {
        _expire();
        vm.prank(stranger);
        vault.claim();

        assertFalse(vault.canClaim(), "canClaim false after claim");
        assertTrue(vault.isSettled(), "still settled");

        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "release after claim");
    }

    function test_IsSettled() public {
        assertFalse(vault.isSettled(), "fresh vault is active");
        vm.warp(vault.deadline());
        assertTrue(vault.isSettled(), "expired vault is settled");
    }

    // ================================================================
    //  Constructor validation
    // ================================================================

    function test_RevertWhen_VaultWithZeroOwner() public {
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        new InheritanceVaultWLD(address(0), heir, address(wld), HEARTBEAT);
    }

    function test_RevertWhen_VaultWithZeroHeir() public {
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        new InheritanceVaultWLD(owner, address(0), address(wld), HEARTBEAT);
    }

    function test_RevertWhen_VaultWithBadHeartbeat() public {
        vm.expectRevert(InheritanceVaultWLD.HeartbeatOutOfRange.selector);
        new InheritanceVaultWLD(owner, heir, address(wld), 1 hours);
    }

    // ================================================================
    //  Fuzz
    // ================================================================

    function testFuzz_PingAlwaysKeepsVaultAlive(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, HEARTBEAT - 1);
        vm.warp(block.timestamp + elapsed);
        vm.prank(owner);
        vault.ping();
        assertFalse(vault.canClaim(), "still alive after ping");
    }

    function testFuzz_ClaimAlwaysPaysFullBalance(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        wld.mint(address(vault), amount);
        uint256 expected = 100 ether + amount; // setUp 이 이미 100 ether 를 예치시킨다
        _expire();
        vm.prank(stranger);
        vault.claim();
        assertEq(wld.balanceOf(heir), expected, "full balance paid");
        assertEq(wld.balanceOf(address(vault)), 0, "drained");
    }

    function testFuzz_HeirAlwaysReceivesAfterExpiry(uint256 newInterval) public {
        newInterval = bound(newInterval, vault.MIN_HEARTBEAT(), vault.MAX_HEARTBEAT());
        vm.prank(owner);
        vault.updateHeartbeat(newInterval);

        vm.warp(vault.deadline());
        assertTrue(vault.canClaim(), "claimable at own deadline");
        vm.prank(stranger);
        vault.claim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");
    }
}
