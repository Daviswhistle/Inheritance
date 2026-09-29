/**
 * 정산 후 잔고의 탈출구, 그리고 감사에서 드러난 테스트 공백.
 *
 * 1) 정산된 금고에 누군가 1 wei 를 보내면 주인은 아무것도 못 했다. `ownerWithdrawWLD`
 *    는 Expired, `ownerRescueUnknownERC20` 는 WldOnly, `ping` 도 Expired. 그리고
 *    팩토리의 `releaseMyVault` 이 잔액 0 을 요구하므로(VaultNotEmpty) 그 1 wei 때문에
 *    `createVault` 도 실패했다. 즉 **제3자가 비용 0 으로 주인의 슬롯을 영구히 봉인**.
 *    실제로 로컬 체인에서 재현했다.
 *
 * 2) 재진입 테스트가 비어 있었다. `MockERC20Reentrant` 가 재진입 대상으로 부르던
 *    `v.claim()` 은 계약에 존재하지 않는 함수였다 — ABI 디코드에서 revert 되고
 *    try/catch 가 삼켰다. 그래서 CEI 를 완전히 뒤집고 `nonReentrant` 를 지워도
 *    스위트 전체가 통과했다. 이 파일은 그 빈틈을 메운다.
 *
 * 3) `sweepEth` 와 `ownerRescueUnknownERC20` 에서 접근제어를 지워도 스위트가 통과했다.
 *    지금은 버그가 아니라 방어막이 없다는 뜻이다. 회귀를 잡으려면 테스트가 필요하다.
 */
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InheritanceVaultWLD} from "../contracts/InheritanceVaultWLD.sol";
import {InheritanceVaultWLDFactoryOnePerOwner} from "../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// finalizeClaim 안에서 재진입을 시도하는 토큰이 부르는 실제 계약 함수들.
/// 예전 목은 `claim()` 을 불렀는데 그 함수는 계약에 없다.
interface IReenter {
    function finalizeClaim() external;
    function ping() external;
    function ownerWithdrawWLD(uint256, address) external;
    function ownerRescueUnknownERC20(address, uint256, address) external;
}

/// 자금을 옮기기 전에 재진입을 발사하는 토큰.
contract ReenterBeforeTransfer {
    address public vault;
    address public other;
    bool public armed;
    uint256 public reentryCount;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function arm(address _vault, address _other) external {
        vault = _vault;
        other = _other;
        armed = true;
    }

    /// transferFrom 은 false 를 돌려준다 — 예전 deposit 이 이 값을 버렸었다.
    function transferFrom(address, address, uint256) external returns (bool) {
        return false;
    }

    /// 토큰이 금고 밖으로 나가는 순간에 재진입을 발사한다.
    ///
    /// 자금을 옮기기 **전에** 불러야 한다. 옮긴 뒤에 부르면 안쪽 호출이 잔고 0 을 보고
    /// NothingToTransfer 로 막혀서, 가드가 없어도 아무도 알아채지 못한다 — 처음 시도한
    /// 버전이 정확히 그랬고 M7 뮤테이션을 못 잡았다.
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        if (armed && msg.sender == vault) {
            armed = false;
            reentryCount += 1;
            IReenter r = IReenter(vault);
            try r.finalizeClaim() {} catch {}
            try r.ping() {} catch {}
            try r.ownerWithdrawWLD(1, other) {} catch {}
            try r.ownerRescueUnknownERC20(address(this), 1, other) {} catch {}
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// transferFrom 이 false 를 돌려주지만 실제로는 자금을 옮기지 않는 토큰.
contract FalseReturnToken {
    string public name = "FalseReturn";
    string public symbol = "FRT";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// 실패인데 false 를 돌려준다. 호출자가 반환값을 버리면 조용히 성공한 것처럼 보인다.
    function transferFrom(address, address, uint256) external returns (bool) {
        return false;
    }
}

contract SettledResidueTest is Test {
    MockERC20 wld;
    InheritanceVaultWLDFactoryOnePerOwner factory;
    InheritanceVaultWLD vault;

    address owner = address(0xA11CE);
    address heir = address(0xB0B);
    address stranger = address(0xDEAD);
    uint256 constant HB = 30 days;

    function setUp() public {
        wld = new MockERC20("Worldcoin", "WLD");
        factory = new InheritanceVaultWLDFactoryOnePerOwner(address(wld));
        vm.prank(owner);
        vault = InheritanceVaultWLD(payable(factory.createVault(heir, HB)));
        wld.mint(address(vault), 100 ether);
    }

    /// 기한 -> 신청 -> 7일 -> 최종 수령까지 진행한다.
    function _settle() private {
        vm.warp(block.timestamp + HB + 1);
        vm.prank(heir);
        vault.fileClaim();
        vm.warp(block.timestamp + vault.CHALLENGE_PERIOD() + 1);
        vm.prank(heir);
        vault.finalizeClaim();
    }

    // ── 1 wei 저격 시나리오 ───────────────────────────────────────

    function test_SettledVaultHasNoExitForLateWLD() public {
        // 재현. 이 테스트가 통과한다는 건 이 상태에 탈출구가 없다는 뜻이다.
        _settle();
        assertTrue(vault.claimedAt() > 0, "settled");
        assertEq(wld.balanceOf(heir), 100 ether, "heir paid in full");
        assertEq(wld.balanceOf(address(vault)), 0, "vault empty");

        // 제3자가 1 wei 를 보낸다 — 권한도 비용도 필요 없다.
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ownerWithdrawWLD(1, owner);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.WldOnly.selector);
        vault.ownerRescueUnknownERC20(address(wld), 1, owner);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.Expired.selector);
        vault.ping();
    }

    function test_OwnerSweepsLateWLDAfterSettlement() public {
        _settle();
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(owner);
        vault.ownerSweepAfterSettlement(owner);

        assertEq(wld.balanceOf(address(vault)), 0, "residue recovered");
        assertEq(wld.balanceOf(owner), 1, "owner got the 1 wei");
        assertEq(wld.balanceOf(heir), 100 ether, "heir untouched - already paid in full");
    }

    function test_OwnerCanThenReleaseTheVaultSlot() public {
        // 슬롯 봉인이 실제로 해소되는지. 잔고가 남으면 releaseMyVault 이 막혔다.
        _settle();
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(owner);
        vault.ownerSweepAfterSettlement(owner);
        vm.prank(owner);
        factory.releaseMyVault();
        assertEq(factory.vaultOf(owner), address(0), "slot released");

        vm.prank(owner);
        InheritanceVaultWLD v2 = InheritanceVaultWLD(payable(factory.createVault(heir, HB)));
        assertTrue(address(v2) != address(0), "new vault created");
        assertTrue(v2 != vault, "different address");
    }

    function test_Route_SweepThroughFactory() public {
        // 앱은 허용 목록 주소만 호출할 수 있으므로 팩토리 경로가 실제로 동작해야 한다.
        _settle();
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(owner);
        factory.sweepSettledVaultFor(owner);
        assertEq(wld.balanceOf(address(vault)), 0, "recovered via the factory");
    }

    function test_RevertWhen_SweepBeforeSettlement() public {
        // 정산 전이면 쓸 수 없다. 상속인이 받을 돈을 주인이 먼저 가져갈 수 있어야 한다.
        wld.mint(address(vault), 50 ether);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.NotSettled.selector);
        vault.ownerSweepAfterSettlement(owner);
    }

    function test_RevertWhen_SweepAfterExpiryButBeforeReceipt() public {
        vm.warp(block.timestamp + HB + 1);
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.NotSettled.selector);
        vault.ownerSweepAfterSettlement(owner);
    }

    function test_RevertWhen_SweepByStranger() public {
        _settle();
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(stranger);
        vm.expectRevert(InheritanceVaultWLD.NotOwner.selector);
        vault.ownerSweepAfterSettlement(stranger);
    }

    function test_RevertWhen_SweepNothingToTransfer() public {
        _settle();
        vm.prank(owner);
        vm.expectRevert(InheritanceVaultWLD.NothingToTransfer.selector);
        vault.ownerSweepAfterSettlement(owner);
    }

    // ── 재진입: 실제로 성립하는 경로로 ────────────────────────────

    function test_ReentrancyFromInsideFinalizeIsRejected() public {
        // finalizeClaim 이 실행되는 순간에서 재진입을 건다. 트랩은 WLD 역할이라
        // finalizeClaim 의 safeTransfer 를 지날 때 발사한다.
        //
        // 무엇이 실제로 막는지를 이 테스트가 밝힌다: 재진입 호출은 **토큰 컨트랙트에서**
        // 온다. 토큰은 owner 도 heir 도 아니므로 `onlyHeirOrFactory` /
        // `onlyOwnerOrFactory` 에서 이미 `NotHeir` / `NotOwner` 로 막힌다. 트레이스를
        // 보면 명확하다 — 안쪽 호출이 상태를 읽기 전에 막힌다.
        //
        // 그래서 CEI 를 뒤집거나 `nonReentrant` 를 지워도(뮤테이션 M7) 이 공격 경로로는
        // 관측되지 않는다. 두 가드가 이 경로에서는 여분이라는 뜻이지, 계약이 나쁘다는
        // 뜻은 아니다. 다른 컨트랙트 경로(예: ERC777 스타일 훅이 있는 토큰)를 대비한
        // 방어막으로 남긴다.
        //
        // 처음 시도의 트랩은 자금을 옮긴 **뒤에** 재진입했는데, 그랬더니 안쪽 호출이
        // 잔고 0 을 보고 NothingToTransfer 로 막혀 아무것도 검증하지 못했다. 옮기기
        // **전에** 재진입해야 한다.
        ReenterBeforeTransfer trap = new ReenterBeforeTransfer();
        InheritanceVaultWLDFactoryOnePerOwner f = new InheritanceVaultWLDFactoryOnePerOwner(address(trap));
        address o = address(0xA11CE);
        address h = address(0xB0B);
        vm.prank(o);
        InheritanceVaultWLD v = InheritanceVaultWLD(payable(f.createVault(h, HB)));
        trap.mint(address(v), 100 ether);

        vm.warp(block.timestamp + HB + 1);
        vm.prank(h);
        v.fileClaim();
        vm.warp(block.timestamp + v.CHALLENGE_PERIOD() + 1);

        trap.arm(address(v), address(0xCAFE));
        vm.prank(h);
        v.finalizeClaim();

        assertEq(trap.reentryCount(), 1, "the trap fired - otherwise this test proves nothing");
        assertEq(trap.balanceOf(h), 100 ether, "heir paid exactly once");
        assertEq(trap.balanceOf(address(v)), 0, "vault drained exactly once");
    }

    function test_OldReentrancyTargetDoesNotExist() public {
        // 예전 목이 깨져 있었는지 확인하는 귀환 테스트.
        //
        // `MockERC20Reentrant` 는 `v.claim()` 을 불렀는데 그 함수는 계약에 없다.
        // ABI 디코드에서 revert 되고 try/catch 가 삼켰으므로 어떤 가드도 검증되지 않았다.
        // 실제로 CEI 를 뒤집고 nonReentrant 를 지워도 스위트 전체가 통과했다.
        //
        // 존재 여부는 바이트코드에서 확인한다. staticcall 은 상태 변경 함수에 대해
        // revert 하므로 selector 확인에 쓸 수 없다.
        bytes memory code = address(vault).code;
        assertFalse(_hasSelector(code, bytes4(keccak256("claim()"))), "vault must not have claim()");
        assertTrue(_hasSelector(code, bytes4(keccak256("ping()"))), "ping() must exist - the real target");
    }

    function _hasSelector(bytes memory code, bytes4 sel) private pure returns (bool) {
        for (uint256 i = 0; i + 4 <= code.length; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    // ── 접근제어: 지워도 통과하던 두 함수 ──────────────────────────

    function test_RevertWhen_StrangerCallsSweepEth() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call(abi.encodeWithSignature("sweepEth(address)", stranger));
        assertFalse(ok, "a stranger must not be able to sweep ETH");
    }

    function test_RevertWhen_StrangerCallsRescueUnknownERC20() public {
        MockERC20 other = new MockERC20("Other", "OTH");
        other.mint(address(vault), 5 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call(
            abi.encodeWithSignature("ownerRescueUnknownERC20(address,uint256,address)", address(other), 1, stranger)
        );
        assertFalse(ok, "a stranger must not be able to rescue tokens");
    }

    function test_StrangerCannotSweepSettledResidueViaFactory() public {
        _settle();
        wld.mint(stranger, 1);
        vm.prank(stranger);
        wld.transfer(address(vault), 1);

        vm.prank(stranger);
        (bool ok,) = address(factory).call(abi.encodeWithSignature("sweepSettledVaultFor(address)", stranger));
        assertFalse(ok, "a stranger must not sweep someone else's residue");
    }

    // ── deposit 의 반환값 버리기 ──────────────────────────────────

    function test_RevertWhen_DepositWithFalseReturningToken() public {
        // 예전 deposit 은 `IERC20(WLD).transferFrom(...)` 의 bool 을 버렸다. 실패를
        // 알리는 토큰에서는 아무것도 안 옮겨갔는데도 성공한 것처럼 지나가고 화면은
        // "입금됨" 으로 간다. SafeERC20Lib 는 false 면 revert 한다.
        FalseReturnToken tok = new FalseReturnToken();
        InheritanceVaultWLDFactoryOnePerOwner f = new InheritanceVaultWLDFactoryOnePerOwner(address(tok));
        address o = address(0xA11CE);
        vm.prank(o);
        f.createVault(heir, HB);
        tok.mint(o, 10 ether);
        tok.approve(address(f), 10 ether);

        vm.prank(o);
        vm.expectRevert();
        f.deposit(5 ether);

        assertEq(tok.balanceOf(f.vaultOf(o)), 0, "nothing moved");
    }
}
