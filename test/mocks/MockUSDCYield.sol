// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../../contracts/interfaces/IERC20Minimal.sol";

/// @notice Six-decimal local USDC token for backend adapter tests only.
contract MockUSDC {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        unchecked {
            balanceOf[from] -= amount;
        }
        balanceOf[to] += amount;
    }
}

/// @notice Test-only child with the immutable USDC adapter getters and settlement
/// event semantics expected by the keeper. It does not model production economics.
contract MockUSDCYieldVault {
    enum Settlement {
        Cash,
        Shares,
        RewardOnly,
        TotalLoss
    }

    event InheritanceFinalized(address indexed recipient, uint256 assetAmount, uint256 claimedAt);
    event InheritanceSharesFinalized(address indexed recipient, uint256 shares, uint256 claimedAt);

    address public immutable owner;
    address public immutable factory;
    address public immutable asset;
    address public immutable rewardToken;
    address public immutable strategy;
    address public heir;
    uint256 public claimFiledAt;
    uint256 public claimedAt;
    bool private ready;
    bool private assetsExist;
    Settlement private settlement;

    constructor(
        address owner_,
        address heir_,
        address factory_,
        address asset_,
        address rewardToken_,
        address strategy_
    ) {
        owner = owner_;
        heir = heir_;
        factory = factory_;
        asset = asset_;
        rewardToken = rewardToken_;
        strategy = strategy_;
    }

    function setTestState(bool ready_, bool assetsExist_, Settlement settlement_) external {
        ready = ready_;
        assetsExist = assetsExist_;
        settlement = settlement_;
        claimFiledAt = ready_ ? block.timestamp - 7 days : 0;
    }

    function claimableNow() external view returns (bool) {
        return ready && claimedAt == 0;
    }

    function hasAssets() external view returns (bool) {
        return assetsExist;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function settle() external {
        require(msg.sender == factory && ready && claimedAt == 0, "not ready");
        uint256 amount;
        if (settlement == Settlement.Cash) {
            amount = IERC20(asset).balanceOf(address(this));
            if (amount != 0) require(IERC20(asset).transfer(heir, amount), "asset transfer");
        } else if (settlement == Settlement.Shares) {
            uint256 shares = IERC20(strategy).balanceOf(address(this));
            if (shares != 0) require(IERC20(strategy).transfer(heir, shares), "share transfer");
            claimedAt = block.timestamp;
            assetsExist = false;
            emit InheritanceSharesFinalized(heir, shares, claimedAt);
            return;
        } else if (settlement == Settlement.RewardOnly) {
            uint256 reward = IERC20(rewardToken).balanceOf(address(this));
            if (reward != 0) require(IERC20(rewardToken).transfer(heir, reward), "reward transfer");
        }
        claimedAt = block.timestamp;
        assetsExist = false;
        emit InheritanceFinalized(heir, amount, claimedAt);
    }
}

/// @notice Minimal immutable source factory with the production constructor and
/// registry surface. Use only for local finalizer integration tests.
contract MockUSDCYieldFactory {
    error NotOurVault();

    address public immutable asset;
    address public immutable strategy;
    address public immutable rewardToken;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;
    mapping(address => bool) public knownVaults;
    mapping(address => address) public vaultOf;

    constructor(address asset_, address strategy_, address rewardToken_, address feeRecipient_, uint256 feeBps_) {
        asset = asset_;
        strategy = strategy_;
        rewardToken = rewardToken_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    function createVault(address heir) external returns (address vault) {
        require(vaultOf[msg.sender] == address(0), "exists");
        vault = address(new MockUSDCYieldVault(msg.sender, heir, address(this), asset, rewardToken, strategy));
        knownVaults[vault] = true;
        vaultOf[msg.sender] = vault;
    }

    function executeInheritance(address vault) external {
        if (!knownVaults[vault]) revert NotOurVault();
        MockUSDCYieldVault(vault).settle();
    }

    function setKnownVault(address vault, bool known) external {
        knownVaults[vault] = known;
    }
}
