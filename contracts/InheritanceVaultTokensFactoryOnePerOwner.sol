// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./InheritanceVaultTokens.sol";

/// @title InheritanceVaultTokensFactoryOnePerOwner v0.1.1
/// @notice 각 EOA(소유자)당 금고 1개만 생성 가능하도록 강제
contract InheritanceVaultTokensFactoryOnePerOwner {
    event VaultCreated(
        address indexed owner,
        address indexed heir,
        address vault,
        uint256 heartbeatInterval
    );

    // 1인 1금고
    mapping(address => address) public vaultOf;

    /// @dev 허용 토큰은 v0.1 금고와 동일 포맷(이번엔 WLD 1종만 전달 권장)
    function createVault(
        address heir,
        address[] calldata initialAllowedTokens,
        uint256 heartbeatInterval
    ) external returns (address vault) {
        require(vaultOf[msg.sender] == address(0), "ALREADY_HAS_VAULT");
        vault = address(
            new InheritanceVaultTokens(
                msg.sender,
                heir,
                initialAllowedTokens,
                heartbeatInterval
            )
        );
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
}
