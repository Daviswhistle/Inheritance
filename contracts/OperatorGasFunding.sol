// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "./interfaces/IERC4626Minimal.sol";
import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";
import {YieldMath} from "./libraries/YieldMath.sol";
import {GasPriceMath} from "./libraries/GasPriceMath.sol";

interface IFundingPool {
    function observe(uint32[] calldata) external view returns (int56[] memory, uint160[] memory);
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
    function liquidity() external view returns (uint128);
}

interface IFundingRouter {
    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactOutput(ExactOutputParams calldata) external payable returns (uint256 amountIn);
}

interface IFundingWETH {
    function withdraw(uint256) external;
}

/// @notice Only operator funds, only fixed gas recipients, in one atomic transaction.
/// Bot never has treasury allowance. There is no customer-vault or arbitrary-call surface.
contract OperatorGasFunding {
    error NotAuthorized();
    error InvalidConfiguration();
    error PriceUnavailable();
    error BudgetExceeded();
    error NothingNeeded();
    error ExpiredQuote();
    error TransferFailed();
    error Reentrancy();
    error InvalidBalance();

    address public constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address public constant WLD = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant ROUTER = 0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6;
    address public constant USDC_POOL = 0x5f835420502A7702de50Cd0E78D8aA3608b2137e;
    address public constant WLD_USDC_POOL = 0x02371da6173CF95623Da4189E68912233cc7107C;
    address public constant WLD_ETH_POOL = 0x494D68e3cAb640fa50F4c1B3E2499698D1a173A0;
    address public constant USDC_STRATEGY = 0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B;
    address public constant WLD_STRATEGY = 0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f;
    uint256 public constant KEEPER_LOW = 0.00002 ether;
    uint256 public constant KEEPER_TARGET = 0.001 ether;
    uint256 public constant BOT_LOW = 0.00002 ether;
    uint256 public constant BOT_TARGET = 0.0001 ether;
    uint256 public constant MAX_GAS_PRICE = 0.05 gwei;
    uint256 public constant TWAP_WINDOW = 30 minutes;
    uint256 public constant MAX_TICK_GAP = 100;

    address public immutable treasury;
    address public immutable bot;
    address public immutable keeper;
    uint256 public dailyBudgetUSDC;
    uint256 public windowStartedAt;
    uint256 public windowSpentUSDC;
    bool public paused;
    uint256 private locked = 1;

    struct FundingPlan {
        uint256 inputMax;
        uint256 costMax;
        uint256 keeperETH;
        uint256 botETH;
        uint256 beforeCash;
        uint256 beforeWETH;
        uint256 beforeETH;
        address token;
    }

    event Funded(
        uint8 indexed route, bool receiptSource, uint256 input, uint256 costUSDC, uint256 keeperETH, uint256 botETH
    );
    event BudgetUpdated(uint256 dailyBudgetUSDC);
    event PauseUpdated(bool paused);

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address treasury_, address bot_, address keeper_, uint256 budget_) {
        if (
            block.chainid != 480 || treasury_ == address(0) || bot_ == address(0) || keeper_ == address(0)
                || treasury_ == bot_ || treasury_ == keeper_ || bot_ == keeper_ || bot_.code.length != 0
                || keeper_.code.length != 0 || budget_ == 0
        ) revert InvalidConfiguration();
        treasury = treasury_;
        bot = bot_;
        keeper = keeper_;
        dailyBudgetUSDC = budget_;
    }

    function setDailyBudget(uint256 amount) external onlyTreasury {
        dailyBudgetUSDC = amount;
        emit BudgetUpdated(amount);
    }

    function setPaused(bool value) external onlyTreasury {
        paused = value;
        emit PauseUpdated(value);
    }

    function needed() public view returns (uint256 keeperETH, uint256 botETH) {
        if (keeper.balance >= KEEPER_LOW && bot.balance >= BOT_LOW) return (0, 0);
        keeperETH = keeper.balance < KEEPER_TARGET ? KEEPER_TARGET - keeper.balance : 0;
        botETH = bot.balance < BOT_TARGET ? BOT_TARGET - bot.balance : 0;
    }

    function remainingBudget() public view returns (uint256) {
        uint256 spent = block.timestamp >= windowStartedAt + 1 days ? 0 : windowSpentUSDC;
        return spent < dailyBudgetUSDC ? dailyBudgetUSDC - spent : 0;
    }

    /// @param route 0=USDC/ETH; 1=WLD/USDC/ETH; 2=WLD/ETH.
    function quote(uint8 route)
        public
        view
        returns (uint256 inputMax, uint256 costUSDC, uint256 keeperETH, uint256 botETH)
    {
        (keeperETH, botETH) = needed();
        uint256 output = keeperETH + botETH;
        if (route > 2) revert InvalidConfiguration();
        if (output == 0) return (0, 0, 0, 0);
        if (route == 2) {
            inputMax = _inputFor(output, WETH, WLD, WLD_ETH_POOL, 3000);
        } else {
            uint256 stable = _inputFor(output, WETH, USDC, USDC_POOL, 500);
            if (route == 0) return (stable, stable, keeperETH, botETH);
            inputMax = _inputFor(stable, USDC, WLD, WLD_USDC_POOL, 500);
        }
        costUSDC = _convert(inputMax, WLD, USDC, _tick(WLD_USDC_POOL));
    }

    /// @notice No caller-supplied price, recipient, spending amount or calldata.
    function refill(uint8 route, bool receiptSource, uint256 deadline) external nonReentrant returns (uint256 input) {
        if (msg.sender != bot && msg.sender != treasury) revert NotAuthorized();
        if (paused || tx.gasprice > MAX_GAS_PRICE || bot.code.length != 0 || keeper.code.length != 0) {
            revert InvalidConfiguration();
        }
        if (deadline < block.timestamp || deadline > block.timestamp + 5 minutes) revert ExpiredQuote();
        FundingPlan memory p;
        (p.inputMax, p.costMax, p.keeperETH, p.botETH) = quote(route);
        if (p.inputMax == 0) revert NothingNeeded();
        if (p.costMax > remainingBudget()) revert BudgetExceeded();
        p.token = route == 0 ? USDC : WLD;
        p.beforeCash = IERC20(p.token).balanceOf(address(this));
        p.beforeWETH = IERC20(WETH).balanceOf(address(this));
        p.beforeETH = address(this).balance;
        if (receiptSource) _withdrawReceipt(p.token, p.inputMax);
        else SafeERC20Lib.safeTransferFrom(p.token, treasury, address(this), p.inputMax);
        if (IERC20(p.token).balanceOf(address(this)) != p.beforeCash + p.inputMax) revert InvalidBalance();
        _approve(p.token, p.inputMax);
        input = IFundingRouter(ROUTER).exactOutput(
            IFundingRouter.ExactOutputParams({
                path: _path(route),
                recipient: address(this),
                amountOut: p.keeperETH + p.botETH,
                amountInMaximum: p.inputMax
            })
        );
        _approve(p.token, 0);
        if (
            input == 0 || input > p.inputMax
                || IERC20(WETH).balanceOf(address(this)) != p.beforeWETH + p.keeperETH + p.botETH
                || IERC20(p.token).balanceOf(address(this)) != p.beforeCash + p.inputMax - input
        ) revert InvalidBalance();
        uint256 cost = route == 0 ? input : _convert(input, WLD, USDC, _tick(WLD_USDC_POOL));
        if (cost > p.costMax || cost > remainingBudget()) revert BudgetExceeded();
        if (block.timestamp >= windowStartedAt + 1 days) {
            windowStartedAt = block.timestamp;
            windowSpentUSDC = 0;
        }
        windowSpentUSDC += cost;
        if (p.inputMax > input) SafeERC20Lib.safeTransfer(p.token, treasury, p.inputMax - input);
        IFundingWETH(WETH).withdraw(p.keeperETH + p.botETH);
        _pay(keeper, p.keeperETH);
        _pay(bot, p.botETH);
        if (
            address(this).balance != p.beforeETH || IERC20(p.token).balanceOf(address(this)) != p.beforeCash
                || IERC20(WETH).balanceOf(address(this)) != p.beforeWETH
        ) revert InvalidBalance();
        emit Funded(route, receiptSource, input, cost, p.keeperETH, p.botETH);
    }

    function _withdrawReceipt(address token, uint256 amount) private {
        address strategy = token == USDC ? USDC_STRATEGY : WLD_STRATEGY;
        uint256 shares = IERC4626Minimal(strategy).previewWithdraw(amount);
        uint256 beforeShares = IERC20(strategy).balanceOf(address(this));
        SafeERC20Lib.safeTransferFrom(strategy, treasury, address(this), shares);
        if (IERC20(strategy).balanceOf(address(this)) != beforeShares + shares) revert InvalidBalance();
        IERC4626Minimal(strategy).withdraw(amount, address(this), address(this));
        uint256 remaining = IERC20(strategy).balanceOf(address(this));
        if (remaining < beforeShares || remaining > beforeShares + shares) revert InvalidBalance();
        if (remaining > beforeShares) SafeERC20Lib.safeTransfer(strategy, treasury, remaining - beforeShares);
    }

    function _path(uint8 route) private pure returns (bytes memory) {
        if (route == 0) return abi.encodePacked(WETH, uint24(500), USDC);
        if (route == 1) return abi.encodePacked(WETH, uint24(500), USDC, uint24(500), WLD);
        return abi.encodePacked(WETH, uint24(3000), WLD);
    }

    function _inputFor(uint256 output, address outToken, address inToken, address pool, uint256 fee)
        private
        view
        returns (uint256)
    {
        uint256 input = _convert(output, outToken, inToken, _tick(pool));
        // Pool fee plus 0.5% execution tolerance, each hop; all ceil rounding.
        return YieldMath.mulDivUp(YieldMath.mulDivUp(input, 1_000_000, 1_000_000 - fee), 10_050, 10_000);
    }

    function _convert(uint256 amount, address input, address output, int24 tick) private pure returns (uint256) {
        return GasPriceMath.quoteUp(amount, tick, input < output);
    }

    function _tick(address pool) private view returns (int24 tick) {
        if (IFundingPool(pool).liquidity() == 0) revert PriceUnavailable();
        uint32[] memory times = new uint32[](2);
        times[0] = uint32(TWAP_WINDOW);
        (int56[] memory cumulatives,) = IFundingPool(pool).observe(times);
        if (cumulatives.length != 2) revert PriceUnavailable();
        int56 delta = cumulatives[1] - cumulatives[0];
        int56 mean = delta / int56(uint56(TWAP_WINDOW));
        if (delta < 0 && delta % int56(uint56(TWAP_WINDOW)) != 0) mean--;
        if (mean < -887272 || mean > 887272) revert PriceUnavailable();
        tick = int24(mean);
        (, int24 spot,,,,,) = IFundingPool(pool).slot0();
        int256 gap = int256(spot) - int256(tick);
        if (gap > int256(MAX_TICK_GAP) || gap < -int256(MAX_TICK_GAP)) revert PriceUnavailable();
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _approve(address token, uint256 amount) private {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(IERC20.approve, (ROUTER, amount)));
        if (!ok || result.length > 0 && !abi.decode(result, (bool))) revert TransferFailed();
    }

    /// @notice Treasury can recover its own accidental deposits, never customer vault funds.
    function recover(address token) external onlyTreasury nonReentrant {
        if (token == address(0)) _pay(treasury, address(this).balance);
        else SafeERC20Lib.safeTransfer(token, treasury, IERC20(token).balanceOf(address(this)));
    }

    receive() external payable {
        if (msg.sender != WETH) revert NotAuthorized();
    }
}
