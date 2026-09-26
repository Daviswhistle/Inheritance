// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultWLD} from "./InheritanceVaultWLD.sol";
import {IERC20} from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultWLDFactoryOnePerOwner — 각 소유자당 금고 1개
///
/// @notice 이 팩토리는 두 가지 역할을 한다.
///   1. 소유자당 금고 1개를 생성하고 위치를 알려준다.
///   2. **금고 주소로 향하는 모든 사용자 액션을 중계한다.**
///
/// @dev 왜 2번이 필요한가 — World App 의 Mini App 은 전송 전에 대상 컨트랙트를
///      allowlist 로 검사하고, 목록에 없는 컨트랙트를 건드리면 백엔드가
///      `invalid_contract` 로 막는다. 그런데 각 사용자의 금고는
///      `new InheritanceVaultWLD(...)` 로 만들어지므로 **주소 사용자에게 따라
///      달라지고, 사전에 목록에 넣을 수 없다.** 사용자가 늘어날수록 목록이
///      무한히 커지고, 개발자가 열거할 수도 없다.
///
///      이 중계는 그 문제를 없애기 위해 존재한다. 앱이 직접 호출하는 주소는
///      이 팩토리 **한 곳**과 WLD 토큰 **한 곳**뿐이고, 둘 다 고정 주소다.
///      금고는 calldata 안의 주소로만 전달되며, 팩토리가 호출자가 실제로 그
///      금고의 주인이거나 상속자인지 매번 검증한다.
///
///      즉 앱이 우회할 수 있는 경로는 없고, 중계가 권한을 넓혀주지도 않는다.
///      팩토리 자체에는 owner/admin/upgrade 권한이 전혀 없다.
contract InheritanceVaultWLDFactoryOnePerOwner {
    event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval);
    event VaultReleased(address indexed owner, address indexed vault);

    error NotAContract();
    error InvalidAddress();
    error AlreadyHasVault();
    error NoVault();
    error NotOwner();
    error NotHeir();
    error NotExpired();
    error VaultNotEmpty();

    /// @notice 상속 대상 토큰 (고정).
    address public immutable WLD;
    /// @notice 소유자별 금고 주소. 0 이면 금고가 없다.
    mapping(address => address) public vaultOf;

    /// @param _wld 상속 대상 토큰 주소
    constructor(address _wld) {
        if (_wld == address(0)) revert InvalidAddress();
        // EOA 를 WLD 로 넘기면 금고는 생성되지만 자금을 어디로도 보낼 수 없게 된다.
        if (_wld.code.length == 0) revert NotAContract();
        WLD = _wld;
    }

    // ===== Vault lifecycle =====

    /// @notice 내가 소유할 금고를 만든다. 소유자당 1개.
    /// @param heir 상속인 주소
    /// @param heartbeatInterval 갱신 주기(초)
    /// @return vault 생성된 금고 주소
    function createVault(address heir, uint256 heartbeatInterval) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert AlreadyHasVault();
        if (heir == address(0)) revert InvalidAddress();
        vault = address(new InheritanceVaultWLD(msg.sender, heir, WLD, heartbeatInterval, address(this)));
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, heir, vault, heartbeatInterval);
    }

    /// @notice 내가 보유한 금고의 주소를 돌려준다. 금고가 없으면 0.
    function myVault() external view returns (address) {
        return vaultOf[msg.sender];
    }

    /// @notice v0 호환 시그니처(0개 또는 1개)
    function vaultsOf(address owner) external view returns (address[] memory arr) {
        address v = vaultOf[owner];
        if (v == address(0)) return new address[](0);
        arr = new address[](1);
        arr[0] = v;
    }

    /// @notice 보유 금고가 비어있을 때 슬롯을 해제하여 새 금고 생성 가능하게 함
    /// @dev 슬롯을 놓아버리면 그 금고는 `vaultOf` 에서 사라져 UI 에서도 보이지 않지만
    ///      컨트랙트로는 여전히 살아있다. 따라서 **해제 전에 금고가 실제로 비었는지**
    ///      확인한다. 상속이 진행 중이면 해제하지 않는다:
    ///        - 금고가 정산되었어야 하고 (만료·신청·완료 중 하나)
    ///        - WLD 잔액이 0이어야 하고
    ///        - 강제 입금된 ETH 가 없어야 하고
    function releaseMyVault() external returns (bool) {
        address v = vaultOf[msg.sender];
        if (v == address(0)) revert NoVault();

        InheritanceVaultWLD vault = InheritanceVaultWLD(payable(v));
        if (vault.owner() != msg.sender) revert NotOwner();
        if (!vault.isSettled()) revert NotExpired();
        if (IERC20(WLD).balanceOf(v) != 0) revert VaultNotEmpty();
        if (v.balance != 0) revert VaultNotEmpty();

        vaultOf[msg.sender] = address(0);
        emit VaultReleased(msg.sender, v);
        return true;
    }

    // ===== Owner routing =====

    /// @notice 내 금고에 WLD 를 입금한다.
    /// @dev 앱이 `WLD.transfer(vault, amount)` 로 직접 보내면 전송의 **대상**은 토큰이지만
    ///      **수신자**가 사용자마다 다른 금고가 된다. 이 함수를 쓰면 대상과 calldata 안의
    ///      수신자 모두 이 팩토리와 고정 토큰으로만 이루어진다.
    ///      선행 ERC-20 `approve` 가 필요하다 — 월드앱은 전송 직후 승인을 자동 철회하므로
    ///      승인과 이 호출을 한 트랜잭션에 묶으면 된다.
    /// @param amount 입금할 WLD 양 ( wad 단위)
    function deposit(uint256 amount) external {
        address v = _myVault();
        IERC20(WLD).transferFrom(msg.sender, v, amount);
    }

    /// @notice 내 금고의 생존 신호를 보낸다(갱신 기한 연장). 이의제기 기간 중이면 청산 신청이 취소된다.
    function pingMyVault() external {
        InheritanceVaultWLD(payable(_myVault())).ping();
    }

    /// @notice 내 금고의 상속인을 바꾼다.
    function updateMyHeir(address newHeir) external {
        InheritanceVaultWLD(payable(_myVault())).updateHeir(newHeir);
    }

    /// @notice 내 금고의 갱신 주기를 바꾼다.
    function changeMyPeriod(uint256 newInterval) external {
        InheritanceVaultWLD(payable(_myVault())).updateHeartbeat(newInterval);
    }

    /// @notice 내 금고의 상속을 취소한다.
    function cancelMyInheritance() external {
        InheritanceVaultWLD(payable(_myVault())).cancelInheritance();
    }

    /// @notice 내 금고에서 WLD 를 회수한다(갱신 기한 전 한정).
    function withdrawFromMyVault(address to, uint256 amount) external {
        InheritanceVaultWLD(payable(_myVault())).ownerWithdrawWLD(amount, to);
    }

    /// @param token 회수할 토큰 주소 (WLD 불가)
    /// @param amount 회수할 양
    /// @param to 수신 주소
    function rescueFromMyVault(address token, uint256 amount, address to) external {
        InheritanceVaultWLD(payable(_myVault())).ownerRescueUnknownERC20(token, amount, to);
    }

    /// @notice 내 금고에 강제 입금된 ETH 를 회수한다.
    function sweepEthFromMyVault(address payable to) external {
        InheritanceVaultWLD(payable(_myVault())).sweepEth(to);
    }

    // ===== Heir routing =====
    // 상속인은 금고의 주인이 아니므로 `vaultOf` 로 금고를 찾을 수 없다.
    // 앱은 (allowlist 에 없는 금고 주소를 넘기지 않고) calldata 로 금고 주소를
    // 전달하고, 팩토리가 호출자가 그 금고의 상속인인지 확인한다.

    /// @notice 상속인이 만료된 금고에 상속을 신청한다. 자금은 아직 이동하지 않는다.
    /// @param vault 신청 대상 금고 주소
    function fileClaimFor(address vault) external {
        if (InheritanceVaultWLD(payable(vault)).heir() != msg.sender) revert NotHeir();
        InheritanceVaultWLD(payable(vault)).fileClaim();
    }

    /// @notice 상속인이 이의제기 기간이 지난 뒤 최종 수령을 실행한다.
    /// @param vault 수령 대상 금고 주소
    function finalizeClaimFor(address vault) external {
        if (InheritanceVaultWLD(payable(vault)).heir() != msg.sender) revert NotHeir();
        InheritanceVaultWLD(payable(vault)).finalizeClaim();
    }

    /// @notice 내가 상속인으로 지정된 모든 금고 중 상속이 진행 중인 것만 골라낸다.
    /// @dev 소유자 지분은 각 금고 안의 `owner` 로부터 읽어온다 — 승인 없이 못 믿기 때문에
    ///      `vaultsOf` 로 찾는 대신 체인 스캔이 필요하며, 이는 앱의 책임이다.
    ///      이 함수는 팩토리가 가진 정보만 반환하는 조회 헬퍼다.
    function isHeirOf(address owner, address vault) external view returns (bool) {
        return vaultOf[owner] == vault && InheritanceVaultWLD(payable(vault)).heir() == msg.sender;
    }

    // ===== Internals =====

    function _myVault() internal view returns (address) {
        address v = vaultOf[msg.sender];
        if (v == address(0)) revert NoVault();
        return v;
    }
}
