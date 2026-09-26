// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultTokens} from "./InheritanceVaultTokens.sol";
import {IERC20} from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultTokensFactoryOnePerOwner v0.2
/// @notice 각 EOA(소유자)당 금고 1개만 생성 가능하도록 강제
contract InheritanceVaultTokensFactoryOnePerOwner {
    event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval);
    event VaultReleased(address indexed owner, address indexed vault);

    error AlreadyHasVault();
    error InvalidAddress();
    error NoVault();
    error NotOwner();
    error NotExpired();
    error VaultNotEmpty();
    error EthNotAccepted();

    // 1인 1금고
    mapping(address => address) public vaultOf;

    /// @dev 허용 토큰은 v0.1 금고와 동일 포맷(이번엔 WLD 1종만 전달 권장)
    function createVault(address heir, address[] calldata initialAllowedTokens, uint256 heartbeatInterval)
        external
        returns (address vault)
    {
        if (vaultOf[msg.sender] != address(0)) revert AlreadyHasVault();
        if (heir == address(0)) revert InvalidAddress();
        vault = address(new InheritanceVaultTokens(msg.sender, heir, initialAllowedTokens, heartbeatInterval));
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, heir, vault, heartbeatInterval);
    }

    /// @notice 편의를 위해 v0.1의 vaultsOf 시그니처도 유지(실제로는 0개 또는 1개만)
    function vaultsOf(address owner) external view returns (address[] memory arr) {
        address v = vaultOf[owner];
        if (v == address(0)) {
            // 🔧 빈 배열은 반드시 길이를 명시해 생성해야 합니다.
            return new address[](0);
        }
        // 🔧 단일 원소 배열
        arr = new address[](1);
        arr[0] = v;
    }

    /// @notice 금고가 만기되고 허용 토큰 잔액이 0일 때 슬롯을 해제한다.
    /// @dev WLD 팩토리와 동일한 조건 — 슬롯을 놓치면 금고가 UI 에서 사라진 채
    ///      컨트랙트 상으로만 남는다. 허용 토큰이 아닌 잔액은
    ///      `InheritanceVaultTokens.ownerRescueUnknownERC20` 로 먼저 회수할 수 있다.
    function releaseMyVault() external returns (bool) {
        address v = vaultOf[msg.sender];
        if (v == address(0)) revert NoVault();

        InheritanceVaultTokens vault = InheritanceVaultTokens(payable(v));
        if (vault.owner() != msg.sender) revert NotOwner();
        if (!vault.canClaim()) revert NotExpired();

        address[] memory toks = vault.allowedTokens();
        for (uint256 i = 0; i < toks.length; i++) {
            if (IERC20(toks[i]).balanceOf(v) != 0) revert VaultNotEmpty();
        }
        if (v.balance != 0) revert VaultNotEmpty();

        vaultOf[msg.sender] = address(0);
        emit VaultReleased(msg.sender, v);
        return true;
    }
}
