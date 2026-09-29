// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";

/// @title InheritanceVaultWLD — WLD 전용 상속 금고 (1인 1금고 팩토리에서 생성)
///
/// @notice owner가 {heartbeatInterval} 동안 ping(생존 신호)을 보내지 않으면 금고의 WLD 잔액을
///         heir에게 이전한다.
///
/// @dev **두 단계 상속.** 만료 즉시 자금이 움직이지 않는다. heir가 먼저 `fileClaim()` 로
///      신청을 하고, 그 시점부터 {CHALLENGE_PERIOD} 동안 owner가 이의를 제기할 수 있으며,
///      기간이 지나고 heir가 `finalizeClaim()` 을 실행해야 자금이 실제로 이동한다.
///
///      이 단계를 둔 이유는 "잠깐 깜빡여서 전액을 잃는" 상황을 없애기 위해서다.
///      이 앱의 목적은 사용자의 마지막 의사를 전달하는 것이지, 사용자가
///      실수하거나 잊었다고 가문의 돈을 빼앗아 가는 것이 아니다. 신청이
///      실제로 들어온 시점부터 이의제기 창을 열면, 오래 부재였다가 돌아온
///      사용자에게도 회수 기회가 생기고, 그게 아니라면 상속인은 7일 뒤에
///      받는다. 상속인이 방치하더라도 owner에게 불이익은 없다.
///
///      만기 시점의 **owner 측 상태는 불변이며**, `ping()` 은 이의제기 창 안에서만 예외적으로
///      허용된다. owner가 할 수 있는 유일한 예외 행동은 청산을 취소하는 것뿐이며,
///      자금을 옮기거나 상속인을 바꾸거나 기간을 늘리는 것은 여전히 불가능하다.
contract InheritanceVaultWLD {
    // ===== Errors =====
    error NotOwner();
    error InvalidAddress();
    error HeartbeatOutOfRange();
    error NotExpiredYet();
    error Expired(); // 만기 후에는 소유자 기능 불가
    error AlreadyClaimed();
    error AlreadyFiled();
    error NotHeir();
    error ChallengeStillRunning();
    error NothingToTransfer();
    /// @dev 정산(실제 수령)이 아직 되지 않았을 때. 정산 뒤에 들어온 잔고만 회수할 수 있다.
    error NotSettled();
    error EthNotAccepted();
    error Reentrancy();
    error WldOnly();
    error EthTransferFailed();

    // ===== Events =====
    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event ClaimFiled(address indexed by, uint256 filedAt, uint256 challengeEndsAt);
    event ClaimWithdrawn(address indexed by);
    event InheritanceFinalized(address indexed recipient, uint256 wldAmount, uint256 claimedAt);
    event OwnerWithdrawnWLD(address indexed to, uint256 amount);
    event SettledResidueSwept(address indexed to, uint256 amount);
    event UnknownERC20Rescued(address indexed token, address indexed to, uint256 amount);
    event EthSwept(address indexed to, uint256 amount);
    event InheritanceCanceled(address indexed owner);

    // ===== Storage =====
    address public immutable owner; // 금고 소유자
    address public immutable factory; // 이 금고를 생성한 팩토리
    address public immutable WLD; // 대상 토큰 (고정)
    address public heir; // 상속인
    uint256 public heartbeatInterval; // 만기 주기(초)
    uint256 public lastPing; // 마지막 연장 시각
    /// @notice 상속 신청 시각. 0 이면 아직 상속인이 신청하지 않았다.
    uint256 public claimFiledAt;
    /// @notice 상속이 최종 실행된 시각. 0 이면 아직 실행되지 않았다.
    uint256 public claimedAt;

    // ===== Reentrancy guard =====
    uint256 private _locked = 1;

    /// @notice 상속인이 신청한 뒤 owner가 이의를 제기할 수 있는 기간(초).
    /// @dev owner가 마지막 갱신의 시점에 이 값을 바꾸는 기능은 제공하지 않는다 —
    ///      상속인이 이의제기 창을 임의로 늘리거나 줄 수 있어야 하기 때문이다.
    ///      창이 짧으면 owner 가 보호받지 못하고, 길면 상속인이 불필요하게 기다린다.
    ///      7일이 두 요구를 동시에 만족하는 값이다.
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev 소유자 또는 그 팩토리. 팩토리를 경유하는 이유는 월드앱 allowlist 때문이다 —
    ///      사용자마다 다른 금고 주소를 앱이 직접 호출할 수 없으므로, 팩토리가 대신
    ///      중계한다. 팩토리는 `vaultOf` 로 소유자를 식별할 수 있으므로 이 경로가
    ///      권한을 넓혀주지 않는다.
    modifier onlyOwnerOrFactory() {
        if (msg.sender != owner && msg.sender != factory) revert NotOwner();
        _;
    }

    /// @dev 상속인 또는 그 팩토리.
    modifier onlyHeirOrFactory() {
        if (msg.sender != heir && msg.sender != factory) revert NotHeir();
        _;
    }

    /// @dev 소유자가 할 수 있는 유일한 생존 신호는 `ping` 이고, **상속인이 실제로 돈을
    ///      받기 전까지는 항상 열린다.** 상속이 성립하는 조건이 "피상속인이 더 이상 갱신하지
    ///      않는 것" 이므로, 갱신이 막히면 상속이 성립할 수 없게 되어 모순이다.
    ///
    ///      닫히는 유일한 시점은 `claimedAt != 0`, 즉 상속인이 실제로 받은 뒤다. 그
    ///      이후에는 자금이 이미 옮겨갔으므로 되살릴 대상이 없다.
    ///
    ///      이게 뜻하는 것: 상속인에게는 **언젠가 온다** 는 보장은 없다. 주인이 계속
    ///      갱신하면 상속인은 계속 기다린다. 그런데 그게 상속의 정의다 — 상속인은 "피상속인이
    ///      죽었다" 는 신호를 기다리는 쪽이지, 정해진 날짜에 돈을 받는 쪽이 아니다. 이
    ///      권리를 제한하려고 갱신을 막으면 상속이라는 개념 자체가 사라진다.
    ///
    ///      상속인 쪽 보장도 대신 분명하다. `CHALLENGE_PERIOD` 안에는 `finalizeClaim` 이
    ///      revert 되므로 owner 가 아무리 빨리 갱신해도 상속인은 7일을 덜 버틸 수 없다.
    ///      주인은 기간을 늘릴 수는 있지만 줄일 수는 없다.
    ///
    ///      이 갱신은 자금을 옮기지 않고, 상속인을 바꾸거나 기간을 바꾸는 권한도 아니다.
    ///      그 둘은 `ownerStillActiveOnly` 로 계속 막혀 있다.
    modifier ownerMayStillAct() {
        if (claimedAt != 0) revert Expired();
        _;
    }

    /// @dev 갱신 기한 전까지. 이의제기 기간에도 적용된다 — 신청 이후 owner 가 상속인을
    ///      바꾸거나 기간을 늘리는 것으로는 신청을 이길 수 없어야 한다.
    modifier ownerStillActiveOnly() {
        if (!ownerStillActive()) revert Expired();
        _;
    }

    /// @dev 긴급 회수는 예외적으로 **상속이 취소된 금고**에서는 만료 후에도 허용한다.
    ///      취소는 heir 를 owner 로 바꾸므로 신청할 상속인이 없고, 만료 규칙으로
    ///      잠가 버리면 자금이 영구히 갇힌다.
    modifier ownerMayWithdraw() {
        if (!ownerStillActive() && !inheritanceCancelled()) revert Expired();
        _;
    }

    /// @param _owner 금고 소유자
    /// @param _heir 상속인 주소
    /// @param _wld 상속 대상 토큰
    /// @param _heartbeatInterval 갱신 주기(초). {MIN_HEARTBEAT} ~ {MAX_HEARTBEAT} 사이.
    /// @param _factory 이 금고를 생성한 팩토리. 소유자 액션 중계를 허용할 유일한 주소.
    constructor(address _owner, address _heir, address _wld, uint256 _heartbeatInterval, address _factory) {
        if (_owner == address(0) || _heir == address(0) || _wld == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();
        if (_heartbeatInterval < MIN_HEARTBEAT || _heartbeatInterval > MAX_HEARTBEAT) {
            revert HeartbeatOutOfRange();
        }
        owner = _owner;
        heir = _heir;
        WLD = _wld;
        factory = _factory;
        heartbeatInterval = _heartbeatInterval;
        lastPing = block.timestamp;
        emit Ping(lastPing);
    }

    // ===== Views =====

    /// @notice owner 가 아직 금고를 갱신할 수 있는 상태인지.
    /// @dev 게이트웨이 판정의 단일 기준점이다. 상속인이 신청하지 않은 상태에서만 true 다
    ///      (= 갱신 기한 전). 신청이 들어오면 이 값은 false 가 되어 owner 의 다른 상태 변경이
    ///      전부 막히고, 이의제기 기간에는 오직 `ping()` 만 열린다.
    function ownerStillActive() public view returns (bool) {
        return claimFiledAt == 0 && block.timestamp < lastPing + heartbeatInterval;
    }

    /// @notice 갱신 기한이 지났는지 (상속인이 아직 신청하지 않은 상태).
    /// @dev 만료 자체를 뜻한다. 자금이 상속인에게 이동하려면 `fileClaim()` 과
    ///      `finalizeClaim()` 이 추가로 필요하다.
    function isExpired() public view returns (bool) {
        return claimedAt == 0 && claimFiledAt == 0 && block.timestamp >= lastPing + heartbeatInterval;
    }

    /// @notice 상속이 취소되었는지 (heir 가 owner 로 바뀐 상태).
    /// @dev 취소된 금고는 상속인이 없으므로 순수한 본인 지갑과 같다. 이 경우에도
    ///      만료 후 회수가 막히면 자금이 영구히 갇힌다 — 취소했으면서 못 빼게 되는
    ///      것은 사용자가 취소 버튼을 눌렀다는 사실과 모순이다.
    function inheritanceCancelled() public view returns (bool) {
        return heir != address(0) && heir == owner;
    }

    /// @notice 지금 자금이 상속인에게 이동 가능한 최종 상태인지.
    function claimableNow() public view returns (bool) {
        return claimFiledAt != 0 && block.timestamp >= claimFiledAt + CHALLENGE_PERIOD;
    }

    /// @notice 상속인이 신청했고 owner가 아직 이의를 제기할 수 있는 기간인지.
    function challengeRunning() public view returns (bool) {
        return claimFiledAt != 0 && block.timestamp < claimFiledAt + CHALLENGE_PERIOD;
    }

    /// @notice 상속인이 신청했고 아직 실제로 받지 않은 상태인지.
    /// @dev 7일이 지나도 `finalizeClaim` 는 상속인이 직접 호출해야 실행된다. 따라서 이
    ///      구간에서는 자금이 아직 움직이지 않았고, owner 의 취소 권한도 남아 있어야 한다.
    ///      `claimableNow()` 과 다른 함수다 — 여기는 "돈이 아직 나가지 않았는가" 를 묻고,
    ///      저것은 "지금 상속인이 가져갈 수 있는가" 를 묻는다.
    function claimOutstanding() public view returns (bool) {
        return claimFiledAt != 0 && claimedAt == 0;
    }

    /// @notice 상속인이 신청했는지 여부.
    function claimPending() external view returns (bool) {
        return claimFiledAt != 0;
    }

    /// @notice 이의제기 기간 종료 시각 (신청 전이면 0).
    function challengeEndsAt() external view returns (uint256) {
        if (claimFiledAt == 0) return 0;
        return claimFiledAt + CHALLENGE_PERIOD;
    }

    /// @notice 기한까지 남은 시간(초). 만료·신청·최종 실행 어느 상태든 0 을 넘지 않는다.
    function timeRemaining() external view returns (uint256) {
        if (claimFiledAt != 0 || claimedAt != 0) return 0;
        uint256 due = lastPing + heartbeatInterval;
        return due > block.timestamp ? (due - block.timestamp) : 0;
    }

    /// @notice 갱신 기한(만료 예정 시각).
    function deadline() external view returns (uint256) {
        return lastPing + heartbeatInterval;
    }

    /// @notice 이 금고의 활성 재사용이 끝났는지 (만료되었거나 상속이 진행 중이거나 완료됨).
    /// @dev 팩토리의 슬롯 해제 조건.
    function isSettled() external view returns (bool) {
        return claimedAt != 0 || isExpired() || claimFiledAt != 0;
    }

    // ===== Owner controls =====

    /// @notice 생존 신호. 갱신 기한이 지난 뒤에도 **이의제기 기간 안에서는** 호출할 수
    ///         있으며, 이 경우 청산 신청이 취소되고 기한이 다시 전체 주기로 초기화된다.
    /// @dev 이것이 owner 가 지킬 수 있는 유일한 최종 행동이며, 자금을 옮기지도
    ///      상속인을 바꾸지도 않는다. 기한이 지난 뒤에도 되살리기를 허용하면
    ///      상속은 무의미해진다.
    function ping() external onlyOwnerOrFactory ownerMayStillAct {
        bool hadPendingClaim = claimFiledAt != 0;
        lastPing = block.timestamp;
        if (hadPendingClaim) {
            claimFiledAt = 0;
            emit ClaimWithdrawn(owner);
        }
        emit Ping(lastPing);
    }

    /// @notice 상속인 변경 (갱신 기한 전, 이의제기 기간 이전).
    function updateHeir(address _newHeir) external onlyOwnerOrFactory ownerStillActiveOnly {
        if (_newHeir == address(0)) revert InvalidAddress();
        address old = heir;
        heir = _newHeir;
        emit HeirUpdated(old, _newHeir);
    }

    /// @notice 갱신 주기 변경 (갱신 기한 전, 이의제기 기간 이전).
    function updateHeartbeat(uint256 _newInterval) external onlyOwnerOrFactory ownerStillActiveOnly {
        if (_newInterval < MIN_HEARTBEAT || _newInterval > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        uint256 old = heartbeatInterval;
        heartbeatInterval = _newInterval;
        emit HeartbeatUpdated(old, _newInterval);
    }

    /// @notice 상속 자체를 취소. heir 를 owner 로 설정해 자동 이전을 막는다.
    /// @dev 만료 전이거나 이의제기 기간 중에만 가능하다. 취소된 금고는 owner 가
    ///      끝까지 살아 있다는 뜻이므로 상속인이 신청할 이유가 사라진다.
    function cancelInheritance() external onlyOwnerOrFactory ownerStillActiveOnly {
        address old = heir;
        heir = owner;
        claimFiledAt = 0;
        emit HeirUpdated(old, owner);
        emit InheritanceCanceled(owner);
    }

    // ===== Two-step claim =====

    /// @notice 상속인이 만료된 금고에 상속을 신청한다. 자금은 아직 이동하지 않는다.
    /// @dev 반드시 heir 자신만 호출할 수 있다. 남이 대신 신청하면 owner 가 의도하지
    ///      않은 이의제기 알림을 받는 등 방해가 될 수 있으므로 제한한다.
    ///      신청 시점부터 {CHALLENGE_PERIOD} 동안 owner 는 `ping()` 으로 이의를 제기할
    ///      수 있고, 기간이 지나면 heir 가 `finalizeClaim()` 으로 자금을 받는다.
    function fileClaim() external onlyHeirOrFactory {
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt != 0) revert AlreadyFiled();
        if (!isExpired()) revert NotExpiredYet();

        claimFiledAt = block.timestamp;
        emit ClaimFiled(msg.sender, claimFiledAt, claimFiledAt + CHALLENGE_PERIOD);
    }

    /// @notice 이의제기 기간이 지난 뒤 상속인이 WLD 전액을 받는다. 금고는 최종 상태가 된다.
    /// @dev 실행 직후 금고는 비어 있는 최종 상태가 되므로, 이후 입금분이 다시
    ///      sweep 되는 일이 없다. 실행 후에는 owner 의 `ping()` 이 차단되므로
    ///      되돌릴 수 없다.
    function finalizeClaim() external onlyHeirOrFactory nonReentrant {
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt == 0) revert NotExpiredYet();
        if (challengeRunning()) revert ChallengeStillRunning();

        address recipient = heir;
        uint256 bal = SafeERC20Lib.safeBalanceOf(WLD, address(this));
        if (bal == 0) revert NothingToTransfer();

        // Checks-Effects-Interactions: 최종 상태를 먼저 확정해 재진입/중복 실행을 차단한다.
        claimedAt = block.timestamp;
        heir = address(0);

        SafeERC20Lib.safeTransfer(WLD, recipient, bal);

        emit InheritanceFinalized(recipient, bal, claimedAt);
    }

    // ===== Owner recovery =====

    /// @notice 만료 전(이의제기 기간 이전) 소유자 긴급 회수 (WLD).
    /// @dev 상속이 취소된 경우(heir == owner)에는 만료 후에도 회수할 수 있게 한다.
    ///      상속인이 존재하지 않는 금고를 만료 규칙으로 잠가 버리면 자금이 영구히
    ///      갇히고, `releaseMyVault()` 도 잔액 0 이 아니어서 동작하지 않는다.
    function ownerWithdrawWLD(uint256 amount, address to) external onlyOwnerOrFactory ownerMayWithdraw nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        SafeERC20Lib.safeTransfer(WLD, to, amount);
        emit OwnerWithdrawnWLD(to, amount);
    }

    /// @notice **상속이 끝난 뒤** 들어온 WLD 를 회수한다.
    ///
    /// @dev 이게 없으면 자금이 영구히 묶이고, 더 나쁜 게 owner's factory 슬롯까지
    ///      영구히 막힌다. `finalizeClaim` 은 그 시점의 잔액 전량을 상속인에게 넘기고
    ///      금고를 비우지만, 그 *이후* 에 누군가 WLD 를 보내면 아무도 꺼낼 방법이 없다.
    ///      `ownerWithdrawWLD` 는 만료 후라 막히고(Expired), `ownerRescueUnknownERC20`
    ///      는 WLD 를 명시적으로 거부한다(WldOnly), `ping` 도 마찬가지다. 그리고 팩토리의
    ///      `releaseMyVault` 은 잔액 0 을 요구하므로(VaultNotEmpty) 그 1 wei 때문에
    ///      주인은 `createVault` 도 못 하게 된다 — 즉 제3자가 비용 0 으로 남의 슬롯을
    ///      영구히 봉인할 수 있었다. 실제로 그랬다.
    ///
    ///      상속인이 이미 받은 금액은 손댈 수 없다 — `finalizeClaim` 이 그 시점의 전량을
    ///      넘겼기 때문에 여기 남은 것은 상속 대상이 아니다. 누군가 늦게 보낸 것뿐이다.
    ///
    /// @param to 수령 주소
    function ownerSweepAfterSettlement(address to) external onlyOwnerOrFactory nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (claimedAt == 0) revert NotSettled();
        uint256 bal = SafeERC20Lib.safeBalanceOf(WLD, address(this));
        if (bal == 0) revert NothingToTransfer();
        SafeERC20Lib.safeTransfer(WLD, to, bal);
        emit SettledResidueSwept(to, bal);
    }

    /// @notice 상속 대상이 아닌 토큰 회수 (읽기 전용 컨트랙트 주소 검증 포함).
    /// @dev WLD 와 ETH 는 여기서 회수할 수 없다. ETH 는 {sweepEth} 를 쓸 것.
    ///      정산 이후 들어온 WLD 는 {ownerSweepAfterSettlement} 을 쓸 것.
    function ownerRescueUnknownERC20(address token, uint256 amount, address to)
        external
        onlyOwnerOrFactory
        nonReentrant
    {
        if (to == address(0)) revert InvalidAddress();
        if (token == WLD) revert WldOnly();
        SafeERC20Lib.safeTransfer(token, to, amount);
        emit UnknownERC20Rescued(token, to, amount);
    }

    /// @notice `SELFDESTRUCT` 로 강제 입금된 ETH 회수.
    /// @dev ETH 는 애초에 상속 대상이 아니므로 만료 여부와 무관하게 항상 회수할 수 있다.
    function sweepEth(address payable to) external onlyOwnerOrFactory nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingToTransfer();
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert EthTransferFailed();
        emit EthSwept(to, bal);
    }

    // ===== ETH 입금 차단 =====
    // `fallback` 을 두지 않는다 — payable fallback 이 붙으면 이 컨트랙트 타입이
    // payable 로 승격되어 상위에서 `payable(...)` 캐스팅을 강제하게 된다.
    // 빈 calldata 전송은 `receive` 로, 그 외 모든 미지 시그니처는 revert 로 차단된다.
    receive() external payable {
        revert EthNotAccepted();
    }
}
