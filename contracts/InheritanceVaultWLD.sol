// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";

/// @title InheritanceVaultWLD — WLD 전용 상속 금고 (1인 1금고 팩토리에서 생성)
///
/// @notice owner가 {heartbeatInterval} 동안 ping(생존 신호)을 보내지 않으면 금고의 WLD 잔액을
///         heir에게 이전한다.
///
/// @dev 만기(`canClaim() == true`)가 되면 **소유자의 상태 변경 권한이 완전히 정지된다**.
///      만기 전에 owner가 `ping`/`updateHeir`/`updateHeartbeat` 로 금고를 되살리거나
///      상속인을 자기 자신으로 바꿀 수 있다면, 상속은 사실상 무의미해진다.
///      만기 시점의 상태는 불변이며, {claim} 만 실행할 수 있다.
///
///      ETH는 상속 대상 자산이 아니다. `receive`/`fallback` 이 revert 하므로 정상적인
///      ETH 입금은 불가능하고, `SELFDESTRUCT` 로 강제 입금된 ETH만 {sweepEth} 로 회수한다.
contract InheritanceVaultWLD {
    // ===== Errors =====
    error NotOwner();
    error InvalidAddress();
    error HeartbeatOutOfRange();
    error NotClaimableYet();
    error Expired(); // 만기 후에는 소유자 기능 불가
    error AlreadyClaimed();
    error NothingToTransfer();
    error EthNotAccepted();
    error Reentrancy();
    error WldOnly();
    error EthTransferFailed();

    // ===== Events =====
    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event ClaimedWLD(address indexed to, uint256 amount);
    event OwnerWithdrawnWLD(address indexed to, uint256 amount);
    event UnknownERC20Rescued(address indexed token, address indexed to, uint256 amount);
    event EthSwept(address indexed to, uint256 amount);
    event InheritanceCanceled(address indexed owner);
    /// @notice 만기 후 상속이 최종적으로 성립해 실행되었음. vault는 이제 비어 있다.
    event InheritanceClaimed(address indexed recipient, uint256 wldAmount, uint256 claimedAt);

    // ===== Storage =====
    address public immutable owner; // 금고 소유자
    address public immutable WLD; // 대상 토큰 (고정)
    address public heir; // 상속인
    uint256 public heartbeatInterval; // 만기 주기(초)
    uint256 public lastPing; // 마지막 연장 시각
    bool public claimed; // 상속 실행 여부 (다시 실행 불가)
    uint256 public claimedAt; // 상속 실행 시각

    // ===== Reentrancy guard =====
    uint256 private _locked = 1;

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

    /// @dev 만기 이후에는 소유자의 모든 상태 변경을 차단한다.
    modifier onlyOwnerBeforeExpiry() {
        if (msg.sender != owner) revert NotOwner();
        if (canClaim()) revert Expired();
        _;
    }

    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;

    constructor(address _owner, address _heir, address _wld, uint256 _heartbeatInterval) {
        if (_owner == address(0) || _heir == address(0) || _wld == address(0)) revert InvalidAddress();
        if (_heartbeatInterval < MIN_HEARTBEAT || _heartbeatInterval > MAX_HEARTBEAT) {
            revert HeartbeatOutOfRange();
        }
        owner = _owner;
        heir = _heir;
        WLD = _wld;
        heartbeatInterval = _heartbeatInterval;
        lastPing = block.timestamp;
        emit Ping(lastPing);
    }

    // ===== Views =====

    /// @notice 지금 상속인이 자금을 수령할 수 있는 상태인지.
    function canClaim() public view returns (bool) {
        return !claimed && block.timestamp >= lastPing + heartbeatInterval;
    }

    function timeRemaining() external view returns (uint256) {
        if (canClaim()) return 0;
        uint256 due = lastPing + heartbeatInterval;
        return due > block.timestamp ? (due - block.timestamp) : 0;
    }

    /// @notice 만기 시각(0이면 이미 만기).
    function deadline() external view returns (uint256) {
        return lastPing + heartbeatInterval;
    }

    /// @notice 이 금고가 더 이상 활성 상태가 아닌지 (만기되었거나 이미 상속이 성립됨).
    /// @dev 팩토리의 슬롯 해제 조건. `claim()` 후에는 {canClaim} 이 false 가 되므로
    ///      `canClaim()` 만 보면 상속을 이미 수령한 사용자가 슬롯을 못 해제한다.
    function isSettled() external view returns (bool) {
        return claimed || canClaim();
    }

    // ===== Owner controls (만기 전) =====

    /// @notice 생존 신호. 만기 후에는 호출할 수 없다 — 되살리기를 허용하면 상속이 무의미해진다.
    function ping() external onlyOwnerBeforeExpiry {
        lastPing = block.timestamp;
        emit Ping(lastPing);
    }

    function updateHeir(address _newHeir) external onlyOwnerBeforeExpiry {
        if (_newHeir == address(0)) revert InvalidAddress();
        address old = heir;
        heir = _newHeir;
        emit HeirUpdated(old, _newHeir);
    }

    function updateHeartbeat(uint256 _newInterval) external onlyOwnerBeforeExpiry {
        if (_newInterval < MIN_HEARTBEAT || _newInterval > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        uint256 old = heartbeatInterval;
        heartbeatInterval = _newInterval;
        emit HeartbeatUpdated(old, _newInterval);
    }

    /// @notice 상속 자체를 취소(만기 전). heir=owner로 설정 → 사실상 자동 이전 중지.
    function cancelInheritance() external onlyOwnerBeforeExpiry {
        address old = heir;
        heir = owner;
        emit HeirUpdated(old, owner);
        emit InheritanceCanceled(owner);
    }

    // ===== Claim (만기 후 누구나 실행 가능) =====

    /// @notice 만기 후 WLD 전액을 상속인에게 전송.
    /// @dev 실행 직후 vault는 비어 있는 최종 상태가 되므로, 이후 입금분이 다시 sweep되는 일이 없다.
    function claim() external nonReentrant {
        if (claimed) revert AlreadyClaimed();
        if (!canClaim()) revert NotClaimableYet();

        address recipient = heir;
        uint256 bal = SafeERC20Lib.safeBalanceOf(WLD, address(this));
        if (bal == 0) revert NothingToTransfer();

        // Checks-Effects-Interactions: 만료를 먼저 확정해 재진입/중복 claim을 차단한다.
        claimed = true;
        claimedAt = block.timestamp;
        heir = address(0);

        SafeERC20Lib.safeTransfer(WLD, recipient, bal);

        emit ClaimedWLD(recipient, bal);
        emit InheritanceClaimed(recipient, bal, claimedAt);
    }

    // ===== Owner recovery (만기 전) =====

    /// @notice 만기 전 소유자 긴급 회수 (WLD).
    function ownerWithdrawWLD(uint256 amount, address to) external onlyOwner nonReentrant {
        if (canClaim()) revert Expired();
        if (to == address(0)) revert InvalidAddress();
        SafeERC20Lib.safeTransfer(WLD, to, amount);
        emit OwnerWithdrawnWLD(to, amount);
    }

    /// @notice 상속 대상이 아닌 오입금 토큰 구조 (만기 전).
    /// @dev 만기 이후에도 호출 가능해야 한다 — 만기 후 회수 경로가 없으면
    ///      잘못 전송된 토큰이 영구히 금고에 잠긴다. WLD 는 여기서 회수할 수 없다.
    function ownerRescueUnknownERC20(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (token == WLD) revert WldOnly();
        SafeERC20Lib.safeTransfer(token, to, amount);
        emit UnknownERC20Rescued(token, to, amount);
    }

    /// @notice `SELFDESTRUCT` 로 강제 입금된 ETH 회수.
    /// @dev ETH 는 애초에 상속 대상이 아니므로 만기 여부와 무관하게 항상 회수할 수 있다.
    function sweepEth(address payable to) external onlyOwner nonReentrant {
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
