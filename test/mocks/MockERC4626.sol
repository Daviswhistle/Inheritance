// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {IERC20} from "../../contracts/interfaces/IERC20Minimal.sol";
import {YieldMath} from "../../contracts/libraries/YieldMath.sol";

/// @notice Deterministic ERC-4626 with independently adjustable price and cash
/// liquidity; exercises loss recovery and in-kind inheritance, not only happy paths.
contract MockERC4626 is MockERC20 {
    address public immutable asset;
    uint256 public rate = 1 ether;
    uint256 public liquidityLimit = type(uint256).max;
    bool public brokenQuote;
    bool public brokenLiquidity;
    uint256 public fee = 0.1 ether;
    bool public consumeRedeemGas;
    bool public consumeQuoteGas;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;

    constructor(address asset_) MockERC20("Morpho WLD receipt", "mWLD") {
        asset = asset_;
    }

    function setRate(uint256 next) external {
        rate = next;
    }

    function setLiquidity(uint256 next) external {
        liquidityLimit = next;
    }

    function setBrokenQuote(bool next) external {
        brokenQuote = next;
    }

    function setBrokenLiquidity(bool next) external {
        brokenLiquidity = next;
    }

    function setGasFailure(bool redeem_, bool quote_) external {
        consumeRedeemGas = redeem_;
        consumeQuoteGas = quote_;
    }

    function setCallback(address target, bytes memory data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (consumeQuoteGas) {
            assembly {
                for {} 1 {} {}
            }
        }
        require(!brokenQuote, "quote unavailable");
        return YieldMath.mulDiv(shares, rate, 1 ether);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return YieldMath.mulDiv(assets, 1 ether, rate);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return YieldMath.mulDivUp(assets, 1 ether, rate);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function maxWithdraw(address who) public view returns (uint256) {
        require(!brokenLiquidity, "liquidity unavailable");
        uint256 available = IERC20(asset).balanceOf(address(this));
        if (available > liquidityLimit) available = liquidityLimit;
        uint256 value = convertToAssets(balanceOf[who]);
        return value < available ? value : available;
    }

    function maxRedeem(address who) external view returns (uint256) {
        uint256 liquidShares = previewDeposit(maxWithdraw(who));
        return liquidShares < balanceOf[who] ? liquidShares : balanceOf[who];
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = previewDeposit(assets);
        require(IERC20(asset).transferFrom(msg.sender, address(this), assets), "transfer");
        totalSupply += shares;
        balanceOf[receiver] += shares;
    }

    function withdraw(uint256 assets, address receiver, address owner_) external returns (uint256 shares) {
        require(assets <= maxWithdraw(owner_), "insufficient liquidity");
        shares = previewWithdraw(assets);
        _burn(owner_, shares);
        require(IERC20(asset).transfer(receiver, assets), "transfer");
        _callback();
    }

    function redeem(uint256 shares, address receiver, address owner_) external returns (uint256 assets) {
        if (consumeRedeemGas) {
            assembly {
                for {} 1 {} {}
            }
        }
        assets = convertToAssets(shares);
        require(assets <= maxWithdraw(owner_), "insufficient liquidity");
        _burn(owner_, shares);
        require(IERC20(asset).transfer(receiver, assets), "transfer");
        _callback();
    }

    function _burn(address who, uint256 shares) private {
        if (msg.sender != who) {
            require(allowance[who][msg.sender] >= shares, "allowance");
            allowance[who][msg.sender] -= shares;
        }
        require(balanceOf[who] >= shares, "balance");
        balanceOf[who] -= shares;
        totalSupply -= shares;
    }

    function _callback() private {
        if (callbackTarget != address(0)) (callbackSucceeded,) = callbackTarget.call(callbackData);
    }
}
