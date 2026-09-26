// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./InheritanceVaultWLD.sol";
import { IERC20 } from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultWLDFactoryOnePerOwner — 각 소유자당 금고 1개
contract InheritanceVaultWLDFactoryOnePerOwner {
    event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval);
    event VaultReleased(address indexed owner, address indexed vault);

    address public immutable WLD;
    mapping(address => address) public vaultOf;

    constructor(address _wld) {
        require(_wld != address(0), "WLD=0");
        WLD = _wld;
    }

    function createVault(address heir, uint256 heartbeatInterval) external returns (address vault) {
        require(vaultOf[msg.sender] == address(0), "ALREADY_HAS_VAULT");
        vault = address(new InheritanceVaultWLD(msg.sender, heir, WLD, heartbeatInterval));
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, heir, vault, heartbeatInterval);
    }

    /// v0 호환 시그니처(0개 또는 1개)
    function vaultsOf(address owner) external view returns (address[] memory arr) {
        address v = vaultOf[owner];
        if (v == address(0)) return new address[](0);
        arr = new address[](1);
        arr[0] = v;
    }

    /// @notice 보유 금고가 비어있을 때 슬롯을 해제하여 새 금고 생성 가능하게 함
    /// @dev 금고에 WLD 잔고가 0이어야 하며, 호출자는 해당 금고의 소유자여야 합니다.
    function releaseMyVault() external returns (bool) {
        address payable v = payable(vaultOf[msg.sender]);
        require(v != address(0), "NO_VAULT");
        // 소유자 검증 (안전상 중복 확인)
        require(InheritanceVaultWLD(v).owner() == msg.sender, "NOT_OWNER");
        // 만기 확인: 기간이 지나야만 해제 가능
        require(InheritanceVaultWLD(v).canClaim(), "NOT_EXPIRED");
        // 금고가 비어있는지 확인
        address wld = InheritanceVaultWLD(v).WLD();
        require(IERC20(wld).balanceOf(v) == 0, "NON_EMPTY");
        // 슬롯 해제
        vaultOf[msg.sender] = address(0);
        emit VaultReleased(msg.sender, v);
        return true;
    }
}
