// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultMorpho} from "./InheritanceVaultMorpho.sol";

/// @notice Immutable constructor helper, keeping child creation code outside the
/// gateway runtime. Only that gateway can create its fixed-configuration children.
contract InheritanceVaultMorphoDeployer {
    error NotFactory();

    address public immutable factory;
    address public immutable WLD;
    address public immutable strategy;
    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;

    constructor(address wld, address strategy_, address recipient, uint256 fee) {
        factory = msg.sender;
        WLD = wld;
        strategy = strategy_;
        feeRecipient = recipient;
        performanceFeeBps = fee;
    }

    function createVault(address owner, address heir, uint256 interval) external returns (address) {
        if (msg.sender != factory) revert NotFactory();
        return address(
            new InheritanceVaultMorpho(owner, heir, WLD, interval, factory, strategy, feeRecipient, performanceFeeBps)
        );
    }
}
