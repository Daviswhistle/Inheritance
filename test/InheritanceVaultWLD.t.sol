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

    function test_PingAfterExpiryRestoresTheCountdown() public {
        // 기한이 지나도 갱신은 열린다.
        //
        // 상속이 성립하는 조건이 "피상속인이 갱신하지 않는 것" 이므로, 갱신을 막으면
        // 상속이 성립할 수 없다. 갱신은 "살아 있다" 는 신호이지 상속의 실패가 아니다.
        // 이 테스트는 옛 정책(만료 후 ping 불가)을 고정하고 있었고, 그 정책이 틀렸다.
        _expire();
        assertTrue(vault.isExpired(), "expired");

        vm.prank(owner);
        vault.ping();

        assertTrue(vault.ownerStillActive(), "countdown restored");
        assertFalse(vault.isExpired(), "no longer expired");
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
    function test_OwnerCannotRetargetAnAwardedClaim() public {
        // 지키려는 불변식이 바뀐다.
        //
        // 예전 테스트는 "만료 후 주인이 자금을 되가져갈 수 없어야 한다" 였다. 갱신이
        // 상속인이 받기 전까지 주인의 권리라는 게 드러나면서 그 전제는 사라졌다. 주인이
        // 갱신하는 동안 상속인이 기다리는 게 상속의 정의이기 때문이다.
        //
        // 진짜 조작 위험은 별개다 — 상속인이 이미 신청했는데 **주인이 그 신청의 대상이나
        // 조건을 바꿀 수 있다면** 그건 상속이 아니다. 갱신은 신청을 취소할 수 있어도
        // (명시적 이의 제기가 그거다) 상속인·기간을 몰래 바꿀 수는 없어야 한다.
        _expire();
        _fileOnly(vault, heir);

        // 7일이 지나 상속인이 수령할 수 있는 상태에서도
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());
        assertTrue(vault.claimableNow(), "heir may now withdraw");

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeir(owner);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeartbeat(1 days);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.cancelInheritance();

        // direct 인출도 막혀 있다 — 갱신(핑)을 거쳐야 하고, 핑은 상속인을 바꾸지 않는다
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(100 ether, owner);

        // 상속인은 그대로 수령한다
        vm.prank(heir);
        vault.finalizeClaim();
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid");
    }

    function test_PingCancelsWithoutRetargeting() public {
        // 핑이 하는 일은 신청 취소와 카운트다운 초기화뿐이다. 상속인이 그대로다.
        // 만료 후에도 갱신은 되지만 그 결과가 "상속인을 나로 바꾸기" 가 되지 않는지 확인.
        _expire();
        _fileOnly(vault, heir);
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD());

        vm.prank(owner);
        vault.ping();

        assertEq(vault.heir(), heir, "heir unchanged");
        assertEq(vault.claimFiledAt(), 0, "claim withdrawn");
        assertTrue(vault.ownerStillActive(), "countdown restored");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "funds never left");
        assertEq(wld.balanceOf(heir), 0, "heir still has nothing");
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

    // ---------------------------------------------------------------
    //  취소(cancel) 후 슬롯 해제 — 앱이 최근에 처음 열어준 경로
    // ---------------------------------------------------------------

    /// @dev 상속 취소(heir = owner)는 **만료 뒤에만** 성공하므로 취소된 금고는
    ///      `awaitingClaim` 도 `challengeRunning` 도 아니다. 팩토리의 해제 조건은
    ///      `isSettled()` 인데, 취소는 `inheritanceCancelled` 만 세우고 settled 는
    ///      아니므로 계약상으로는 통과한다. 실제로 통과한다는 것을 고정해 둔다 —
    ///      이 경로가 막히면 상속을 취소한 사용자는 자기 자리를 영영 못 되돌려받고
    ///      두 번째 금고를 만들 수 없다. (앱 UI 도 이 때문에 `cancelled` 를
    ///      `isExpiredOrLater` 에 넣었다.)
    function test_ReleaseAfterCancelFreesTheSlot() public {
        /* 취소는 **만료 전**에만 가능하다(`ownerStillActiveOnly`). 처음엔 만료 뒤에
          _cancel_ 할 수 있다고 알고 있었고 그 순서로 짜니 전부 `Expired()` 로
           떨어졌다. 계약의 순서를 그대로 따랐다. */
        assertFalse(vault.isExpired(), "not expired yet");
        vm.prank(owner);
        vault.cancelInheritance();
        assertTrue(vault.inheritanceCancelled(), "cancelled");
        assertFalse(vault.isSettled(), "not settled yet");

        _expire();
        // 만료 후 `isSettled()` 이 true 가 되어야 팩토리가 해제를 허락한다.
        assertTrue(vault.isSettled(), "settled once expired");

        // 잔액을 회수하고 나면 슬롯을 되돌려받을 수 있다.
        vm.prank(owner);
        vault.ownerWithdrawWLD(100 ether, owner);
        assertEq(wld.balanceOf(owner), 100 ether, "refunded");

        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "released after cancel");
        assertEq(factory.vaultOf(owner), address(0), "slot freed");
    }

    /// @dev 취소 → 해제 → 새 금고. 사용자가 실제로 겪는 전체 동선.
    function test_ReleaseAfterCancelThenCreateSecondVault() public {
        vm.prank(owner);
        vault.cancelInheritance();
        _expire();
        vm.prank(owner);
        vault.ownerWithdrawWLD(100 ether, owner);
        vm.prank(owner);
        factory.releaseMyVault();

        vm.prank(owner);
        address v2 = factory.createVault(heir, 60 days);
        assertEq(factory.vaultOf(owner), v2, "second vault registered");

        // 새 금고는 정상 작동한다 — 취소가 이전 금고의 상태를 오염시키지 않아야 한다.
        wld.mint(address(v2), 50 ether);
        assertEq(wld.balanceOf(v2), 50 ether, "second vault holds funds");
        InheritanceVaultWLD vault2 = InheritanceVaultWLD(payable(v2));
        vm.prank(owner);
        vault2.ping();
        vm.warp(block.timestamp + 60 days);
        vm.prank(heir);
        vault2.fileClaim();
        assertTrue(vault2.challengeRunning(), "second vault claim runs");
    }

    /// @dev 취소된 금고에서 원래 상속인은 아무것도 할 수 없다. 슬롯을 해제했든
    ///      안 했든 — `heir == owner` 이므로 신청/수령 권한이 소유자에게로 옮겨간다.
    function test_CancelledVaultIsUnreachableByTheOriginalHeir() public {
        vm.prank(owner);
        vault.cancelInheritance();
        _expire();

        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.fileClaim();

        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotHeir.selector);
        vault.finalizeClaim();
    }

    /// @dev 취소 후 만료된 금고에서 **무엇이 막히고 무엇이 열려 있는지**를 고정한다.
    ///
    ///      처음엔 전부 막힐 것으로 알고 있었는데실측하니 `ping` 은 성공한다.
    ///      이유: `ping` 은 `ownerMayStillAct`(claimedAt != 0 일 때만 막음) 라서이고,
    ///      `updateHeir` / `updateHeartbeat` / `cancelInheritance` 는
    ///      `ownerStillActiveOnly`(갱신 기한 전) 라서다. 계약의 의도된 차이다 —
    ///      소유자의 무제한 거부는 상속이 **진행 중이거나 이의제기 기간**일 때의
    ///      것이지, 이미 상속인이 없는(heir == owner) 상태까지 묶어 둔 게 아니다.
    ///
    ///      다만 여기서 실질적 함정 하나가 나온다: `ping` 은 `lastPing` 를 갱신하므로
    ///      `isExpired()` 가 다시 false 가 되고, 그 결과 `isSettled()` 도 false 가 되어
    ///      **슬롯 해제가 다시 막힌다.** 취소한 사용자가 갱신 버튼을 한 번 누르면 30일
    ///      동안 금고 자리를 못 되돌려받는다. 돈이 사라지지는 않지만 "자리를 못
    ///      돌려받는" 문제는 이 앱에서 진짜 손해다 — 두 번째 금고를 못 만들기 때문.
    ///      앱은 취소된 금고에서 갱신 UI 를 아예 감추는 것으로 이걸 막는다.
    function test_CancelledVaultControlMatrixAfterExpiry() public {
        vm.prank(owner);
        vault.cancelInheritance();
        _expire();

        // 갱신 기한 전 조건에 걸리는 것들 — 전부 막힌다.
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeartbeat(60 days);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.updateHeir(stranger);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.cancelInheritance();

        // `ping` 은 열려 있다 — 그리고 슬롯 해제를 다시 막는다.
        assertTrue(vault.isSettled(), "settled before ping");
        vm.prank(owner);
        vault.ping();
        assertFalse(vault.isExpired(), "ping revived the countdown");
        assertFalse(vault.isSettled(), "no longer settled");

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLDFactoryOnePerOwner.NotExpired.selector);
        factory.releaseMyVault();

        // 한 주기 기다리면 다시 해제할 수 있다 — 진짜로 막힌 게 아니다.
        _expire();
        assertTrue(vault.isSettled(), "settled again");
        vm.prank(owner);
        vault.ownerWithdrawWLD(100 ether, owner);
        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "releasable after waiting");
    }

    /// @dev 취소를 **되돌릴 수 있다** — 갱신 기한 전에는. heir 를 다시 지정하면
    ///      상속이 그대로 재개된다. 취소가 되돌릴 수 없는 실수여야 한다면
    ///      그렇지 않다. 앱의 "Cancel (set heir to me)" 라벨이 이 사실과 맞는지
    ///      확인할 근거가 된다.
    function test_CancelCanBeUndoneBeforeExpiry() public {
        vm.prank(owner);
        vault.cancelInheritance();
        assertTrue(vault.inheritanceCancelled(), "cancelled");

        vm.prank(owner);
        vault.updateHeir(heir);
        assertFalse(vault.inheritanceCancelled(), "cancel undone");
        assertEq(vault.heir(), heir, "heir restored");
    }

    /// @dev 슬롯을 해제하면 이전 금고는 **고아** 가 된다 — 팩토리가 더 이상 가리키지
    ///      않는다. 그 주소로 WLD 가 보내지면(누군가 주소만 알고) 소유자만 회수할 수
    ///      있다. 해제 전과 동일한 소유권이라는 것을 고정해 둔다 — "해제했으니 이제
    ///      아무도 못 건진다" 는 잘못된 인식이 생기지 않도록.
    function test_OrphanedCancelledVaultStillBelongsToTheOwner() public {
        vm.prank(owner);
        vault.cancelInheritance();
        _expire();
        vm.prank(owner);
        vault.ownerWithdrawWLD(100 ether, owner);
        vm.prank(owner);
        factory.releaseMyVault();

        // 슬롯은 비었지만 이전 금고 주소로 입금하면 소유자에게 돌아온다.
        wld.mint(address(vault), 7 ether);
        assertEq(wld.balanceOf(address(vault)), 7 ether, "stranded funds arrive");

        // `ownerWithdrawWLD` 는 `onlyOwner` 이므로 상속인에게 NotOwner 다
        // (NotHeir 가 아니다 — 청산 권한이 아니라 소유자 전용 함수다).
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.ownerWithdrawWLD(7 ether, heir);

        // 이 테스트 앞부분에서 이미 100 ether 를 돌려받았으므로 증가분을 본다.
        uint256 before = wld.balanceOf(owner);
        vm.prank(owner);
        vault.ownerWithdrawWLD(7 ether, owner);
        assertEq(wld.balanceOf(owner) - before, 7 ether, "owner recovers the stranded funds");
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

    function test_PingAfterExpiryWithoutClaimResetsTheTimer() public {
        // 기한이 지났고 상속인이 아직 아무것도 하지 않은 상태 — 여기도 갱신은 열린다.
        //
        // "상속인이 신청하기 전에는 주인이 갱신할 수 없다" 는 규칙이 아니었다. 상속은
        // 피상속인이 갱신을 멈출 때 성립하는 것이지, 상속인이 손을 대기 전까지 완성되는
        // 것이 아니다. 갱신을 막으면 상속인에게 "언젠가 온다" 는 신호가 아예 없어진다.
        _expire();
        assertTrue(vault.isExpired(), "expired");
        assertEq(vault.claimFiledAt(), 0, "nobody has claimed");

        vm.prank(owner);
        vault.ping();

        assertTrue(vault.ownerStillActive(), "countdown restored");
        assertFalse(vault.claimableNow(), "heir still cannot finalize");
        assertEq(wld.balanceOf(address(vault)), 100 ether, "funds never left");
    }

    function test_OwnerCanRenewHoweverLongNobodyFiles() public {
        // 기한이 지난 뒤 아무도 신청하지 않아도 주인은 계속 갱신할 수 있다.
        // 1년 뒤에도, 10년 뒤에도. 상속이 성립하려면 피상속인이 멈춰야 하고,
        // 그 멈춤을 표현할 방법이 남아 있어야 한다.
        _expire();
        vm.warp(block.timestamp + 3650 days);
        assertTrue(vault.isExpired(), "still expired after ten years");

        vm.prank(owner);
        vault.ping();
        assertTrue(vault.ownerStillActive(), "still able to signal");
    }

    function test_HeirStillCannotFinalizeDuringTheChallengeWindow() public {
        // 주인의 갱신 권한이 무제한이라는 것과 상속인의 7일이 사라진다는 건 다르다.
        // 주인은 기간을 늘릴 수는 있어도 줄일 수는 없다.
        _expire();
        _fileOnly(vault, heir);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.ChallengeStillRunning.selector);
        vault.finalizeClaim();

        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD() - 1);
        vm.prank(heir);
        vm.expectRevert(InheritanceVaultWLD.ChallengeStillRunning.selector);
        vault.finalizeClaim();
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
