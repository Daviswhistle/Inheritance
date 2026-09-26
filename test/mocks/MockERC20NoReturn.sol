// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice 비표준 ERC20 — `transfer` 가 아무 값도 반환하지 않는다 (USDT/Binance-Peg 스타일).
/// @dev `IERC20(token).transfer(...)` 로 호출하면 ABI 디코딩에서 revert 한다.
///      {SafeERC20Lib} 는 빈 returndata 를 성공으로 취급하므로 이 토큰도 정상 동작해야 한다.
contract MockERC20NoReturn {
    string public name = "NoReturn";
    string public symbol = "NORET";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        unchecked {
            balanceOf[msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        // return 없이 종료 — USDT 스타일
    }
}
