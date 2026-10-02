// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Full-precision proportional accounting. Derived from OpenZeppelin
/// Contracts v5.4.0 Math.mulDiv (MIT, Copyright OpenZeppelin contributors).
/// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/contracts/utils/math/Math.sol
library YieldMath {
    error MulDivOverflow();

    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 low;
            uint256 high;
            assembly ("memory-safe") {
                let mm := mulmod(x, y, not(0))
                low := mul(x, y)
                high := sub(sub(mm, low), lt(mm, low))
            }
            if (high == 0) return low / denominator;
            if (denominator <= high) revert MulDivOverflow();
            uint256 remainder;
            assembly ("memory-safe") {
                remainder := mulmod(x, y, denominator)
                high := sub(high, gt(remainder, low))
                low := sub(low, remainder)
            }
            uint256 twos = denominator & (0 - denominator);
            assembly ("memory-safe") {
                denominator := div(denominator, twos)
                low := div(low, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            low |= high * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            return low * inverse;
        }
    }

    function mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        uint256 result = mulDiv(x, y, denominator);
        return result + (mulmod(x, y, denominator) == 0 ? 0 : 1);
    }
}
