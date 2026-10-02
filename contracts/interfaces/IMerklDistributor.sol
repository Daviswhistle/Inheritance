// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMerklDistributor {
    /// @dev Canonical getter also returns timestamp/root; only its first field is decoded.
    function claimed(address user, address token) external view returns (uint208 amount);

    function claim(
        address[] calldata users,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external;
}
