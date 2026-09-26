// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultTokens} from "../contracts/InheritanceVaultTokens.sol";
import {InheritanceVaultTokensFactoryOnePerOwner} from "../contracts/InheritanceVaultTokensFactoryOnePerOwner.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract InheritanceVaultTokensTest is Test {
    InheritanceVaultTokensFactoryOnePerOwner factory;
    InheritanceVaultTokens vault;

    MockERC20 wld;
    MockERC20 usdc;

    address owner = address(0xA11CE);
    address heir = address(0xB0B);
    address stranger = address(0xDEAD);

    uint256 constant HEARTBEAT = 30 days;

    function setUp() public {
        wld = new MockERC20("Worldcoin", "WLD");
        usdc = new MockERC20("USD Coin", "USDC");

        factory = new InheritanceVaultTokensFactoryOnePerOwner();

        address[] memory allowed = new address[](2);
        allowed[0] = address(wld);
        allowed[1] = address(usdc);

        vm.prank(owner);
        vault = InheritanceVaultTokens(payable(factory.createVault(heir, allowed, HEARTBEAT)));

        wld.mint(address(vault), 100 ether);
        usdc.mint(address(vault), 500e6);
    }

    function _expire() private {
        vm.warp(block.timestamp + HEARTBEAT);
    }

    // ================================================================
    //  Setup
    // ================================================================

    function test_Setup() public view {
        assertEq(vault.owner(), owner, "owner");
        assertEq(vault.heir(), heir, "heir");
        assertTrue(vault.isAllowedToken(address(wld)), "wld allowed");
        assertTrue(vault.isAllowedToken(address(usdc)), "usdc allowed");
        assertEq(vault.allowedTokens().length, 2, "allowlist len");
    }

    function test_RevertWhen_AlreadyHasVault() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.AlreadyHasVault.selector);
        factory.createVault(heir, new address[](1), HEARTBEAT);
    }

    // ================================================================
    //  회귀: 만기 후 소유자가 allowlist / heir 를 바꾸던 것
    // ================================================================

    function test_RevertWhen_OwnerMutatesAfterExpiry() public {
        _expire();
        vm.startPrank(owner);

        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.ping();
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.updateHeir(owner);
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.updateHeartbeat(365 days);
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.cancelInheritance();
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.addAllowedToken(address(0xBAD));
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.removeAllowedToken(address(wld));
        vm.expectRevert(InheritanceVaultTokens.Expired.selector);
        vault.ownerWithdrawToken(address(wld), 1, owner);

        vm.stopPrank();
    }

    /// @dev 핵심: 만기 후 allowlist 에서 토큰을 빼면 상속인이 그 자금을 영영 회수할 수 없다.
    ///      (제거 시 claim 불가 / 소유자 회수도 Expired 로 차단) → 만기 후 변경 차단으로 해결
    function test_HeirCannotBeFrozenOutAfterExpiry() public {
        _expire();
        vm.prank(stranger);
        vault.claimAllAllowed();
        assertEq(wld.balanceOf(heir), 100 ether, "wld paid");
        assertEq(usdc.balanceOf(heir), 500e6, "usdc paid");
    }

    // ================================================================
    //  Claim
    // ================================================================

    function test_ClaimAllAllowed() public {
        _expire();
        vm.prank(stranger);
        vault.claimAllAllowed();
        assertEq(wld.balanceOf(heir), 100 ether, "wld");
        assertEq(usdc.balanceOf(heir), 500e6, "usdc");
        assertEq(vault.timeRemaining(), 0, "expired");
    }

    function test_ClaimTokensSubset() public {
        _expire();
        address[] memory subset = new address[](1);
        subset[0] = address(wld);

        vm.prank(stranger);
        vault.claimTokens(subset);

        assertEq(wld.balanceOf(heir), 100 ether, "wld paid");
        assertEq(usdc.balanceOf(address(vault)), 500e6, "usdc untouched");
    }

    /// @dev 토큰이 여러 개이므로 부분 회수 후 남은 잔액을 다시 회수할 수 있어야 한다.
    function test_PartialClaimThenClaimRest() public {
        _expire();
        address[] memory subset = new address[](1);
        subset[0] = address(wld);

        vm.prank(stranger);
        vault.claimTokens(subset);
        assertEq(wld.balanceOf(heir), 100 ether, "first claim");

        vm.prank(stranger);
        vault.claimAllAllowed();
        assertEq(usdc.balanceOf(heir), 500e6, "second claim");
    }

    function test_RevertWhen_ClaimBeforeExpiry() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokens.NotClaimableYet.selector);
        vault.claimAllAllowed();
    }

    function test_RevertWhen_ClaimNonAllowlisted() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        _expire();
        address[] memory subset = new address[](1);
        subset[0] = address(stray);

        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokens.TokenNotAllowed.selector);
        vault.claimTokens(subset);
    }

    function test_RevertWhen_ClaimEmpty() public {
        _expire();
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokens.NothingToTransfer.selector);
        vault.claimTokens(new address[](0));
    }

    // ================================================================
    //  Allowlist 관리 (만기 전)
    // ================================================================

    function test_AddRemoveAllowedToken() public {
        MockERC20 extra = new MockERC20("Extra", "X");

        vm.prank(owner);
        vault.addAllowedToken(address(extra));
        assertTrue(vault.isAllowedToken(address(extra)), "added");

        vm.prank(owner);
        vault.removeAllowedToken(address(extra));
        assertFalse(vault.isAllowedToken(address(extra)), "removed");
        assertEq(vault.allowedTokens().length, 2, "len restored");
    }

    function test_AddAllowedTokenIsIdempotent() public {
        vm.prank(owner);
        vault.addAllowedToken(address(wld));
        assertEq(vault.allowedTokens().length, 2, "no duplicate");
    }

    function test_RevertWhen_TooManyAllowedTokens() public {
        address[] memory tooMany = new address[](33);
        for (uint256 i = 0; i < 33; i++) {
            tooMany[i] = address(uint160(i + 1));
        }
        vm.prank(stranger); // owner 는 이미 금고가 있으므로 새 주소로 검증
        vm.expectRevert(InheritanceVaultTokens.TooManyAllowedTokens.selector);
        factory.createVault(heir, tooMany, HEARTBEAT);
    }

    /// @dev 생성자에 0x0 이 조용히 들어가면 그 토큰은 영원히 회수 불가능해진다
    function test_RevertWhen_ZeroAddressInAllowlist() public {
        address[] memory withZero = new address[](2);
        withZero[0] = address(wld);
        withZero[1] = address(0);

        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokens.InvalidAddress.selector);
        factory.createVault(heir, withZero, HEARTBEAT);
    }

    function test_RevertWhen_EmptyAllowlist() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokens.InvalidAddress.selector);
        factory.createVault(heir, new address[](0), HEARTBEAT);
    }

    // ================================================================
    //  회수
    // ================================================================

    function test_OwnerWithdrawAllowlistedBeforeExpiry() public {
        vm.prank(owner);
        vault.ownerWithdrawToken(address(wld), 40 ether, owner);
        assertEq(wld.balanceOf(owner), 40 ether, "withdrawn");
    }

    /// @dev allowlist 에 없는 오입금 토큰은 만기 후에도 회수 가능해야 한다
    function test_RescueNonAllowlistedAfterExpiry() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        stray.mint(address(vault), 7 ether);

        _expire();

        vm.prank(owner);
        vault.ownerRescueUnknownERC20(address(stray), 7 ether, owner);
        assertEq(stray.balanceOf(owner), 7 ether, "rescued");
    }

    /// @dev allowlist 토큰은 이 경로로 회수할 수 없다 (만기 후 회수 차단과 동일한 보호)
    function test_RevertWhen_RescueAllowlistedToken() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokens.TokenIsAllowlisted.selector);
        vault.ownerRescueUnknownERC20(address(wld), 1, owner);
    }

    function test_RevertWhen_RescueToZero() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokens.InvalidAddress.selector);
        vault.ownerRescueUnknownERC20(address(stray), 1, address(0));
    }

    function test_RevertWhen_ReceiveEth() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "should reject ETH");
    }

    // ================================================================
    //  releaseMyVault
    // ================================================================

    function test_ReleaseRequiresEmptyVault() public {
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.NotExpired.selector);
        factory.releaseMyVault();

        _expire();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.VaultNotEmpty.selector);
        factory.releaseMyVault();

        vm.prank(stranger);
        vault.claimAllAllowed();

        vm.prank(owner);
        assertTrue(factory.releaseMyVault(), "released");
        assertEq(factory.vaultOf(owner), address(0), "slot freed");
    }

    function test_RevertWhen_ReleaseWithoutVault() public {
        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultTokensFactoryOnePerOwner.NoVault.selector);
        factory.releaseMyVault();
    }

    // ================================================================
    //  Fuzz
    // ================================================================

    function testFuzz_ClaimAlwaysPaysEveryAllowlistedToken(uint8 a, uint8 b) public {
        a = uint8(bound(a, 1, 1000));
        b = uint8(bound(b, 1, 1000));
        wld.mint(address(vault), a);
        usdc.mint(address(vault), b);

        _expire();
        vm.prank(stranger);
        vault.claimAllAllowed();

        assertEq(wld.balanceOf(heir), 100 ether + a, "wld paid");
        assertEq(usdc.balanceOf(heir), 500e6 + b, "usdc paid");
    }
}
