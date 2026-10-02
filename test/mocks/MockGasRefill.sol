// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockGasRefillERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        emit Transfer(from, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockGasRefillWETH is MockGasRefillERC20 {
    constructor() MockGasRefillERC20("Wrapped Ether", "WETH", 18) {}

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        emit Transfer(msg.sender, address(0), amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "eth transfer");
    }
}

contract MockGasRefillFactory {
    mapping(bytes32 => address) private pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockGasRefillPool {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee = 500;
    uint160 private sqrtPriceX96;
    int24 private spotTick;
    int24 private meanTick;
    int56 private remainder;

    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    constructor(address factory_, address token0_, address token1_, uint160 sqrtPrice_, int24 tick_) {
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
        sqrtPriceX96 = sqrtPrice_;
        spotTick = tick_;
        meanTick = tick_;
    }

    function setTicks(uint160 sqrtPrice_, int24 spot_, int24 mean_, int56 remainder_) external {
        sqrtPriceX96 = sqrtPrice_;
        spotTick = spot_;
        meanTick = mean_;
        remainder = remainder_;
    }

    function liquidity() external pure returns (uint128) {
        return 1_000_000_000_000;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, spotTick, 0, 2, 2, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(secondsAgos.length == 2 && secondsAgos[0] == 1800 && secondsAgos[1] == 0, "window");
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(meanTick) * int56(uint56(1800)) + remainder;
        secondsPerLiquidityCumulativeX128s[0] = 0;
        secondsPerLiquidityCumulativeX128s[1] = uint160(1800) << 128;
    }

    function recordSwap(address sender, address recipient, int256 amount0, int256 amount1) external {
        emit Swap(sender, recipient, amount0, amount1, sqrtPriceX96, 1_000_000, spotTick);
    }
}

contract MockGasRefillRouter {
    address public immutable factory;
    address public immutable WETH9;
    uint256 public inputRate = 3_000_000_000;

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    receive() external payable {}

    function setInputRate(uint256 rate) external {
        inputRate = rate;
    }

    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results) {
        require(block.timestamp <= deadline, "deadline");
        results = new bytes[](data.length);
        for (uint256 i; i < data.length; ++i) {
            (bool ok, bytes memory returned) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly {
                    revert(add(returned, 32), mload(returned))
                }
            }
            results[i] = returned;
        }
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn) {
        require(params.fee == 500 && params.tokenOut == WETH9 && params.recipient == address(this), "route");
        // 3000 USDC per WETH, represented in raw 6 and 18 decimal units.
        amountIn = (params.amountOut * inputRate + 1 ether - 1) / 1 ether;
        require(amountIn <= params.amountInMaximum, "slippage");
        require(MockGasRefillERC20(params.tokenIn).transferFrom(msg.sender, address(this), amountIn), "input");
        MockGasRefillWETH(WETH9).mint(address(this), params.amountOut);
        address pool = MockGasRefillFactory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        bool wethIsToken0 = WETH9 < params.tokenIn;
        int256 amount0 = wethIsToken0 ? -int256(params.amountOut) : int256(amountIn);
        int256 amount1 = wethIsToken0 ? int256(amountIn) : -int256(params.amountOut);
        MockGasRefillPool(pool).recordSwap(address(this), params.recipient, amount0, amount1);
    }

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable {
        uint256 amount = MockGasRefillERC20(WETH9).balanceOf(address(this));
        require(amount >= amountMinimum, "minimum");
        MockGasRefillWETH(WETH9).withdraw(amount);
        (bool ok,) = payable(recipient).call{value: amount}("");
        require(ok, "unwrap");
    }
}
