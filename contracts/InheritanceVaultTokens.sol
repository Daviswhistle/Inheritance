// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultTokens v0.1 — 허용목록(Allowlist) 기반 ERC20 상속 금고 (기본: WLD만)
/// @notice owner가 일정 기간 ping(생존 신호)을 보내지 않으면 금고 내 "허용 토큰" 잔액을 heir에게 이전.
///         - ETH 수신 차단(우발 입금 방지)
///         - 상속인 거부 기능 없음(실수 리스크 제거)
///         - 소유자 취소(cancelInheritance) 및 연장(ping/updateHeartbeat) 가능
contract InheritanceVaultTokens {
    // ===== Errors =====
    error NotOwner();
    error InvalidAddress();
    error HeartbeatOutOfRange();
    error NotClaimableYet();  // 아직 만기 전
    error Expired();          // 만기 후(소유자 기능 금지)
    error NothingToTransfer();
    error TokenNotAllowed();
    error EthNotAccepted();

    // ===== Events =====
    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event AllowedTokenAdded(address indexed token);
    event AllowedTokenRemoved(address indexed token);
    event ClaimedToken(address indexed token, address indexed to, uint256 amount);
    event OwnerWithdrawnToken(address indexed token, address indexed to, uint256 amount);
    event InheritanceCanceled(address indexed owner);

    // ===== Storage =====
    address public immutable owner;     // 금고 소유자
    address public heir;                // 상속인
    uint256 public heartbeatInterval;   // 하트비트 최대 간격(초)
    uint256 public lastPing;            // 마지막 ping 시각

    address[] private _allowedTokens;
    mapping(address => bool) public isAllowedToken;

    // ===== Reentrancy guard =====
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

    // ===== Constants =====
    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;

    constructor(
        address _owner,
        address _heir,
        address[] memory initialAllowedTokens, // 예: [WLD]
        uint256 _heartbeatInterval
    ) {
        if (_owner == address(0) || _heir == address(0)) revert InvalidAddress();
        if (initialAllowedTokens.length == 0) revert InvalidAddress();
        if (_heartbeatInterval < MIN_HEARTBEAT || _heartbeatInterval > MAX_HEARTBEAT) {
            revert HeartbeatOutOfRange();
        }
        owner = _owner;
        heir = _heir;
        heartbeatInterval = _heartbeatInterval;
        lastPing = block.timestamp;

        // allowlist 설정
        for (uint256 i = 0; i < initialAllowedTokens.length; i++) {
            address t = initialAllowedTokens[i];
            if (t == address(0) || isAllowedToken[t]) continue;
            isAllowedToken[t] = true;
            _allowedTokens.push(t);
            emit AllowedTokenAdded(t);
        }

        emit Ping(lastPing);
    }

    // ===== Views =====
    function canClaim() public view returns (bool) {
        return block.timestamp >= lastPing + heartbeatInterval;
    }

    function timeRemaining() external view returns (uint256) {
        if (canClaim()) return 0;
        uint256 deadline = lastPing + heartbeatInterval;
        return deadline > block.timestamp ? (deadline - block.timestamp) : 0;
    }

    function allowedTokens() external view returns (address[] memory) {
        return _allowedTokens;
    }

    // ===== Owner controls =====
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
        if (_newInterval < MIN_HEARTBEAT || _newInterval > MAX_HEARTBEAT) {
            revert HeartbeatOutOfRange();
        }
        uint256 old = heartbeatInterval;
        heartbeatInterval = _newInterval;
        emit HeartbeatUpdated(old, _newInterval);
    }

    /// @notice 상속 자체를 취소(만기 전), heir=owner로 설정 → 사실상 상속 무효화
    function cancelInheritance() external onlyOwner {
        if (canClaim()) revert Expired();
        heir = owner;
        emit InheritanceCanceled(owner);
    }

    function addAllowedToken(address token) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        if (!isAllowedToken[token]) {
            isAllowedToken[token] = true;
            _allowedTokens.push(token);
            emit AllowedTokenAdded(token);
        }
    }

    function removeAllowedToken(address token) external onlyOwner {
        if (!isAllowedToken[token]) return;
        isAllowedToken[token] = false;
        uint256 len = _allowedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (_allowedTokens[i] == token) {
                _allowedTokens[i] = _allowedTokens[len - 1];
                _allowedTokens.pop();
                emit AllowedTokenRemoved(token);
                break;
            }
        }
    }

    // ===== Claim (anyone can execute) =====

    // 내부 루틴(단일 토큰 처리)
    function _claimSingle(address ta) internal returns (uint256 moved) {
        if (!isAllowedToken[ta]) revert TokenNotAllowed();
        IERC20 t = IERC20(ta);
        uint256 bal = t.balanceOf(address(this));
        if (bal > 0) {
            require(t.transfer(heir, bal), "TOKEN_TRANSFER_FAIL");
            emit ClaimedToken(ta, heir, bal);
            moved = bal;
        }
    }

    /// @notice 만기 후, 지정한 허용 토큰들을 상속 처리
    function claimTokens(address[] calldata tokens) external nonReentrant {
        if (!canClaim()) revert NotClaimableYet();
        uint256 total;
        for (uint256 i = 0; i < tokens.length; i++) {
            total += _claimSingle(tokens[i]);
        }
        if (total == 0) revert NothingToTransfer();
    }

    /// @notice 만기 후, 허용 토큰 전부 상속 처리
    function claimAllAllowed() external nonReentrant {
        if (!canClaim()) revert NotClaimableYet();
        address[] memory toks = _allowedTokens; // storage → memory 복사
        uint256 total;
        for (uint256 i = 0; i < toks.length; i++) {
            total += _claimSingle(toks[i]);
        }
        if (total == 0) revert NothingToTransfer();
    }

    // ===== Owner emergency withdraw (only before expiry) =====
    function ownerWithdrawToken(address token, uint256 amount, address to)
        external onlyOwner nonReentrant
    {
        if (canClaim()) revert Expired();           // 만기 후 소유자 회수 금지
        if (to == address(0)) revert InvalidAddress();
        if (!isAllowedToken[token]) revert TokenNotAllowed();
        require(IERC20(token).transfer(to, amount), "WITHDRAW_FAIL");
        emit OwnerWithdrawnToken(token, to, amount);
    }

    function ownerRescueUnknownERC20(address token, uint256 amount, address to)
        external onlyOwner nonReentrant
    {
        if (canClaim()) revert Expired();
        // 허용목록 체크 없이 어떤 ERC20이든 구조 (오입금 대비)
        require(IERC20(token).transfer(to, amount), "RESCUE_FAIL");
    }

    // ===== Reject ETH outright =====
    receive() external payable { revert EthNotAccepted(); }
    fallback() external payable { revert EthNotAccepted(); }
}
