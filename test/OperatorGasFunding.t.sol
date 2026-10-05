// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OperatorGasFunding, IFundingRouter, IFundingPool} from "../contracts/OperatorGasFunding.sol";
import {GasPriceMath} from "../contracts/libraries/GasPriceMath.sol";
import {IERC20} from "../contracts/interfaces/IERC20Minimal.sol";
import {MockGasRefillERC20, MockGasRefillWETH} from "./mocks/MockGasRefill.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";

contract FundingRouterMock is IFundingRouter {
    bool public broken;

    function setBroken(bool value) external {
        broken = value;
    }

    function exactOutput(ExactOutputParams calldata p) external payable returns (uint256 input) {
        require(!broken, "swap failed");
        bytes memory path = p.path;
        address token;
        assembly ("memory-safe") {
            token := shr(96, mload(add(add(path, 32), sub(mload(path), 20))))
        }
        input = p.amountInMaximum * 997 / 1000;
        IERC20(token).transferFrom(msg.sender, address(this), input);
        IERC20(0x4200000000000000000000000000000000000006).transfer(p.recipient, p.amountOut);
    }
}

contract OperatorGasFundingTest is Test {
    OperatorGasFunding internal funding;
    address internal treasury = address(0x1111);
    address internal bot = address(0x2222);
    address internal keeper = address(0x3333);

    function setUp() public {
        vm.chainId(480);
        funding = new OperatorGasFunding(treasury, bot, keeper, 10e6);
        vm.etch(funding.USDC(), address(new MockGasRefillERC20("USDC", "USDC", 6)).code);
        vm.etch(funding.WLD(), address(new MockGasRefillERC20("WLD", "WLD", 18)).code);
        vm.etch(funding.WETH(), address(new MockGasRefillWETH()).code);
        vm.etch(funding.ROUTER(), address(new FundingRouterMock()).code);
        MockGasRefillERC20(funding.USDC()).mint(treasury, 100e6);
        MockGasRefillERC20(funding.WLD()).mint(treasury, 100 ether);
        MockGasRefillWETH(payable(funding.WETH())).mint(funding.ROUTER(), 100 ether);
        vm.deal(funding.WETH(), 100 ether);
        vm.startPrank(treasury);
        IERC20(funding.USDC()).approve(address(funding), type(uint256).max);
        IERC20(funding.WLD()).approve(address(funding), type(uint256).max);
        vm.stopPrank();
        _oracle(funding.USDC_POOL(), -197000, -197000);
        _oracle(funding.WLD_USDC_POOL(), -281850, -281850);
        _oracle(funding.WLD_ETH_POOL(), -84450, -84450);
    }

    function _oracle(address pool, int24 mean, int24 spot) internal {
        vm.mockCall(pool, abi.encodeWithSelector(IFundingPool.liquidity.selector), abi.encode(uint128(1e20)));
        int56[] memory values = new int56[](2);
        values[1] = int56(mean) * 1800;
        vm.mockCall(pool, abi.encodeWithSelector(IFundingPool.observe.selector), abi.encode(values, new uint160[](2)));
        vm.mockCall(
            pool,
            abi.encodeWithSelector(IFundingPool.slot0.selector),
            abi.encode(GasPriceMath.sqrtAtTick(spot), spot, uint16(0), uint16(2), uint16(2), uint8(0), true)
        );
    }

    function _refill(uint8 route) internal returns (uint256 input) {
        vm.prank(bot);
        return funding.refill(route, false, block.timestamp + 300);
    }

    function testUSDCSingleAtomicFundingAndRefundNoEOAAllowance() public {
        uint256 start = IERC20(funding.USDC()).balanceOf(treasury);
        uint256 input = _refill(0);
        assertEq(keeper.balance, funding.KEEPER_TARGET());
        assertEq(bot.balance, funding.BOT_TARGET());
        assertEq(start - IERC20(funding.USDC()).balanceOf(treasury), input);
        assertEq(IERC20(funding.USDC()).allowance(treasury, bot), 0);
        assertEq(IERC20(funding.USDC()).allowance(address(funding), funding.ROUTER()), 0);
        assertEq(address(funding).balance, 0);
        assertEq(IERC20(funding.USDC()).balanceOf(address(funding)), 0);
        assertEq(funding.windowSpentUSDC(), input);
    }

    function testDirectWLDFundingDoesNotDependOnUSDCETHOracle() public {
        _oracle(funding.USDC_POOL(), -197000, -196899);
        vm.expectRevert(OperatorGasFunding.PriceUnavailable.selector);
        funding.quote(0);
        vm.expectRevert(OperatorGasFunding.PriceUnavailable.selector);
        funding.quote(1);
        uint256 input = _refill(2);
        assertGt(input, 0);
        assertEq(keeper.balance, funding.KEEPER_TARGET());
        assertEq(bot.balance, funding.BOT_TARGET());
    }

    function testBothWLDRoutesFundSameRecipientsAndChargeStableBudget() public {
        uint256 start = IERC20(funding.WLD()).balanceOf(treasury);
        uint256 first = _refill(1);
        assertGt(first, 0);
        assertEq(start - IERC20(funding.WLD()).balanceOf(treasury), first);
        assertGt(funding.windowSpentUSDC(), 0);
        vm.deal(keeper, 0);
        vm.deal(bot, 0);
        uint256 second = _refill(2);
        assertGt(second, 0);
        assertEq(keeper.balance, funding.KEEPER_TARGET());
        assertEq(IERC20(funding.WLD()).allowance(address(funding), funding.ROUTER()), 0);
    }

    function testHealthyDoesNotKeepBuyingAndLowBotAloneCanRefill() public {
        _refill(0);
        vm.expectRevert(OperatorGasFunding.NothingNeeded.selector);
        _refill(0);
        vm.deal(bot, 0);
        uint256 keeperBefore = keeper.balance;
        _refill(0);
        assertEq(keeper.balance, keeperBefore);
        assertEq(bot.balance, funding.BOT_TARGET());
    }

    function testBudgetImmutablePurposeAndOwnerPauseAndAdjustment() public {
        vm.expectRevert(OperatorGasFunding.NotAuthorized.selector);
        funding.refill(0, false, block.timestamp + 300);
        vm.prank(bot);
        vm.expectRevert(OperatorGasFunding.NotAuthorized.selector);
        funding.setDailyBudget(100e6);
        vm.prank(treasury);
        funding.setDailyBudget(1);
        vm.expectRevert(OperatorGasFunding.BudgetExceeded.selector);
        _refill(0);
        vm.prank(treasury);
        funding.setDailyBudget(10e6);
        vm.prank(treasury);
        funding.setPaused(true);
        vm.expectRevert(OperatorGasFunding.InvalidConfiguration.selector);
        _refill(0);
    }

    function testBudgetWindowResetsWithoutLifetimeReapproval() public {
        (uint256 quoteMax,,,) = funding.quote(0);
        _refill(0);
        uint256 spent = funding.windowSpentUSDC();
        vm.prank(treasury);
        funding.setDailyBudget(quoteMax);
        vm.deal(keeper, 0);
        vm.deal(bot, 0);
        vm.expectRevert(OperatorGasFunding.BudgetExceeded.selector);
        _refill(0);
        vm.warp(block.timestamp + 1 days);
        _refill(0);
        assertEq(funding.windowSpentUSDC(), spent);
    }

    function testSwapFailureLeavesFundsAllowancesAndBudgetUnchanged() public {
        FundingRouterMock(funding.ROUTER()).setBroken(true);
        uint256 start = IERC20(funding.USDC()).balanceOf(treasury);
        vm.expectRevert("swap failed");
        _refill(0);
        assertEq(IERC20(funding.USDC()).balanceOf(treasury), start);
        assertEq(funding.windowSpentUSDC(), 0);
        assertEq(IERC20(funding.USDC()).allowance(address(funding), funding.ROUTER()), 0);
        assertEq(keeper.balance, 0);
    }

    function testPriceGapMissingOracleDeadlineAndDelegatedRecipientFailClosed() public {
        _oracle(funding.USDC_POOL(), -197000, -196899);
        vm.expectRevert(OperatorGasFunding.PriceUnavailable.selector);
        _refill(0);
        _oracle(funding.USDC_POOL(), -197000, -197000);
        vm.prank(bot);
        vm.expectRevert(OperatorGasFunding.ExpiredQuote.selector);
        funding.refill(0, false, block.timestamp + 301);
        vm.etch(keeper, hex"00");
        vm.expectRevert(OperatorGasFunding.InvalidConfiguration.selector);
        _refill(0);
    }

    function testOperatorReceiptFeesRedeemOnlyTreasuryShares() public {
        address strategy = funding.USDC_STRATEGY();
        vm.etch(strategy, address(new MockERC4626(funding.USDC())).code);
        MockERC4626(strategy).setRate(1 ether);
        MockERC4626(strategy).setLiquidity(type(uint256).max);
        vm.startPrank(treasury);
        IERC20(funding.USDC()).approve(strategy, 100e6);
        MockERC4626(strategy).deposit(100e6, treasury);
        IERC20(strategy).approve(address(funding), type(uint256).max);
        vm.stopPrank();
        vm.prank(bot);
        funding.refill(0, true, block.timestamp + 300);
        assertEq(keeper.balance, funding.KEEPER_TARGET());
        assertEq(IERC20(strategy).balanceOf(address(funding)), 0);
        assertEq(IERC20(funding.USDC()).allowance(treasury, bot), 0);
    }

    function testTickKnownBoundariesAndInversePrices() public pure {
        assertEq(GasPriceMath.sqrtAtTick(0), 79228162514264337593543950336);
        assertEq(GasPriceMath.sqrtAtTick(-887272), 4295128739);
        assertEq(GasPriceMath.sqrtAtTick(887272), 1461446703485210103287273052203988822378723970342);
        assertApproxEqAbs(GasPriceMath.quoteUp(1e18, -84450, true), 215e12, 2e12);
    }
}

contract OperatorGasFundingForkTest is Test {
    OperatorGasFunding internal funding;
    address internal bot = address(0x426942);
    address internal keeper = address(0x426943);

    function setUp() public {
        string memory rpc = vm.envOr("WORLDCHAIN_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, vm.envOr("WORLDCHAIN_FORK_BLOCK", uint256(35_837_437)));
        vm.deal(bot, 0);
        vm.deal(keeper, 0);
        funding = new OperatorGasFunding(address(this), bot, keeper, 10e6);
    }

    function _actual(uint8 route, bool receipt) internal {
        address token = route == 0 ? funding.USDC() : funding.WLD();
        deal(token, address(this), route == 0 ? 100e6 : 100 ether);
        if (receipt) {
            address strategy = route == 0 ? funding.USDC_STRATEGY() : funding.WLD_STRATEGY();
            IERC20(token).approve(strategy, type(uint256).max);
            IERC4626Funding(strategy).deposit(IERC20(token).balanceOf(address(this)), address(this));
            IERC20(strategy).approve(address(funding), type(uint256).max);
        } else {
            IERC20(token).approve(address(funding), type(uint256).max);
        }
        uint256 beforeGas = gasleft();
        vm.prank(bot);
        uint256 input = funding.refill(route, receipt, block.timestamp + 300);
        emit log_named_uint("real funding route", route);
        emit log_named_uint("gas used", beforeGas - gasleft());
        emit log_named_uint("actual input raw", input);
        emit log_named_uint("actual input microUSDC value", funding.windowSpentUSDC());
        assertEq(keeper.balance, funding.KEEPER_TARGET());
        assertEq(bot.balance, funding.BOT_TARGET());
        assertEq(IERC20(token).allowance(address(funding), funding.ROUTER()), 0);
        assertEq(IERC20(token).allowance(address(this), bot), 0);
    }

    function testWorldChainAtomicUSDC() public {
        _actual(0, false);
    }

    function testWorldChainAtomicWLDViaUSDC() public {
        _actual(1, false);
    }

    function testWorldChainAtomicWLDDirect() public {
        _actual(2, false);
    }

    function testWorldChainUSDCReceiptFeeFunding() public {
        _actual(0, true);
    }

    function testWorldChainWLDReceiptFeeFunding() public {
        _actual(1, true);
    }
}

interface IERC4626Funding {
    function deposit(uint256, address) external returns (uint256);
}
