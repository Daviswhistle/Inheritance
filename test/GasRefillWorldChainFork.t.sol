// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";

interface IRefillRouter {
    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256);
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory);
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

interface IRefillPool {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

/// Real deployed USDC, router and pool; balances and all transactions are fork-only.
contract GasRefillWorldChainForkTest is Test {
    address private constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant ROUTER = 0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6;
    address private constant FACTORY = 0x7a5028BDa40e7B173C278C5342087826455ea25a;
    address private constant POOL = 0x5f835420502A7702de50Cd0E78D8aA3608b2137e;
    address private constant KEEPER = 0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b;

    receive() external payable {}

    function testWorldChainRealUSDCSwapUnwrapAndFixedKeeperFunding() public {
        string memory rpc = vm.envOr("WORLDCHAIN_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 480);
        IRefillRouter router = IRefillRouter(ROUTER);
        assertEq(router.factory(), FACTORY);
        assertEq(router.WETH9(), WETH);
        IRefillPool pool = IRefillPool(POOL);
        assertEq(pool.token0(), WETH);
        assertEq(pool.token1(), USDC);
        assertEq(pool.fee(), 500);
        uint32[] memory ages = new uint32[](2);
        ages[0] = 1800;
        (int56[] memory ticks,) = pool.observe(ages);
        assertEq(ticks.length, 2);

        deal(USDC, address(this), 1_000_000);
        vm.deal(address(this), 0);
        vm.deal(KEEPER, 0);
        IERC20(USDC).approve(ROUTER, 1_000_000);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IRefillRouter.exactOutputSingle,
            (IRefillRouter.ExactOutputSingleParams(USDC, WETH, 500, ROUTER, 0.0001 ether, 1_000_000, 0))
        );
        calls[1] = abi.encodeCall(IRefillRouter.unwrapWETH9, (0.0001 ether, address(this)));
        router.multicall(block.timestamp + 300, calls);
        uint256 input = 1_000_000 - IERC20(USDC).balanceOf(address(this));
        assertGt(input, 0);
        assertLt(input, 1_000_000);
        assertGe(address(this).balance, 0.0001 ether);
        (bool sent,) = KEEPER.call{value: 0.0001 ether}("");
        assertTrue(sent);
        assertEq(KEEPER.balance, 0.0001 ether);
    }
}
