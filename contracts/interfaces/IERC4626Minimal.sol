// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The ERC-4626 surface used by the immutable Morpho V1 integration.
interface IERC4626Minimal {
    /// @notice Return the ERC4626 vault's underlying asset address.
    function asset() external view returns (address);
    /// @notice Return the token or share balance of the supplied account.
    function balanceOf(address) external view returns (uint256);
    /// @notice Estimate underlying assets represented by the supplied share amount.
    function convertToAssets(uint256 shares) external view returns (uint256);
    /// @notice Estimate shares minted for an underlying-asset deposit.
    function previewDeposit(uint256 assets) external view returns (uint256);
    /// @notice Estimate shares required to withdraw the requested underlying assets.
    function previewWithdraw(uint256 assets) external view returns (uint256);
    /// @notice Estimate underlying assets returned by redeeming the supplied shares.
    function previewRedeem(uint256 shares) external view returns (uint256);
    /// @notice Return the maximum underlying amount currently withdrawable by the owner.
    function maxWithdraw(address owner) external view returns (uint256);
    /// @notice Return the maximum share amount currently redeemable by the owner.
    function maxRedeem(address owner) external view returns (uint256);
    /// @notice Deposit underlying assets and mint shares to the supplied receiver.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    /// @notice Withdraw the specified assets under the external token or vault interface's authorization rules.
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    /// @notice Redeem shares from the owner to the receiver under the vault's allowance rules.
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}
