// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";

/// @title InheritanceVaultTokens v0.2 — 허용목록(Allowlist) 기반 ERC20 상속 금고 (기본: WLD만)
///
/// @notice owner가 일정 기간 ping(생존 신호)을 보내지 않으면 금고 내 "허용 토큰" 잔액을 heir에게 이전.
/// @dev WLD 금고와 동일한 규칙: **만기(`canClaim() == true`) 이후에는 소유자의 상태 변경이
///      전면 차단된다.** 만기 전에 owner가 `ping`/`updateHeir`/`removeAllowedToken` 로
///      금고를 되살리거나 상속인을 바꾸면 상속이 무의미해진다.
///
///      차이점: 토큰이 여러 개이므로 {claimTokens} 는 부분 회수 후 다시 호출할 수 있다.
///      따라서 만료는 순수 시간 기준이며 `claimed` 플래그로 대금을 봉쇄하지 않는다.
///      대신 만기 후 소유자가 바꿀 수 있는 것이 아무것도 없으므로, 수령인이 회수하지 못한
///      잔액은 다시 회수할 기회가 영구히 사라지지 않는다.
contract InheritanceVaultTokens {
    // ===== Errors =====
    error NotOwner();
    error InvalidAddress();
    error HeartbeatOutOfRange();
    error NotClaimableYet();
    error Expired();
    error NothingToTransfer();
    error TokenNotAllowed();
    error TokenIsAllowlisted();
    error TooManyAllowedTokens();
    error EthNotAccepted();
    error Reentrancy();

    // ===== Events =====
    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event AllowedTokenAdded(address indexed token);
    event AllowedTokenRemoved(address indexed token);
    event ClaimedToken(address indexed token, address indexed to, uint256 amount);
    event OwnerWithdrawnToken(address indexed token, address indexed to, uint256 amount);
    event UnknownERC20Rescued(address indexed token, address indexed to, uint256 amount);
    event InheritanceCanceled(address indexed owner);
    event InheritanceClaimed(address indexed recipient, uint256 totalAmount);

    // ===== Storage =====
    address public immutable owner;
    address public heir;
    uint256 public heartbeatInterval;
    uint256 public lastPing;

    address[] private _allowedTokens;
    mapping(address => bool) public isAllowedToken;

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

    // ===== Constants =====
    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;
    /// @notice `claimAllAllowed` 가 순회하는 배열의 상한 (가스 DoS 방지).
    uint256 public constant MAX_ALLOWED_TOKENS = 32;

    constructor(
        address _owner,
        address _heir,
        address[] memory initialAllowedTokens, // 예: [WLD]
        uint256 _heartbeatInterval
    ) {
        if (_owner == address(0) || _heir == address(0)) revert InvalidAddress();
        if (initialAllowedTokens.length == 0) revert InvalidAddress();
        if (initialAllowedTokens.length > MAX_ALLOWED_TOKENS) revert TooManyAllowedTokens();
        if (_heartbeatInterval < MIN_HEARTBEAT || _heartbeatInterval > MAX_HEARTBEAT) {
            revert HeartbeatOutOfRange();
        }
        owner = _owner;
        heir = _heir;
        heartbeatInterval = _heartbeatInterval;
        lastPing = block.timestamp;

        for (uint256 i = 0; i < initialAllowedTokens.length; i++) {
            address t = initialAllowedTokens[i];
            // 조용히 건너뛰지 않는다 — 0x0 이 들어간 금고는 영원히 인출 불가능해진다.
            if (t == address(0)) revert InvalidAddress();
            if (isAllowedToken[t]) continue;
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
        uint256 due = lastPing + heartbeatInterval;
        return due > block.timestamp ? (due - block.timestamp) : 0;
    }

    function deadline() external view returns (uint256) {
        return lastPing + heartbeatInterval;
    }

    function allowedTokens() external view returns (address[] memory) {
        return _allowedTokens;
    }

    // ===== Owner controls (만기 전) =====
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

    /// @notice 상속 자체를 취소(만기 전), heir=owner로 설정 → 사실상 상속 무효화
    function cancelInheritance() external onlyOwnerBeforeExpiry {
        address old = heir;
        heir = owner;
        emit HeirUpdated(old, owner);
        emit InheritanceCanceled(owner);
    }

    function addAllowedToken(address token) external onlyOwnerBeforeExpiry {
        if (token == address(0)) revert InvalidAddress();
        if (!isAllowedToken[token]) {
            if (_allowedTokens.length >= MAX_ALLOWED_TOKENS) revert TooManyAllowedTokens();
            isAllowedToken[token] = true;
            _allowedTokens.push(token);
            emit AllowedTokenAdded(token);
        }
    }

    function removeAllowedToken(address token) external onlyOwnerBeforeExpiry {
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

    // ===== Claim (만기 후 누구나 실행 가능) =====

    function _claimSingle(address ta) internal returns (uint256 moved) {
        if (!isAllowedToken[ta]) revert TokenNotAllowed();
        uint256 bal = SafeERC20Lib.safeBalanceOf(ta, address(this));
        if (bal > 0) {
            SafeERC20Lib.safeTransfer(ta, heir, bal);
            emit ClaimedToken(ta, heir, bal);
            moved = bal;
        }
    }

    /// @notice 만기 후, 지정한 허용 토큰들을 상속 처리
    function claimTokens(address[] calldata tokens) external nonReentrant {
        if (!canClaim()) revert NotClaimableYet();
        address recipient = heir;
        uint256 total;
        for (uint256 i = 0; i < tokens.length; i++) {
            total += _claimSingle(tokens[i]);
        }
        if (total == 0) revert NothingToTransfer();
        emit InheritanceClaimed(recipient, total);
    }

    /// @notice 만기 후, 허용 토큰 전부 상속 처리
    function claimAllAllowed() external nonReentrant {
        if (!canClaim()) revert NotClaimableYet();
        address recipient = heir;
        address[] memory toks = _allowedTokens; // storage → memory 복사
        uint256 total;
        for (uint256 i = 0; i < toks.length; i++) {
            total += _claimSingle(toks[i]);
        }
        if (total == 0) revert NothingToTransfer();
        emit InheritanceClaimed(recipient, total);
    }

    // ===== Owner recovery =====

    /// @notice 만기 전 소유자 긴급 회수 (허용 토큰 한정, 만기 이후 차단)
    function ownerWithdrawToken(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (canClaim()) revert Expired();
        if (to == address(0)) revert InvalidAddress();
        if (!isAllowedToken[token]) revert TokenNotAllowed();
        SafeERC20Lib.safeTransfer(token, to, amount);
        emit OwnerWithdrawnToken(token, to, amount);
    }

    /// @notice 허용목록에 *없는* 오입금 토큰 구조 (오입금 대비).
    /// @dev 만기 이후에도 호출 가능해야 한다. 만기 후 회수 경로가 없으면 잘못 전송된
    ///      토큰이 영구히 금고에 잠긴다. 허용 토큰은 여기서 회수할 수 없다.
    function ownerRescueUnknownERC20(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (isAllowedToken[token]) revert TokenIsAllowlisted();
        SafeERC20Lib.safeTransfer(token, to, amount);
        emit UnknownERC20Rescued(token, to, amount);
    }

    // ===== Reject ETH outright =====
    // WLD 금고와 동일하게 payable `fallback` 을 두지 않는다.
    receive() external payable {
        revert EthNotAccepted();
    }
}
