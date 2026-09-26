// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./InheritanceVaultTokens.sol";

/// @title InheritanceVaultTokensFactory v0.1 — 허용토큰 기반 금고 팩토리
contract InheritanceVaultTokensFactory {
    event VaultCreated(
        address indexed owner,
        address indexed heir,
        address vault,
        uint256 heartbeatInterval
    );

    mapping(address => address[]) private _vaultsByOwner;

    /// @notice 허용 토큰 목록(initialAllowedTokens)과 하트비트를 지정하여 금고 생성
    function createVault(
        address heir,
        address[] calldata initialAllowedTokens,
        uint256 heartbeatInterval
    ) external returns (address vault) {
        vault = address(new InheritanceVaultTokens(msg.sender, heir, initialAllowedTokens, heartbeatInterval));
        _vaultsByOwner[msg.sender].push(vault);
        emit VaultCreated(msg.sender, heir, vault, heartbeatInterval);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsByOwner[owner];
    }
}
