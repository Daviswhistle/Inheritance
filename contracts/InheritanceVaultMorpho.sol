// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "./interfaces/IERC4626Minimal.sol";
import {IMerklDistributor} from "./interfaces/IMerklDistributor.sol";
import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";
import {YieldMath} from "./libraries/YieldMath.sol";

/// @notice Opt-in WLD inheritance with an immutable ERC-4626 strategy and fee.
/// No administrator, upgrade, strategy switch, or periodic management charge.
/// Fees are collected only on exits. An in-kind exit realizes its fee in shares;
/// a failed valuation waives that exit's fee so custody never depends on a quote.
/// Proven WLD campaign rewards are compounded without increasing capital.
/// Direct WLD/share donations are not fee-bearing.
contract InheritanceVaultMorpho {
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
    event RewardsClaimed(uint256 assets, uint256 shares, address indexed recipient);
    event PerformanceFeePaid(address indexed recipient, uint256 assets, uint256 shares);
    event OwnerWithdrawnWLD(address indexed to, uint256 amount);
    event SharesWithdrawn(address indexed to, uint256 shares);
    event InheritanceFinalized(address indexed recipient, uint256 wldAmount, uint256 claimedAt);
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
    address public immutable WLD;
    IERC4626Minimal public immutable strategy;
    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;
    address public heir;
    uint256 public heartbeatInterval;
    uint256 public lastPing;
    uint256 public claimFiledAt;
    uint256 public claimedAt;
    address public inheritanceRecipient;
    /// @notice Remaining deposited capital allocated to the fee-bearing shares.
    /// Losses leave this threshold in place until those shares are exited.
    uint256 public costBasis;
    uint256 public accountedShares;
    /// @notice Closed losses offset later gains and campaign rewards.
    uint256 public realizedLoss;
    /// @dev Cumulative rewards already compounded or disposed as fee-bearing cash.
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
        address wld_,
        uint256 interval_,
        address factory_,
        address strategy_,
        address feeRecipient_,
        uint256 feeBps_
    ) {
        if (
            owner_ == address(0) || heir_ == address(0) || factory_ == address(0) || feeRecipient_ == address(0)
                || feeRecipient_ == address(this)
        ) revert InvalidAddress();
        if (
            wld_.code.length == 0 || strategy_.code.length == 0 || strategy_ == wld_
                || IERC4626Minimal(strategy_).asset() != wld_
        ) revert InvalidStrategy();
        if (interval_ < MIN_HEARTBEAT || interval_ > MAX_HEARTBEAT) revert HeartbeatOutOfRange();
        if (feeBps_ > MAX_PERFORMANCE_FEE_BPS) revert InvalidFee();
        owner = owner_;
        heir = heir_;
        WLD = wld_;
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
        return IERC20(WLD).balanceOf(address(this)) != 0 || strategy.balanceOf(address(this)) != 0;
    }

    function totalAssets() public view returns (uint256) {
        uint256 shares = strategy.balanceOf(address(this));
        return IERC20(WLD).balanceOf(address(this)) + (shares == 0 ? 0 : strategy.convertToAssets(shares));
    }

    /// @notice WLD-equivalent estimate; this is not a promise of cash liquidity.
    function position()
        external
        view
        returns (uint256 idle, uint256 shares, uint256 gross, uint256 net, uint256 fee, uint256 liquid, bool valued)
    {
        idle = IERC20(WLD).balanceOf(address(this));
        shares = strategy.balanceOf(address(this));
        gross = idle;
        liquid = idle;
        valued = shares == 0;
        uint256 remainingLoss = realizedLoss;
        if (shares != 0) {
            try strategy.convertToAssets(shares) returns (uint256 value) {
                gross += value;
                fee = _exitFee(shares, shares, value);
                uint256 attributed = YieldMath.mulDiv(value, accountedShares, shares);
                if (attributed < costBasis) {
                    remainingLoss += costBasis - attributed;
                } else {
                    uint256 gain = attributed - costBasis;
                    remainingLoss = gain < remainingLoss ? remainingLoss - gain : 0;
                }
                valued = true;
            } catch { /* Shares can still be transferred if valuation fails. */ }
            try strategy.maxWithdraw(address(this)) returns (uint256 available) {
                liquid += available;
            } catch { /* Unknown liquidity must not appear withdrawable. */ }
        }
        uint256 rewards = unprocessedRewards();
        if (rewards > remainingLoss) fee += YieldMath.mulDiv(rewards - remainingLoss, performanceFeeBps, 10_000);
        net = gross - fee;
    }

    /// @notice Includes delivery by approved external operators, not just app claims.
    function totalRewardsClaimed() public view returns (uint256) {
        return IMerklDistributor(MERKL_DISTRIBUTOR).claimed(address(this), WLD);
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
        if (next == address(0)) revert InvalidAddress();
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

    /// @dev Factory has transferred exactly `assets` WLD before this call. Only
    /// that amount is invested; previously donated WLD remains idle.
    function invest(uint256 assets, uint256 minShares) external nonReentrant activeOwner {
        if (msg.sender != factory) revert NotOwner();
        _invest(assets, minShares, true);
    }

    function _invest(uint256 assets, uint256 minShares, bool principal) private returns (uint256 received) {
        if (assets == 0 || minShares == 0) revert InvalidAmount();
        uint256 beforeShares = strategy.balanceOf(address(this));
        if (!IERC20(WLD).approve(address(strategy), assets)) revert InvalidStrategy();
        uint256 minted = strategy.deposit(assets, address(this));
        if (!IERC20(WLD).approve(address(strategy), 0)) revert InvalidStrategy();
        received = strategy.balanceOf(address(this)) - beforeShares;
        if (received < minShares || received == 0 || received != minted) revert SlippageExceeded();
        accountedShares += received;
        if (principal) costBasis += assets;
        emit Deposited(assets, received);
    }

    /// @notice Anyone may relay a valid proof. The fixed distributor can send
    /// only this vault's WLD reward to this vault, never to the caller.
    /// Live rewards compound; rewards published after inheritance go directly
    /// to its fixed recipient. Claiming never resets the inheritance timer.
    function claimRewards(uint256 cumulativeAmount, bytes32[] calldata proof, uint256 minShares)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (cumulativeAmount == 0 || proof.length == 0 || proof.length > 64) revert InvalidRewards();
        address[] memory users = new address[](1);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        users[0] = address(this);
        tokens[0] = WLD;
        amounts[0] = cumulativeAmount;
        proofs[0] = proof;
        uint256 beforeAssets = IERC20(WLD).balanceOf(address(this));
        uint256 beforeClaimed = totalRewardsClaimed();
        IMerklDistributor(MERKL_DISTRIBUTOR).claim(users, tokens, amounts, proofs);
        if (IERC20(WLD).balanceOf(address(this)) - beforeAssets != totalRewardsClaimed() - beforeClaimed) {
            revert InvalidRewards();
        }
        return _processRewards(minShares);
    }

    function processRewards(uint256 minShares) external nonReentrant returns (uint256 assets) {
        return _processRewards(minShares);
    }

    function _processRewards(uint256 minShares) private returns (uint256 assets) {
        assets = unprocessedRewards();
        if (assets == 0) return 0;
        if (assets > IERC20(WLD).balanceOf(address(this))) revert InvalidRewards();
        if (claimedAt == 0) {
            accountedRewards += assets;
            uint256 quoted = strategy.previewDeposit(assets);
            if (quoted == 0) revert SlippageExceeded();
            uint256 minimum = YieldMath.mulDiv(quoted, 9950, 10_000);
            if (minimum == 0) minimum = 1;
            if (minShares > minimum) minimum = minShares;
            uint256 shares = _invest(assets, minimum, false);
            emit RewardsClaimed(assets, shares, address(this));
        } else {
            uint256 fee = _takeCashRewards(assets);
            _payFee(fee, 0);
            SafeERC20Lib.safeTransfer(WLD, inheritanceRecipient, assets - fee);
            emit RewardsClaimed(assets, 0, inheritanceRecipient);
        }
    }

    /// @notice `grossAssets` is the pre-service-fee amount. The recipient gets
    /// grossAssets minus the fee on the redeemed portion's positive net gain.
    function ownerWithdrawWLD(uint256 grossAssets, address to)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        if (grossAssets == 0) revert InvalidAmount();
        uint256 idle = IERC20(WLD).balanceOf(address(this));
        uint256 pending = unprocessedRewards();
        if (pending > idle) revert InvalidRewards();
        uint256 usedIdle = grossAssets < idle ? grossAssets : idle;
        uint256 rewardCash = idle == 0 ? 0 : YieldMath.mulDiv(pending, usedIdle, idle);
        uint256 fee;
        if (grossAssets > idle) {
            uint256 beforeShares = strategy.balanceOf(address(this));
            uint256 required = grossAssets - idle;
            uint256 burned = strategy.withdraw(required, address(this), address(this));
            if (
                beforeShares - strategy.balanceOf(address(this)) != burned || burned == 0
                    || IERC20(WLD).balanceOf(address(this)) - idle != required
            ) revert InvalidStrategy();
            fee = _accountExit(burned, beforeShares, required, true);
        }
        fee += _takeCashRewards(rewardCash);
        _payFee(fee, 0);
        SafeERC20Lib.safeTransfer(WLD, to, grossAssets - fee);
        emit OwnerWithdrawnWLD(to, grossAssets - fee);
    }

    /// @notice Exit without requiring Morpho cash liquidity. Takes the same
    /// proportional positive-gain fee in receipt shares, never in deposited capital.
    function ownerWithdrawShares(uint256 shares, address to)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        if (shares == 0) revert InvalidAmount();
        uint256 netShares = _sendShares(shares, to);
        emit SharesWithdrawn(to, netShares);
    }

    /// @notice Redeem every share to avoid leaving rounding dust after a full exit.
    function ownerWithdrawAllWLD(address to, uint256 minNetAssets)
        external
        onlyOwnerOrFactory
        withdrawableOwner
        nonReentrant
    {
        _validRecipient(to);
        uint256 pending = unprocessedRewards();
        if (pending > IERC20(WLD).balanceOf(address(this))) revert InvalidRewards();
        uint256 shares = strategy.balanceOf(address(this));
        uint256 fee;
        if (shares != 0) {
            uint256 beforeAssets = IERC20(WLD).balanceOf(address(this));
            uint256 assets = strategy.redeem(shares, address(this), address(this));
            if (strategy.balanceOf(address(this)) != 0 || IERC20(WLD).balanceOf(address(this)) - beforeAssets != assets)
            {
                revert InvalidStrategy();
            }
            fee = _accountExit(shares, shares, assets, true);
        }
        fee += _takeCashRewards(pending);
        uint256 net = IERC20(WLD).balanceOf(address(this)) - fee;
        if (net == 0) revert NothingToTransfer();
        if (net < minNetAssets) revert SlippageExceeded();
        _payFee(fee, 0);
        SafeERC20Lib.safeTransfer(WLD, to, net);
        emit OwnerWithdrawnWLD(to, net);
    }

    function fileClaim() external {
        if (msg.sender != heir && msg.sender != factory) revert NotHeir();
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt != 0) revert AlreadyFiled();
        if (!isExpired()) revert NotExpiredYet();
        claimFiledAt = block.timestamp;
        emit ClaimFiled(msg.sender, claimFiledAt, challengeEndsAt());
    }

    /// @notice Attempt full cash redemption. If unavailable, transfer all receipt
    /// shares and idle WLD to the fixed heir instead of blocking inheritance.
    function finalizeClaim() external nonReentrant {
        if (msg.sender != heir && msg.sender != factory) revert NotHeir();
        if (claimedAt != 0) revert AlreadyClaimed();
        if (claimFiledAt == 0) revert NotExpiredYet();
        if (challengeRunning()) revert ChallengeStillRunning();
        address recipient = heir;
        uint256 shares = strategy.balanceOf(address(this));
        uint256 idle = IERC20(WLD).balanceOf(address(this));
        uint256 pending = unprocessedRewards();
        if (pending > idle) revert InvalidRewards();
        if (shares == 0 && idle == 0) revert NothingToTransfer();
        claimedAt = block.timestamp;
        inheritanceRecipient = recipient;
        heir = address(0);
        uint256 fee;
        if (shares != 0) {
            try strategy.redeem{gas: AUTOMATIC_REDEEM_GAS}(shares, address(this), address(this)) returns (
                uint256 assets
            ) {
                if (strategy.balanceOf(address(this)) != 0 || IERC20(WLD).balanceOf(address(this)) - idle != assets) {
                    revert InvalidStrategy();
                }
                fee = _accountExit(shares, shares, assets, true);
            } catch {
                uint256 receivedShares = _sendShares(shares, recipient);
                emit InheritanceSharesFinalized(recipient, receivedShares, claimedAt);
            }
        }
        fee += _takeCashRewards(pending);
        _payFee(fee, 0);
        uint256 payout = IERC20(WLD).balanceOf(address(this));
        if (payout != 0) SafeERC20Lib.safeTransfer(WLD, recipient, payout);
        emit InheritanceFinalized(recipient, payout, claimedAt);
    }

    function ownerSweepAfterSettlement(address to) external onlyOwnerOrFactory nonReentrant {
        _validRecipient(to);
        if (claimedAt == 0) revert NotSettled();
        uint256 processed = _processRewards(0);
        uint256 idle = IERC20(WLD).balanceOf(address(this));
        uint256 shares = strategy.balanceOf(address(this));
        if (idle == 0 && shares == 0 && processed == 0) revert NothingToTransfer();
        if (idle != 0) SafeERC20Lib.safeTransfer(WLD, to, idle);
        if (shares != 0) _sendShares(shares, to);
    }

    function ownerRescueUnknownERC20(address token, uint256 amount, address to)
        external
        onlyOwnerOrFactory
        nonReentrant
    {
        _validRecipient(to);
        if (token == WLD || token == address(strategy)) revert ProtectedToken();
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
        } catch { /* A broken quote must not lock a user's receipt tokens. */ }
        // An unknown quote waives this exit fee, but proves no closed loss.
        uint256 fee = _accountExit(shares, held, gross, valued);
        uint256 feeShares = gross == 0 ? 0 : YieldMath.mulDiv(shares, fee, gross);
        _payFee(0, feeShares);
        netShares = shares - feeShares;
        SafeERC20Lib.safeTransfer(address(strategy), to, netShares);
    }

    function _payFee(uint256 assets, uint256 shares) private {
        if (assets != 0) SafeERC20Lib.safeTransfer(WLD, feeRecipient, assets);
        if (shares != 0) SafeERC20Lib.safeTransfer(address(strategy), feeRecipient, shares);
        if (assets != 0 || shares != 0) emit PerformanceFeePaid(feeRecipient, assets, shares);
    }

    function _takeCashRewards(uint256 assets) private returns (uint256 fee) {
        if (assets == 0) return 0;
        accountedRewards += assets;
        uint256 recovered = assets < realizedLoss ? assets : realizedLoss;
        realizedLoss -= recovered;
        fee = YieldMath.mulDiv(assets - recovered, performanceFeeBps, 10_000);
    }

    function _validRecipient(address to) private view {
        if (to == address(0) || to == address(this)) revert InvalidAddress();
    }

    receive() external payable {
        revert EthNotAccepted();
    }
}
