// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "./interfaces/IERC4626Minimal.sol";
import {IMerklDistributor} from "./interfaces/IMerklDistributor.sol";
import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";
import {YieldMath} from "./libraries/YieldMath.sol";

/// @notice Immutable USDC inheritance with ERC-4626 yield and separate WLD rewards.
/// Positive realized USDC gains and canonical WLD rewards have separate fees.
/// WLD is held until withdrawal or inheritance; no swap, oracle or compounding.
/// Direct USDC, WLD and receipt-share gifts are not fee-bearing.
contract InheritanceVaultUSDC {
    error NotOwner();
    error NotHeir();
    error InvalidAddress();
    error InvalidStrategy();
    error InvalidFee();
    error InvalidAmount();
    error InvalidRewards();
    error SlippageExceeded();
    error Expired();
    error AlreadyClaimed();
    error AlreadyFiled();
    error NotExpiredYet();
    error ChallengeStillRunning();
    error NothingToTransfer();
    error NotSettled();
    error HeartbeatOutOfRange();
    error ProtectedToken();
    error Reentrancy();
    error EthNotAccepted();
    error EthTransferFailed();

    event Ping(uint256 timestamp);
    event HeirUpdated(address indexed oldHeir, address indexed newHeir);
    event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval);
    event ClaimFiled(address indexed by, uint256 filedAt, uint256 challengeEndsAt);
    event ClaimWithdrawn(address indexed by);
    event InheritanceCanceled(address indexed owner);
    event Deposited(uint256 assets, uint256 shares);
    /// @notice Amount is WLD, shares is always zero for this vault.
    event RewardsClaimed(uint256 amount, uint256 shares, address indexed recipient);
    event RewardsWithdrawn(address indexed to, uint256 amount);
    event RewardFeePaid(address indexed recipient, uint256 amount);
    /// @notice Asset amounts are USDC; receipt shares represent only USDC yield.
    event PerformanceFeePaid(address indexed recipient, uint256 assets, uint256 shares);
    event OwnerWithdrawnAsset(address indexed to, uint256 amount);
    event SharesWithdrawn(address indexed to, uint256 shares);
    event InheritanceFinalized(address indexed recipient, uint256 assetAmount, uint256 claimedAt);
    event InheritanceSharesFinalized(address indexed recipient, uint256 shares, uint256 claimedAt);

    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant MIN_HEARTBEAT = 1 days;
    uint256 public constant MAX_HEARTBEAT = 365 days;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 1000;
    uint256 public constant AUTOMATIC_REDEEM_GAS = 300_000;
    uint256 public constant SHARE_VALUATION_GAS = 150_000;
    address public constant MERKL_DISTRIBUTOR = 0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae;
    address public immutable owner;
    address public immutable factory;
    address public immutable asset;
    address public immutable rewardToken;
    IERC4626Minimal public immutable strategy;
    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;
    address public heir;
    uint256 public heartbeatInterval;
    uint256 public lastPing;
    uint256 public claimFiledAt;
    uint256 public claimedAt;
    address public inheritanceRecipient;
    /// @notice Remaining deposited USDC allocated to fee-bearing receipt shares.
    uint256 public costBasis;
    uint256 public accountedShares;
    /// @notice Closed USDC losses offset subsequent USDC gains only.
    uint256 public realizedLoss;
    /// @dev Cumulative canonical WLD rewards already paid; never USDC capital.
    uint256 private accountedRewards;
    uint256 private locked = 1;

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    modifier onlyOwnerOrFactory() {
        if (msg.sender != owner && msg.sender != factory) revert NotOwner();
        _;
    }

    modifier activeOwner() {
        if (claimedAt != 0 || !ownerStillActive()) revert Expired();
        _;
    }

    modifier withdrawableOwner() {
        if (claimedAt != 0 || (!ownerStillActive() && !inheritanceCancelled())) revert Expired();
        _;
    }

    constructor(
        address owner_,
        address heir_,
        address asset_,
        address rewardToken_,
        uint256 interval_,
        address factory_,
        address strategy_,
        address feeRecipient_,
        uint256 feeBps_
    ) {
        if (
            owner_ == address(0) || owner_ == address(this) || heir_ == address(0) || heir_ == address(this)
                || factory_ == address(0) || feeRecipient_ == address(0) || feeRecipient_ == address(this)
        ) revert InvalidAddress();
        if (
            asset_.code.length == 0 || strategy_.code.length == 0 || rewardToken_.code.length == 0
                || strategy_ == asset_ || rewardToken_ == asset_ || rewardToken_ == strategy_
                || IERC4626Minimal(strategy_).asset() != asset_
        ) revert InvalidStrategy();
        if (interval_ < MIN_HEARTBEAT || interval_ > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        if (feeBps_ > MAX_PERFORMANCE_FEE_BPS) revert InvalidFee();
        owner = owner_;
        heir = heir_;
        asset = asset_;
        rewardToken = rewardToken_;
        factory = factory_;
        strategy = IERC4626Minimal(strategy_);
        feeRecipient = feeRecipient_;
        performanceFeeBps = feeBps_;
        heartbeatInterval = interval_;
        lastPing = block.timestamp;
        emit Ping(lastPing);
    }

    function deadline() public view returns (uint256) {
        return lastPing + heartbeatInterval;
    }

    function ownerStillActive() public view returns (bool) {
        return claimedAt == 0 && claimFiledAt == 0 && block.timestamp < deadline();
    }

    function isExpired() public view returns (bool) {
        return claimedAt == 0 && claimFiledAt == 0 && block.timestamp >= deadline();
    }

    function inheritanceCancelled() public view returns (bool) {
        return heir != address(0) && heir == owner;
    }

    function claimPending() external view returns (bool) {
        return claimFiledAt != 0;
    }

    function challengeEndsAt() public view returns (uint256) {
        return claimFiledAt == 0 ? 0 : claimFiledAt + CHALLENGE_PERIOD;
    }

    function challengeRunning() public view returns (bool) {
        return claimFiledAt != 0 && block.timestamp < challengeEndsAt();
    }

    function claimableNow() public view returns (bool) {
        return claimedAt == 0 && claimFiledAt != 0 && block.timestamp >= challengeEndsAt();
    }

    function timeRemaining() external view returns (uint256) {
        if (claimedAt != 0 || claimFiledAt != 0 || block.timestamp >= deadline()) return 0;
        return deadline() - block.timestamp;
    }

    function isSettled() external view returns (bool) {
        return claimedAt != 0 || isExpired() || claimFiledAt != 0;
    }

    function hasAssets() external view returns (bool) {
        return IERC20(asset).balanceOf(address(this)) != 0 || strategy.balanceOf(address(this)) != 0
            || IERC20(rewardToken).balanceOf(address(this)) != 0;
    }

    /// @notice USDC units only; WLD rewards are excluded from this valuation.
    function totalAssets() public view returns (uint256) {
        uint256 shares = strategy.balanceOf(address(this));
        return IERC20(asset).balanceOf(address(this)) + (shares == 0 ? 0 : strategy.convertToAssets(shares));
    }

    /// @notice USDC estimate and receipt shares; cash liquidity is independent.
    function position()
        external
        view
        returns (uint256 idle, uint256 shares, uint256 gross, uint256 net, uint256 fee, uint256 liquid, bool valued)
    {
        idle = IERC20(asset).balanceOf(address(this));
        shares = strategy.balanceOf(address(this));
        gross = idle;
        liquid = idle;
        valued = shares == 0;
        if (shares != 0) {
            try strategy.convertToAssets(shares) returns (uint256 value) {
                gross += value;
                fee = _exitFee(shares, shares, value);
                valued = true;
            } catch { /* Shares remain transferable when a quote fails. */ }
            try strategy.maxWithdraw(address(this)) returns (uint256 available) {
                liquid += available;
            } catch { /* Unknown liquidity must not appear withdrawable. */ }
        }
        net = gross - fee;
    }

    /// @notice WLD units only; gifts are held but are not fee-bearing rewards.
    function rewardPosition() external view returns (uint256 held, uint256 feeBearing, uint256 net, uint256 fee) {
        held = IERC20(rewardToken).balanceOf(address(this));
        feeBearing = unprocessedRewards();
        if (feeBearing > held) revert InvalidRewards();
        fee = YieldMath.mulDiv(feeBearing, performanceFeeBps, 10_000);
        net = held - fee;
    }

    /// @notice Canonical cumulative WLD, including delivery by external operators.
    function totalRewardsClaimed() public view returns (uint256) {
        return IMerklDistributor(MERKL_DISTRIBUTOR).claimed(address(this), rewardToken);
    }

    function unprocessedRewards() public view returns (uint256) {
        return totalRewardsClaimed() - accountedRewards;
    }

    function ping() external onlyOwnerOrFactory nonReentrant {
        if (claimedAt != 0) revert Expired();
        lastPing = block.timestamp;
        if (claimFiledAt != 0) {
            claimFiledAt = 0;
            emit ClaimWithdrawn(owner);
        }
        emit Ping(lastPing);
    }

    function updateHeir(address next) external onlyOwnerOrFactory activeOwner {
        _validRecipient(next);
        emit HeirUpdated(heir, next);
        heir = next;
    }

    function updateHeartbeat(uint256 interval_) external onlyOwnerOrFactory activeOwner {
        if (interval_ < MIN_HEARTBEAT || interval_ > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        emit HeartbeatUpdated(heartbeatInterval, interval_);
        heartbeatInterval = interval_;
    }

    function cancelInheritance() external onlyOwnerOrFactory activeOwner {
        emit HeirUpdated(heir, owner);
        heir = owner;
        emit InheritanceCanceled(owner);
    }

    /// @dev Factory transfers exactly these USDC assets first; gifts stay idle.
    function invest(uint256 assets, uint256 minShares) external nonReentrant activeOwner {
        if (msg.sender != factory) revert NotOwner();
        if (assets == 0 || minShares == 0) revert InvalidAmount();
        uint256 beforeShares = strategy.balanceOf(address(this));
        if (!IERC20(asset).approve(address(strategy), assets)) revert InvalidStrategy();
        uint256 minted = strategy.deposit(assets, address(this));
        if (!IERC20(asset).approve(address(strategy), 0)) revert InvalidStrategy();
        uint256 received = strategy.balanceOf(address(this)) - beforeShares;
        if (received < minShares || received == 0 || received != minted) revert SlippageExceeded();
        accountedShares += received;
        costBasis += assets;
        emit Deposited(assets, received);
    }

    /// @notice Anyone may relay a proof for this vault's canonical WLD rewards.
    /// No reinvestment is performed, so minShares must be zero. Live rewards stay
    /// in custody; settled rewards go to the immutable inheritance recipient.
    /// Claiming does not change lastPing, a deadline, or a pending review.
    function claimRewards(uint256 cumulativeAmount, bytes32[] calldata proof, uint256 minShares)
        external
        nonReentrant
        returns (uint256 rewards)
    {
        if (minShares != 0 || cumulativeAmount == 0 || proof.length == 0 || proof.length > 64) {
            revert InvalidRewards();
        }
        address[] memory users = new address[](1);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        users[0] = address(this);
        tokens[0] = rewardToken;
        amounts[0] = cumulativeAmount;
        proofs[0] = proof;
        uint256 beforeRewards = IERC20(rewardToken).balanceOf(address(this));
        uint256 beforeClaimed = totalRewardsClaimed();
        IMerklDistributor(MERKL_DISTRIBUTOR).claim(users, tokens, amounts, proofs);
        rewards = totalRewardsClaimed() - beforeClaimed;
        if (IERC20(rewardToken).balanceOf(address(this)) - beforeRewards != rewards) revert InvalidRewards();
        if (claimedAt != 0) return _processRewards(0);
        _pendingRewards();
        emit RewardsClaimed(rewards, 0, address(this));
    }

    /// @notice Live rewards remain held. After inheritance, external deliveries
    /// are paid to the fixed heir; callers gain no withdrawal or timer authority.
    function processRewards(uint256 minShares) external nonReentrant returns (uint256 rewards) {
        return _processRewards(minShares);
    }

    function _processRewards(uint256 minShares) private returns (uint256 rewards) {
        if (minShares != 0) revert InvalidRewards();
        rewards = _pendingRewards();
        if (claimedAt == 0 || rewards == 0) return 0;
        uint256 fee = _takeRewardFee(rewards);
        _payRewardFee(fee);
        SafeERC20Lib.safeTransfer(rewardToken, inheritanceRecipient, rewards - fee);
        emit RewardsClaimed(rewards, 0, inheritanceRecipient);
    }

    /// @notice Requested gross USDC less the fee on realized USDC yield.
    /// WLD remains held during a partial asset withdrawal.
    function ownerWithdrawAsset(uint256 grossAssets, address to)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        if (grossAssets == 0) revert InvalidAmount();
        uint256 idle = IERC20(asset).balanceOf(address(this));
        uint256 fee;
        if (grossAssets > idle) {
            uint256 beforeShares = strategy.balanceOf(address(this));
            uint256 required = grossAssets - idle;
            uint256 burned = strategy.withdraw(required, address(this), address(this));
            if (
                beforeShares - strategy.balanceOf(address(this)) != burned || burned == 0
                    || IERC20(asset).balanceOf(address(this)) - idle != required
            ) revert InvalidStrategy();
            fee = _accountExit(burned, beforeShares, required, true);
        }
        _payFee(fee, 0);
        SafeERC20Lib.safeTransfer(asset, to, grossAssets - fee);
        emit OwnerWithdrawnAsset(to, grossAssets - fee);
    }

    /// @notice Exit USDC receipt shares without liquidity; WLD remains held.
    function ownerWithdrawShares(uint256 shares, address to)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        if (shares == 0) revert InvalidAmount();
        emit SharesWithdrawn(to, _sendShares(shares, to));
    }

    /// @notice Redeem all USDC shares and pay all held WLD. The minimum is USDC
    /// only. Reward-only exits and disposal of fully lost shares are supported.
    function ownerWithdrawAllAssets(address to, uint256 minNetAssets)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        uint256 shares = strategy.balanceOf(address(this));
        if (
            shares == 0 && IERC20(asset).balanceOf(address(this)) == 0
                && IERC20(rewardToken).balanceOf(address(this)) == 0
        ) {
            revert NothingToTransfer();
        }
        _pendingRewards();
        uint256 fee;
        if (shares != 0) {
            uint256 beforeAssets = IERC20(asset).balanceOf(address(this));
            uint256 assets = strategy.redeem(shares, address(this), address(this));
            if (
                strategy.balanceOf(address(this)) != 0
                    || IERC20(asset).balanceOf(address(this)) - beforeAssets != assets
            ) {
                revert InvalidStrategy();
            }
            fee = _accountExit(shares, shares, assets, true);
        }
        uint256 net = IERC20(asset).balanceOf(address(this)) - fee;
        if (net < minNetAssets) revert SlippageExceeded();
        _payFee(fee, 0);
        if (net != 0) SafeERC20Lib.safeTransfer(asset, to, net);
        _sendAllRewards(to);
        emit OwnerWithdrawnAsset(to, net);
    }

    function ownerWithdrawRewards(address to) external onlyOwnerOrFactory withdrawableOwner nonReentrant {
        _validRecipient(to);
        if (IERC20(rewardToken).balanceOf(address(this)) == 0) revert NothingToTransfer();
        _sendAllRewards(to);
    }

    function fileClaim() external {
        if (msg.sender != heir && msg.sender != factory) revert NotHeir();
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt != 0) revert AlreadyFiled();
        if (!isExpired()) revert NotExpiredYet();
        claimFiledAt = block.timestamp;
        emit ClaimFiled(msg.sender, claimFiledAt, challengeEndsAt());
    }

    /// @notice Bounded cash redemption, then receipt-share fallback. Idle USDC
    /// and all held WLD always go to the same fixed heir, including WLD-only cases.
    function finalizeClaim() external nonReentrant {
        if (msg.sender != heir && msg.sender != factory) revert NotHeir();
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt == 0) revert NotExpiredYet();
        if (challengeRunning()) revert ChallengeStillRunning();
        address recipient = heir;
        uint256 shares = strategy.balanceOf(address(this));
        uint256 idle = IERC20(asset).balanceOf(address(this));
        _pendingRewards();
        if (shares == 0 && idle == 0 && IERC20(rewardToken).balanceOf(address(this)) == 0) revert NothingToTransfer();
        claimedAt = block.timestamp;
        inheritanceRecipient = recipient;
        heir = address(0);
        uint256 fee;
        if (shares != 0) {
            try strategy.redeem{gas: AUTOMATIC_REDEEM_GAS}(shares, address(this), address(this)) returns (
                uint256 assets
            ) {
                if (strategy.balanceOf(address(this)) != 0 || IERC20(asset).balanceOf(address(this)) - idle != assets) {
                    revert InvalidStrategy();
                }
                fee = _accountExit(shares, shares, assets, true);
            } catch {
                emit InheritanceSharesFinalized(recipient, _sendShares(shares, recipient), claimedAt);
            }
        }
        _payFee(fee, 0);
        uint256 payout = IERC20(asset).balanceOf(address(this));
        if (payout != 0) SafeERC20Lib.safeTransfer(asset, recipient, payout);
        _sendAllRewards(recipient);
        emit InheritanceFinalized(recipient, payout, claimedAt);
    }

    /// @notice Late canonical WLD belongs to the fixed heir. Only subsequent
    /// gifts of USDC, WLD or receipt shares may be recovered by the original owner.
    function ownerSweepAfterSettlement(address to) external onlyOwnerOrFactory nonReentrant {
        _validRecipient(to);
        if (claimedAt == 0) revert NotSettled();
        uint256 processed = _processRewards(0);
        uint256 idle = IERC20(asset).balanceOf(address(this));
        uint256 rewards = IERC20(rewardToken).balanceOf(address(this));
        uint256 shares = strategy.balanceOf(address(this));
        if (idle == 0 && shares == 0 && rewards == 0 && processed == 0) revert NothingToTransfer();
        if (idle != 0) SafeERC20Lib.safeTransfer(asset, to, idle);
        if (rewards != 0) SafeERC20Lib.safeTransfer(rewardToken, to, rewards);
        if (shares != 0) _sendShares(shares, to);
    }

    function ownerRescueUnknownERC20(address token, uint256 amount, address to)
        external
        onlyOwnerOrFactory
        nonReentrant
    {
        _validRecipient(to);
        if (token == asset || token == address(strategy) || token == rewardToken) revert ProtectedToken();
        SafeERC20Lib.safeTransfer(token, to, amount);
    }

    function sweepEth(address payable to) external onlyOwnerOrFactory nonReentrant {
        _validRecipient(to);
        if (address(this).balance == 0) revert NothingToTransfer();
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert EthTransferFailed();
    }

    function _exitFee(uint256 disposed, uint256 held, uint256 gross) private view returns (uint256) {
        uint256 tracked = YieldMath.mulDiv(accountedShares, disposed, held);
        if (tracked == 0 || gross == 0) return 0;
        uint256 basis = YieldMath.mulDivUp(costBasis, tracked, accountedShares);
        uint256 attributed = YieldMath.mulDiv(gross, tracked, disposed);
        if (attributed <= basis || attributed - basis <= realizedLoss) return 0;
        return YieldMath.mulDiv(attributed - basis - realizedLoss, performanceFeeBps, 10_000);
    }

    function _accountExit(uint256 disposed, uint256 held, uint256 gross, bool valued) private returns (uint256 fee) {
        fee = _exitFee(disposed, held, gross);
        uint256 tracked = YieldMath.mulDiv(accountedShares, disposed, held);
        if (tracked != 0) {
            uint256 basis = YieldMath.mulDivUp(costBasis, tracked, accountedShares);
            uint256 attributed = YieldMath.mulDiv(gross, tracked, disposed);
            if (valued && attributed < basis) {
                realizedLoss += basis - attributed;
            } else if (valued) {
                uint256 recovered = attributed - basis;
                realizedLoss = recovered < realizedLoss ? realizedLoss - recovered : 0;
            }
            costBasis -= basis;
            accountedShares -= tracked;
        }
    }

    function _sendShares(uint256 shares, address to) private returns (uint256 netShares) {
        uint256 held = strategy.balanceOf(address(this));
        if (shares > held || held == 0) revert InvalidAmount();
        uint256 gross;
        bool valued;
        try strategy.convertToAssets{gas: SHARE_VALUATION_GAS}(shares) returns (uint256 value) {
            gross = value;
            valued = true;
        } catch { /* An unknown quote waives the fee but does not prove a loss. */ }
        uint256 fee = _accountExit(shares, held, gross, valued);
        uint256 feeShares = gross == 0 ? 0 : YieldMath.mulDiv(shares, fee, gross);
        _payFee(0, feeShares);
        netShares = shares - feeShares;
        SafeERC20Lib.safeTransfer(address(strategy), to, netShares);
    }

    function _payFee(uint256 assets, uint256 shares) private {
        if (assets != 0) SafeERC20Lib.safeTransfer(asset, feeRecipient, assets);
        if (shares != 0) SafeERC20Lib.safeTransfer(address(strategy), feeRecipient, shares);
        if (assets != 0 || shares != 0) emit PerformanceFeePaid(feeRecipient, assets, shares);
    }

    function _pendingRewards() private view returns (uint256 pending) {
        pending = unprocessedRewards();
        if (pending > IERC20(rewardToken).balanceOf(address(this))) revert InvalidRewards();
    }

    function _takeRewardFee(uint256 rewards) private returns (uint256 fee) {
        accountedRewards += rewards;
        return YieldMath.mulDiv(rewards, performanceFeeBps, 10_000);
    }

    function _payRewardFee(uint256 fee) private {
        if (fee == 0) return;
        SafeERC20Lib.safeTransfer(rewardToken, feeRecipient, fee);
        emit RewardFeePaid(feeRecipient, fee);
    }

    function _sendAllRewards(address to) private {
        uint256 fee = _takeRewardFee(_pendingRewards());
        uint256 net = IERC20(rewardToken).balanceOf(address(this)) - fee;
        _payRewardFee(fee);
        if (net != 0) SafeERC20Lib.safeTransfer(rewardToken, to, net);
        if (net != 0 || fee != 0) emit RewardsWithdrawn(to, net);
    }

    function _validRecipient(address to) private view {
        if (to == address(0) || to == address(this)) revert InvalidAddress();
    }

    receive() external payable {
        revert EthNotAccepted();
    }
}
