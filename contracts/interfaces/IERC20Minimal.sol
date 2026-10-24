// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 surface used by the vaults.
/// @dev Kept intentionally small. `transfer` returning `bool` is NOT relied upon
///      by the vaults — see {SafeERC20Lib} for non-standard (USDT-style) tokens
///      that return no data at all.
interface IERC20 {
    /// @notice Return the token or share balance of the supplied account.
    function balanceOf(address account) external view returns (uint256);
    /// @notice Transfer tokens from the caller to the supplied recipient.
    function transfer(address to, uint256 value) external returns (bool);
    /// @notice Transfer tokens from an owner to a recipient using the caller's allowance.
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    /// @notice Set the caller's token allowance for the supplied spender.
    function approve(address spender, uint256 value) external returns (bool);
    /// @notice Return the spender's remaining token allowance from the supplied owner.
    function allowance(address owner, address spender) external view returns (uint256);
}
