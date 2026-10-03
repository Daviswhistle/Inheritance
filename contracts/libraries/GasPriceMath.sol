// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YieldMath} from "./YieldMath.sol";

/// @notice Q96 tick pricing; constants and rounding from Uniswap v4 TickMath (MIT).
/// Source: https://github.com/Uniswap/v4-core/blob/main/src/libraries/TickMath.sol
library GasPriceMath {
    error InvalidTick();

    function sqrtAtTick(int24 tick) internal pure returns (uint160) {
        uint256 absTick = uint256(int256(tick < 0 ? -tick : tick));
        if (absTick > 887272) revert InvalidTick();
        uint256[20] memory factors = [
            uint256(0xfffcb933bd6fad37aa2d162d1a594001),
            0xfff97272373d413259a46990580e213a,
            0xfff2e50f5f656932ef12357cf3c7fdcc,
            0xffe5caca7e10e4e61c3624eaa0941cd0,
            0xffcb9843d60f6159c9db58835c926644,
            0xff973b41fa98c081472e6896dfb254c0,
            0xff2ea16466c96a3843ec78b326b52861,
            0xfe5dee046a99a2a811c461f1969c3053,
            0xfcbe86c7900a88aedcffc83b479aa3a4,
            0xf987a7253ac413176f2b074cf7815e54,
            0xf3392b0822b70005940c7a398e4b70f3,
            0xe7159475a2c29b7443b29c7fa6e889d9,
            0xd097f3bdfd2022b8845ad8f792aa5825,
            0xa9f746462d870fdf8a65dc1f90e061e5,
            0x70d869a156d2a1b890bb3df62baf32f7,
            0x31be135f97d08fd981231505542fcfa6,
            0x9aa508b5b7a84e1c677de54f3e99bc9,
            0x5d6af8dedb81196699c329225ee604,
            0x2216e584f5fa1ea926041bedfe98,
            0x48a170391f7dc42444e8fa2
        ];
        uint256 ratio = uint256(1) << 128;
        for (uint256 i; i < 20; i++) {
            if (absTick & (uint256(1) << i) != 0) ratio = (ratio * factors[i]) >> 128;
        }
        if (tick > 0) ratio = type(uint256).max / ratio;
        return uint160((ratio >> 32) + (ratio % (uint256(1) << 32) == 0 ? 0 : 1));
    }

    /// @dev ceil quote from tokenIn to tokenOut, with tokens ordered by address.
    function quoteUp(uint256 amount, int24 tick, bool zeroToOne) internal pure returns (uint256) {
        uint256 sqrt = sqrtAtTick(tick);
        if (sqrt <= type(uint128).max) {
            uint256 ratio = sqrt * sqrt;
            return zeroToOne
                ? YieldMath.mulDivUp(amount, ratio, uint256(1) << 192)
                : YieldMath.mulDivUp(amount, uint256(1) << 192, ratio);
        }
        uint256 ratio128 = YieldMath.mulDiv(sqrt, sqrt, uint256(1) << 64);
        return zeroToOne
            ? YieldMath.mulDivUp(amount, ratio128, uint256(1) << 128)
            : YieldMath.mulDivUp(amount, uint256(1) << 128, ratio128);
    }
}
