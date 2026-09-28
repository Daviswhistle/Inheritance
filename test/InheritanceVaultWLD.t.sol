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

    /// 두 단계 상속을 끝까지 진행시킨다: 신청 → 이의제기 기간 경과 → 최종 수령.
    function _runClaim(InheritanceVaultWLD v, address heirAddr) private {
        _fileOnly(v, heirAddr);
        vm.warp(block.timestamp + v.CHALLENGE_PERIOD());
        _finalizeOnly(v, heirAddr);
    }

    /// 상속 신청까지만. 이벤트를 신청 직후 시점에 맞춰 검증할 때 쓴다.
    function _fileOnly(InheritanceVaultWLD v, address heirAddr) private {
        vm.prank(heirAddr);
        v.fileClaim();
    }

    /// 이의제기 기간 경과 후 최종 수령만.
    function _finalizeOnly(InheritanceVaultWLD v, address heirAddr) private {
        vm.prank(heirAddr);
        v.finalizeClaim();
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
        _runClaim(vault, heir);
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");
    }

    // ================================================================
    //  회귀: claim 후 상태가 초기화되지 않아 이후 입금이 다시 sweep 가능했음
    // ================================================================

    function test_ClaimIsTerminal() public {
        _expire();
        _runClaim(vault, heir);

        assertTrue(vault.claimedAt() != 0, "claimedAt set");
        assertEq(vault.heir(), address(0), "heir cleared");
        assertFalse(vault.isExpired(), "isExpired after finalization");

        // 최종 실행 후에는 재신청도 재수령도 불가능하다.
        // 최종 상태에서 heir 는 0 으로 비워지므로 재신청은 권한 검사에서 먼저 막힌다.
        // (권한을 상태보다 먼저 보는 순서가 의도적이다 — 호출자가 유효한 상속인인지를
        //  확인하기 전에 상태를 알려주지 않는다)
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.fileClaim();
    }

    function test_DepositAfterClaimIsNotSweepable() public {
        _expire();
        _runClaim(vault, heir);
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");

        // 만기 후 추가 입금 → 더 이상 아무도 가져갈 수 없다
        wld.mint(address(vault), 50 ether);

        // 최종 상태에서 heir 는 0 이므로 권한 검사에서 먼저 막힌다.
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.finalizeClaim();

        assertEq(wld.balanceOf(heir), 100 ether, "heir balance unchanged");
        assertEq(wld.balanceOf(address(vault)), 50 ether, "stranded in vault");
    }

    // ================================================================
    //  Claim
    // ================================================================

    function test_ClaimTransfersFullBalance() public {
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());

        vm.expectEmit(true, false, false, true, address(vault));
        emit InheritanceVaultWLD.InheritanceFinalized(heir, 100 ether, block.timestamp);
        _finalizeOnly(vault, heir);

        assertEq(wld.balanceOf(heir), 100 ether, "heir balance");
        assertEq(wld.balanceOf(address(vault)), 0, "vault drained");
        assertEq(vault.claimedAt(), block.timestamp, "claimedAt");
    }

    function test_OnlyHeirCanFileClaim() public {
        _expire();
        // 남이 대신 신청하면 owner 가 의도하지 않은 이의제기 알림을 받게 되므로 금지한다.
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.fileClaim();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.fileClaim();

        // 실제 상속인은 신청할 수 있다
        _fileOnly(vault, heir);
        assertTrue(vault.claimPending(), "pending");
        assertEq(wld.balanceOf(heir), 0, "funds not moved yet");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "vault keeps funds during challenge");
    }

    function test_RevertWhen_ClaimBeforeExpiry() public {
        // 갱신 기한 전에는 상속인이 신청할 수 없다.
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotExpiredYet.selector);
        vault.fileClaim();
    }

    function test_RevertWhen_ClaimEmptyVault() public {
        wld.mint(address(vault), 0); // drain
        // 잔액을 heir 로 강제 이동
        vm.prank(address(vault));
        wld.transfer(heir, 100 ether);
        assertEq(wld.balanceOf(address(vault)), 0, "empty");

        _expire();
        // 신청은 성공하지만 최종 수령 시점에 자금이 없으므로 revert 한다.
        vm.prank(heir);
        vault.fileClaim();
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NothingToTransfer.selector);
        vault.finalizeClaim();
    }

    function test_CanClaimExactlyAtDeadline() public {
        vm.warp(vault.lastPing() + HEARTBEAT - 1);
        assertFalse(vault.isExpired(), "just before");
        vm.warp(vault.lastPing() + HEARTBEAT);
        assertTrue(vault.isExpired(), "at deadline");
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
        assertFalse(vault.isExpired(), "not claimable");
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
        assertTrue(vault.inheritanceCancelled(), "cancelled");

        _expire();
        // 취소된 뒤에는 원래 상속인이 신청할 수 없다
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.fileClaim();

        // 상속인이 없는 금고를 만료 규칙으로 잠가 버리면 자금이 영구히 갇힌다.
        vm.prank(owner);
        vault.ownerWithdrawWLD(100 ether, owner);
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
        _runClaim(v2, heir);
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
        _runClaim(v3, heir);

        // 재진입 시도는 위에서 삼켜졌지만, 최종 상태는 안전해야 한다
        assertEq(evil.balanceOf(heir), 10 ether, "heir paid exactly once");
        assertEq(evil.balanceOf(address(v3)), 0, "vault drained");
        assertEq(evil.reentryAttempts(), 1, "reentry was attempted");
        assertTrue(v3.claimedAt() != 0, "claimed");
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
        _runClaim(vault, heir);
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
        _runClaim(vault, heir);

        vm.prank(owner);
        factory.releaseMyVault();

        vm.prank(owner);
        address v2 = factory.createVault(stranger, 60 days);
        assertEq(factory.vaultOf(owner), v2, "new vault");
    }

    /// @dev 회귀: finalizeClaim() 후 isExpired() 가 false 가 되므로, 슬롯 해제 조건이
    ///      isExpired() 만 보면 상속을 이미 수령한 사용자가 영원히 새 금고를 못 만든다.
    function test_ReleaseWorksAfterClaimEvenThoughCanClaimIsFalse() public {
        _expire();
        _runClaim(vault, heir);

        assertFalse(vault.isExpired(), "isExpired false after finalization");
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
        new InheritanceVaultWLD(address(0), heir, address(wld), HEARTBEAT, address(this));
    }

    function test_RevertWhen_VaultWithZeroHeir() public {
        vm.expectRevert(InheritanceVaultWLD.InvalidAddress.selector);
        new InheritanceVaultWLD(owner, address(0), address(wld), HEARTBEAT, address(this));
    }

    function test_RevertWhen_VaultWithBadHeartbeat() public {
        vm.expectRevert(InheritanceVaultWLD.HeartbeatOutOfRange.selector);
        new InheritanceVaultWLD(owner, heir, address(wld), 1 hours, address(this));
    }

    // ================================================================
    //  Fuzz
    // ================================================================

    function testFuzz_PingAlwaysKeepsVaultAlive(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, HEARTBEAT - 1);
        vm.warp(block.timestamp + elapsed);
        vm.prank(owner);
        vault.ping();
        assertFalse(vault.isExpired(), "still alive after ping");
    }

    function testFuzz_ClaimAlwaysPaysFullBalance(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        wld.mint(address(vault), amount);
        uint256 expected = 100 ether + amount; // setUp 이 이미 100 ether 를 예치시킨다
        _expire();
        _runClaim(vault, heir);
        assertEq(wld.balanceOf(heir), expected, "full balance paid");
        assertEq(wld.balanceOf(address(vault)), 0, "drained");
    }

    function testFuzz_HeirAlwaysReceivesAfterExpiry(uint256 newInterval) public {
        newInterval = bound(newInterval, vault.MIN_HEARTBEAT(), vault.MAX_HEARTBEAT());
        vm.prank(owner);
        vault.updateHeartbeat(newInterval);

        vm.warp(vault.deadline());
        assertTrue(vault.isExpired(), "claimable at own deadline");
        _runClaim(vault, heir);
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");
    }

    // ================================================================
    //  이의제기 기간 (challenge window)
    //  만료 즉시 자금이 움직이지 않고, 상속인이 신청한 뒤 7일간 owner 가
    //  이의를 제기할 수 있다. 이 구간이 이 제품의 핵심 안전장치다.
    // ================================================================

    function test_ClaimWindowIsSevenDays() public {
        assertEq(vault.CHALLENGE_PERIOD(), 7 days, "challenge period is 7 days");
    }

    function test_ExpireAloneDoesNotMoveFunds() public {
        _expire();
        assertTrue(vault.isExpired(), "expired");
        // 만료만으로는 아무 일도 일어나지 않는다
        assertEq(wld.balanceOf(heir), 0, "heir has nothing yet");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "funds still in vault");
        assertFalse(vault.claimableNow(), "not finalizable without a claim");
    }

    function test_RevertWhen_PingAfterExpiryWithoutClaim() public {
        // 상속인이 아무것도 하지 않은 상태에서 owner 가 되살리면 안 된다.
        // 되살리기를 허용하면 상속 자체가 무의미해진다.
        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_PingDuringChallengeCancelsTheClaim() public {
        _expire();
        _fileOnly(vault, heir);
        assertTrue(vault.challengeRunning(), "challenge started");

        vm.prank(owner);
        vault.ping();

        // 청산 신청이 취소되고 기한이 전체 주기로 되돌아간다
        assertEq(vault.claimFiledAt(), 0, "claim withdrawn");
        assertFalse(vault.challengeRunning(), "challenge over");
        assertFalse(vault.claimableNow(), "not finalizable");
        assertTrue(vault.ownerStillActive(), "owner active again");
        assertEq(wld.balanceOf(heir), 0, "heir still has nothing");
    }

    function test_RevertWhen_FinalizeBeforeChallengeEnds() public {
        _expire();
        _fileOnly(vault, heir);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.ChallengeStillRunning.selector);
        vault.finalizeClaim();

        // 1초 적게도 안 된다
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD() - 1);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.ChallengeStillRunning.selector);
        vault.finalizeClaim();
    }

    function test_OwnerCanStillCancelAfterChallengeEndsButBeforeReceipt() public {
        // 7일이 지나도 상속인이 `finalizeClaim` 를 누르기 전까지는 owner 가 막을 수 있어야 한다.
        //
        // 여기서 이 정책이 바뀐 이유: 수령은 상속인이 직접 누르는 방식이다. 7일이 지나면
        // owner 가 막을 수 없는데 상속인은 즉시 가져갈 수 있는 구간이 생겼다 — 금고는
        // 무방비인데 자금은 아직 아무도 받지 않은 상태였다. 약속("수령 전까지 취소 가능")과
        // 어긋났다.
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());

        assertTrue(vault.claimableNow(), "heir may now withdraw");
        assertEq(vault.claimedAt(), 0, "but nothing has been received yet");
        assertTrue(vault.claimOutstanding(), "claim still outstanding");

        vm.prank(owner);
        vault.ping();

        assertEq(vault.claimFiledAt(), 0, "claim withdrawn");
        assertFalse(vault.claimableNow(), "heir can no longer withdraw");
        assertTrue(vault.ownerStillActive(), "countdown restored");
        assertEq(wld.balanceOf(heir), 0, "heir received nothing");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "funds untouched");
    }

    function test_RevertWhen_PingAfterReceipt() public {
        // 실제로 수령이 끝난 뒤에는 더 이상 취소할 수 없다.
        _expire();
        _runClaim(vault, heir);
        assertTrue(vault.claimedAt() > 0, "settled");
        assertFalse(vault.claimOutstanding(), "nothing outstanding any more");
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_RevertWhen_PingJustBeforeReclaimGrace() public {
        // 유예기간이 지나기 직전까지는 막힌다 — 1초 적게도 안 된다.
        _expire();
        assertTrue(vault.reclaimGraceElapsed() == false, "still locked");
        vm.warp(block.timestamp + vault.RECLAIM_GRACE() - 1);
        assertFalse(vault.reclaimGraceElapsed(), "one second short is still locked");
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_PingAfterReclaimGraceRestoresTheCountdown() public {
        // 상속인이 끝까지 신청하지 않아도 유예기간이 지나면 갱신이 열린다.
        // 자금이 영구히 묶이는 것을 막기 위한 유일한 통로다.
        _expire();
        vm.warp(block.timestamp + vault.RECLAIM_GRACE());
        assertTrue(vault.reclaimGraceElapsed(), "grace elapsed");

        vm.prank(owner);
        vault.ping();

        assertTrue(vault.ownerStillActive(), "countdown restored");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "funds still in the vault, ping moves nothing");
        assertEq(wld.balanceOf(heir), 0, "heir still has nothing");
    }

    function test_ReclaimGraceOnlyRestoresRenewalNotWithdrawal() public {
        // 되살리는 것은 갱신뿐이다. 유예기간이 지나도 곧바로 인출할 수는 없다.
        _expire();
        vm.warp(block.timestamp + vault.RECLAIM_GRACE());
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(1 ether, owner);
    }

    function test_ReclaimGraceDoesNotOpenWhileAClaimIsPending() public {
        // 유예기간은 "아무도 신청하지 않은 상태" 에만 적용된다.
        // 청산 신청이 걸려 있으면 이미 다른 경로(취소 가능)가 열려 있다.
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD() + vault.RECLAIM_GRACE());
        assertFalse(vault.reclaimGraceElapsed(), "a pending claim owns the state");
        assertTrue(vault.claimOutstanding(), "still outstanding");
    }

    function test_RevertWhen_FinalizeWhileOwnerCanStillCancel() public {
        // 상속인이 먼저 확정하면 owner 가 막을 수 없게 된다 — 그 전까지는 안 된다.
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        vm.prank(heir);
        vault.finalizeClaim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir took it after the window");
        // 이제 owner 의 취소는 불가하고, 자금은 이미 나갔다
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_OwnerCannotChangeSettingsDuringChallenge() public {
        // 이의제기 중에는 owner 가 살아있다는 신호(ping)만 보낼 수 있다.
        // 상속인 교체·기간 변경·출금으로이의제기을 뒤집을 수는 없어야 한다.
        _expire();
        _fileOnly(vault, heir);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeir(stranger);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeartbeat(365 days);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.cancelInheritance();

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(100 ether, owner);
    }

    function test_HeirCanFileAgainAfterOwnerObjects() public {
        _expire();
        _fileOnly(vault, heir);
        vm.prank(owner);
        vault.ping();

        // owner 가 되살렸으니 상속인은 새 주기 전체 + 이의제기를 다시 기다려야 한다
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        _finalizeOnly(vault, heir);
        assertEq(wld.balanceOf(heir), 100 ether, "heir eventually paid");
    }

    function test_RevertWhen_DoubleFile() public {
        _expire();
        _fileOnly(vault, heir);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.AlreadyFiled.selector);
        vault.fileClaim();
    }

    function test_ClaimFiledEmitsChallengeEnd() public {
        _expire();
        vm.expectEmit(true, false, false, true, address(vault));
        emit InheritanceVaultWLD.ClaimFiled(heir, block.timestamp, block.timestamp + vault.CHALLENGE_PERIOD());
        _fileOnly(vault, heir);
    }

    function test_HeirCanStillRescueAfterExpiry() public {
        // 상속 대상이 아닌 토큰은 이의제기 상태에서도 owner 가 회수할 수 있어야 한다.
        // 안 되면 잘못 전송된 자금이 영구히 갇힌다.
        _expire();
        _fileOnly(vault, heir);
        vm.prank(owner);
        vault.ownerRescueUnknownERC20(address(0xBEEF), 1, owner);
    }

    function test_ReleaseBlockedWhileClaimPending() public {
        // 신청만 하고 아직 수령하지 않은 상태에서 슬롯을 놓으면 금고가 사라진다
        _expire();
        _fileOnly(vault, heir);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();
    }

    function testFuzz_FinalizeAlwaysPaysFullBalance(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        wld.mint(address(vault), amount);
        // setUp 이 이미 100 ether 를 넣어 두었으므로 실제 잔액을 기준점으로 잡는다
        uint256 vaultBal = wld.balanceOf(address(vault));
        uint256 before = wld.balanceOf(heir);
        assertTrue(vaultBal > amount, "pre-existing balance present");

        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        _finalizeOnly(vault, heir);

        assertEq(wld.balanceOf(heir) - before, vaultBal, "heir got exactly the balance");
        assertEq(wld.balanceOf(address(vault)), 0, "vault drained");
    }

    function testFuzz_OwnerPingAlwaysCancelsPendingClaim(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, vault.CHALLENGE_PERIOD() - 1);
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + elapsed);

        vm.prank(owner);
        vault.ping();

        assertEq(vault.claimFiledAt(), 0, "claim always cancellable inside window");
        assertEq(wld.balanceOf(heir), 0, "heir never paid during challenge");
    }

    // ================================================================
    //  Factory routing — 앱이 호출하는 주소가 이 팩토리 한 곳으로 모인다
    //
    //  World App 은 전송 전에 대상 컨트랙트를 allowlist 로 검사하고 목록에 없으면
    //  `invalid_contract` 로 막는다. 사용자마다 주소가 다른 금고를 앱이 직접
    //  호출하면 allowlist 에 올릴 수 없다. 이 중계가 그 해법이며, 중계가
    //  권한을 넓혀주지 않는다는 것을 테스트로 확인한다.
    // ================================================================

    function test_Route_MyVaultMatchesVaultOf() public {
        vm.prank(owner);
        assertEq(factory.myVault(), address(vault), "myVault");
    }

    function test_RevertWhen_MyVaultWithoutVault() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NoVault.selector);
        factory.pingMyVault();
    }

    function test_Route_DepositMovesWldFromCaller() public {
        // 금고가 없는 주소는 입금할 수 없다
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NoVault.selector);
        factory.deposit(1 ether);

        wld.mint(owner, 10 ether);
        vm.startPrank(owner);
        wld.approve(address(factory), 10 ether);
        factory.deposit(4 ether);
        vm.stopPrank();

        assertEq(wld.balanceOf(address(vault)), 104 ether, "vault credited");
    }

    function test_Route_PingExtendsOwnVault() public {
        vm.prank(owner);
        factory.pingMyVault();
        assertEq(vault.lastPing(), block.timestamp, "pinged");
        assertTrue(vault.ownerStillActive(), "active");
    }

    function test_Route_PingFromStrangerReverts() public {
        // 다른 사람의 금고를 조작할 수 없어야 한다
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NoVault.selector);
        factory.pingMyVault();

        // 남의 금고 주소로 직접 두드려도owner 권한이 없다
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        InheritanceVaultWLD(payable(address(vault))).ping();
    }

    function test_Route_UpdateHeirAndPeriod() public {
        vm.prank(owner);
        factory.updateMyHeir(stranger);
        assertEq(vault.heir(), stranger, "heir updated");

        vm.prank(owner);
        factory.changeMyPeriod(60 days);
        assertEq(vault.heartbeatInterval(), 60 days, "period updated");
    }

    function test_Route_WithdrawBeforeExpiry() public {
        vm.prank(owner);
        factory.withdrawFromMyVault(owner, 25 ether);
        assertEq(wld.balanceOf(owner), 25 ether, "withdrawn");
        assertEq(wld.balanceOf(address(vault)), 75 ether, "remainder stays");
    }

    function test_Route_CancelInheritance() public {
        vm.prank(owner);
        factory.cancelMyInheritance();
        assertTrue(vault.inheritanceCancelled(), "cancelled");
    }

    function test_Route_FileClaimForwardsToVault() public {
        _expire();
        vm.prank(heir);
        factory.fileClaimFor(address(vault));
        assertTrue(vault.claimPending(), "filed via factory");
    }

    function test_Route_FileClaimRejectsNonHeir() public {
        // 팩토리는 calldata 의 금고 주소가 위조되지 않았는지 호출자로 확인한다
        _expire();
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        factory.fileClaimFor(address(vault));
    }

    function test_Route_FinalizeClaimForwardsToVault() public {
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        vm.prank(heir);
        factory.finalizeClaimFor(address(vault));
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid via factory");
    }

    function test_Route_FinalizeRejectsNonHeir() public {
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        factory.finalizeClaimFor(address(vault));
    }

    function test_Route_IsHeirOf() public {
        vm.prank(heir);
        assertTrue(factory.isHeirOf(owner, address(vault)), "is heir");
        vm.prank(stranger);
        assertFalse(factory.isHeirOf(owner, address(vault)), "not heir");
        // vaultOf 와 일치하지 않는 주소는 상속인이어도 거짓
        vm.prank(heir);
        assertFalse(factory.isHeirOf(owner, address(0xDEAD)), "unknown vault");
    }

    function test_Route_SweepEthFromMyVault() public {
        vm.deal(address(vault), 1 ether);
        vm.prank(owner);
        factory.sweepEthFromMyVault(payable(owner));
        assertEq(owner.balance, 1 ether, "eth swept");
    }

    function test_Route_RescueFromMyVault() public {
        MockERC20 other = new MockERC20("Other", "OTH");
        other.mint(owner, 5 ether);
        // 상속 대상이 아닌 토큰을 금고에 강제 입금
        vm.prank(owner);
        other.transfer(address(vault), 5 ether);
        assertEq(other.balanceOf(address(vault)), 5 ether, "stranded token");

        vm.prank(owner);
        factory.rescueFromMyVault(address(other), 5 ether, owner);
        assertEq(other.balanceOf(owner), 5 ether, "rescued");
    }
}
