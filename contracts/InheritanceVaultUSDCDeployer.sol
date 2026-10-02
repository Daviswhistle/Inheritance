// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultUSDC} from "./InheritanceVaultUSDC.sol";

/// @notice Immutable constructor helper, keeping child creation code outside the
/// gateway runtime. Only that gateway can create its fixed-configuration children.
contract InheritanceVaultUSDCDeployer {
    error NotFactory();

    address public immutable factory;
    address public immutable asset;
    address public immutable rewardToken;
    address public immutable strategy;
    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;

    constructor(address asset_, address strategy_, address rewardToken_, address recipient, uint256 fee) {
        factory = msg.sender;
        asset = asset_;
        rewardToken = rewardToken_;
        strategy = strategy_;
        feeRecipient = recipient;
        performanceFeeBps = fee;
    }

    function createVault(address owner, address heir, uint256 interval) external returns (address) {
        if (msg.sender != factory) revert NotFactory();
        return address(
            new InheritanceVaultUSDC(
                owner, heir, asset, rewardToken, interval, factory, strategy, feeRecipient, performanceFeeBps
            )
        );
    }
}
