// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultWLD — WLD 전용 상속 금고 (1인 1금고 팩토리에서 생성)
contract InheritanceVaultWLD {
    // Errors
    error NotOwner();
    error InvalidAddress();
    error HeartbeatOutOfRange();
    error NotClaimableYet();
    error Expired();
    error NothingToTransfer();
    error EthNotAccepted();

    // Events
    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event ClaimedWLD(address indexed to, uint256 amount);
    event OwnerWithdrawnWLD(address indexed to, uint256 amount);
    event InheritanceCanceled(address indexed owner);

    // Storage
    address public immutable owner;     // 금고 소유자
    address public immutable WLD;       // 대상 토큰 (고정)
    address public heir;                // 상속인
    uint256 public heartbeatInterval;   // 만기 주기(초)
    uint256 public lastPing;            // 마지막 연장 시각

    // Reentrancy guard
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;

    constructor(
        address _owner,
        address _heir,
        address _wld,
        uint256 _heartbeatInterval
    ) {
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

    // Views
    function canClaim() public view returns (bool) {
        return block.timestamp >= lastPing + heartbeatInterval;
    }

    function timeRemaining() external view returns (uint256) {
        if (canClaim()) return 0;
        uint256 deadline = lastPing + heartbeatInterval;
        return deadline > block.timestamp ? (deadline - block.timestamp) : 0;
    }

    // Owner controls (만기 전)
    function ping() external onlyOwner {
        lastPing = block.timestamp;
        emit Ping(lastPing);
    }

    function updateHeir(address _newHeir) external onlyOwner {
        if (_newHeir == address(0)) revert InvalidAddress();
        address old = heir;
        heir = _newHeir;
        emit HeirUpdated(old, _newHeir);
    }

    function updateHeartbeat(uint256 _newInterval) external onlyOwner {
        if (_newInterval < MIN_HEARTBEAT || _newInterval > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        uint256 old = heartbeatInterval;
        heartbeatInterval = _newInterval;
        emit HeartbeatUpdated(old, _newInterval);
    }

    /// 상속 자체 취소(만기 전) → 사실상 자동 이전 중지
    function cancelInheritance() external onlyOwner {
        if (canClaim()) revert Expired();
        heir = owner;
        emit InheritanceCanceled(owner);
    }

    /// 만기 후 누구나 실행 가능. WLD 전액을 상속인에게 전송.
    function claim() external nonReentrant {
        if (!canClaim()) revert NotClaimableYet();
        uint256 bal = IERC20(WLD).balanceOf(address(this));
        if (bal == 0) revert NothingToTransfer();
        require(IERC20(WLD).transfer(heir, bal), "WLD_TRANSFER_FAIL");
        emit ClaimedWLD(heir, bal);
    }

    /// 만기 전 소유자 긴급 회수 (WLD)
    function ownerWithdrawWLD(uint256 amount, address to) external onlyOwner nonReentrant {
        if (canClaim()) revert Expired();
        if (to == address(0)) revert InvalidAddress();
        require(IERC20(WLD).transfer(to, amount), "WLD_WITHDRAW_FAIL");
        emit OwnerWithdrawnWLD(to, amount);
    }

    /// 오입금 토큰 구조(만기 전, WLD 제외 권장)
    function ownerRescueUnknownERC20(address token, uint256 amount, address to)
        external onlyOwner nonReentrant
    {
        if (canClaim()) revert Expired();
        if (to == address(0)) revert InvalidAddress();
        require(IERC20(token).transfer(to, amount), "RESCUE_FAIL");
    }

    // ETH 입금 차단
    receive() external payable { revert EthNotAccepted(); }
    fallback() external payable { revert EthNotAccepted(); }
}
