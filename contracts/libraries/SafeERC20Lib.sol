// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20Minimal.sol";

/// @title SafeERC20Lib
/// @notice Transfer helpers that tolerate non-standard ERC20 implementations.
/// @dev A plain `IERC20(token).transfer(...)` ABI-decodes the return value, so it
///      reverts on tokens that return no data (USDT, BNB) and on tokens that
///      return something other than a bool. These helpers use a low-level call
///      and treat *empty* returndata as success, which is the de-facto standard.
library SafeERC20Lib {
    error TokenTransferFailed();
    error TokenCallFailed(bytes reason);

    /// @dev Reverts if the call fails or the token explicitly reports failure.
    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    /// @dev Returns 0 rather than reverting when the token misbehaves, so a broken
    ///      token can never brick a claim for the other assets.
    function safeBalanceOf(address token, address account) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeCall(IERC20.balanceOf, (account)));
        if (!ok || ret.length < 32) return 0;
        return abi.decode(ret, (uint256));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) {
            // Bubble up the token's revert reason when there is one.
            if (ret.length > 0) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            revert TokenCallFailed(ret);
        }
        // Non-standard tokens (USDT-style) return nothing: empty returndata == success.
        if (ret.length > 0 && !abi.decode(ret, (bool))) revert TokenTransferFailed();
    }
}
