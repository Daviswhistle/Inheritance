// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 surface used by the vaults.
/// @dev Kept intentionally small. `transfer` returning `bool` is NOT relied upon
///      by the vaults — see {SafeERC20Lib} for non-standard (USDT-style) tokens
///      that return no data at all.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}
