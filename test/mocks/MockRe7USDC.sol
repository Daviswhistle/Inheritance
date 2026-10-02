// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {MockERC4626} from "./MockERC4626.sol";

contract MockUSDC is MockERC20 {
    constructor() MockERC20("USD Coin", "USDC") {
        decimals = 6;
    }
}

/// @notice 6-decimal asset / 18-decimal receipt shares: initially 1 USDC per share.
/// The parent price and liquidity controls preserve these independent units.
contract MockRe7USDC is MockERC4626 {
    constructor(address asset_) MockERC4626(asset_) {
        name = "Re7 USDC receipt";
        symbol = "re7USDC";
        rate = 1e6;
    }
}
