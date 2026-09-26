// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultWLD} from "./InheritanceVaultWLD.sol";
import {IERC20} from "./interfaces/IERC20Minimal.sol";

/// @title InheritanceVaultWLDFactoryOnePerOwner — 각 소유자당 금고 1개
contract InheritanceVaultWLDFactoryOnePerOwner {
    event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval);
    event VaultReleased(address indexed owner, address indexed vault);

    error NotAContract();
    error InvalidAddress();
    error AlreadyHasVault();
    error NoVault();
    error NotOwner();
    error NotExpired();
    error VaultNotEmpty();

    address public immutable WLD;
    mapping(address => address) public vaultOf;

    constructor(address _wld) {
        if (_wld == address(0)) revert InvalidAddress();
        // EOA 를 WLD 로 넘기면 금고는 생성되지만 자금을 어디로도 보낼 수 없게 된다.
        if (_wld.code.length == 0) revert NotAContract();
        WLD = _wld;
    }

    function createVault(address heir, uint256 heartbeatInterval) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert AlreadyHasVault();
        if (heir == address(0)) revert InvalidAddress();
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
    /// @dev 슬롯을 놓아버리면 그 금고는 `vaultOf` 에서 사라져 UI 에서도 보이지 않지만
    ///      컨트랙트로는 여전히 살아있다. 따라서 **해제 전에 금고가 실제로 비었는지**
    ///      확인한다. 만기 후 소유자 회수(WLD)가 막혀 있으므로 조건이 엄격하다:
    ///        - 금고가 만기되었어야 하고
    ///        - WLD 잔액이 0이어야 하고
    ///        - 강제 입금된 ETH 가 없어야 하고
    ///      그 외 잔여 자산은 `ownerRescueUnknownERC20` / `sweepEth` 로 먼저 회수한다.
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
}
