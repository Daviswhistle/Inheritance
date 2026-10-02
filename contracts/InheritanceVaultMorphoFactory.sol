// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InheritanceVaultMorpho} from "./InheritanceVaultMorpho.sol";
import {InheritanceVaultMorphoDeployer} from "./InheritanceVaultMorphoDeployer.sol";
import {IERC20} from "./interfaces/IERC20Minimal.sol";
import {IERC4626Minimal} from "./interfaces/IERC4626Minimal.sol";
import {SafeERC20Lib} from "./libraries/SafeERC20Lib.sol";

/// @notice Fixed World App gateway. A separate opt-in factory, with no upgrade or
/// admin permissions and no ability to move an existing plain inheritance vault.
contract InheritanceVaultMorphoFactory {
    error InvalidAddress();
    error InvalidStrategy();
    error InvalidFee();
    error AlreadyHasVault();
    error NoVault();
    error NotHeir();
    error NotOurVault();
    error NotExpired();
    error VaultNotEmpty();
    error SlippageExceeded();
    error InvalidAmount();
    error Reentrancy();

    event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval);
    event VaultReleased(address indexed owner, address indexed vault);

    address public immutable WLD;
    address public immutable strategy;
    address public immutable feeRecipient;
    uint256 public immutable performanceFeeBps;
    InheritanceVaultMorphoDeployer private immutable vaultDeployer;
    mapping(address => address) public vaultOf;
    mapping(address => bool) public knownVaults;
    uint256 private locked = 1;

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address wld_, address strategy_, address feeRecipient_, uint256 feeBps_) {
        if (feeRecipient_ == address(0) || feeRecipient_ == address(this)) revert InvalidAddress();
        if (
            wld_.code.length == 0 || strategy_.code.length == 0 || wld_ == strategy_
                || IERC4626Minimal(strategy_).asset() != wld_
        ) revert InvalidStrategy();
        if (feeBps_ > 1000) revert InvalidFee();
        WLD = wld_;
        strategy = strategy_;
        feeRecipient = feeRecipient_;
        performanceFeeBps = feeBps_;
        vaultDeployer = new InheritanceVaultMorphoDeployer(wld_, strategy_, feeRecipient_, feeBps_);
    }

    function createVault(address heir, uint256 interval_) external nonReentrant returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert AlreadyHasVault();
        vault = vaultDeployer.createVault(msg.sender, heir, interval_);
        vaultOf[msg.sender] = vault;
        knownVaults[vault] = true;
        emit VaultCreated(msg.sender, heir, vault, interval_);
    }

    function myVault() external view returns (address) {
        return vaultOf[msg.sender];
    }

    function releaseMyVault() external nonReentrant returns (bool) {
        InheritanceVaultMorpho vault = _mine();
        if (!vault.isSettled()) revert NotExpired();
        if (vault.hasAssets() || address(vault).balance != 0) revert VaultNotEmpty();
        delete vaultOf[msg.sender];
        emit VaultReleased(msg.sender, address(vault));
        return true;
    }

    function depositWithMinShares(uint256 assets, uint256 minShares) external nonReentrant {
        InheritanceVaultMorpho vault = _mine();
        SafeERC20Lib.safeTransferFrom(WLD, msg.sender, address(vault), assets);
        vault.invest(assets, minShares);
    }

    function pingMyVault() external {
        _mine().ping();
    }

    function updateMyHeir(address heir) external {
        _mine().updateHeir(heir);
    }

    function changeMyPeriod(uint256 interval_) external {
        _mine().updateHeartbeat(interval_);
    }

    function cancelMyInheritance() external {
        _mine().cancelInheritance();
    }

    function withdrawFromMyVault(address to, uint256 grossAssets) external {
        _mine().ownerWithdrawWLD(grossAssets, to);
    }

    function withdrawAllFromMyVault(address to, uint256 minNetAssets) external {
        _mine().ownerWithdrawAllWLD(to, minNetAssets);
    }

    function withdrawSharesFromMyVault(address to, uint256 shares) external {
        _mine().ownerWithdrawShares(shares, to);
    }

    function sweepSettledVaultFor(address to) external {
        _mine().ownerSweepAfterSettlement(to);
    }

    function rescueFromMyVault(address token, uint256 amount, address to) external {
        _mine().ownerRescueUnknownERC20(token, amount, to);
    }

    function sweepEthFromMyVault(address payable to) external {
        _mine().sweepEth(to);
    }

    function fileClaimFor(address address_) external {
        InheritanceVaultMorpho vault = _ours(address_);
        if (vault.heir() != msg.sender) revert NotHeir();
        vault.fileClaim();
    }

    function finalizeClaimFor(address address_) external {
        InheritanceVaultMorpho vault = _ours(address_);
        if (vault.heir() != msg.sender) revert NotHeir();
        vault.finalizeClaim();
    }

    function executeInheritance(address address_) external {
        _ours(address_).finalizeClaim();
    }

    /// @notice Also serves released vaults so delayed rewards still reach the
    /// fixed inheritance recipient; it grants no withdrawal or timer authority.
    function claimRewardsFor(address address_, uint256 amount, bytes32[] calldata proof, uint256 minShares)
        external
        nonReentrant
        returns (uint256 assets)
    {
        return _ours(address_).claimRewards(amount, proof, minShares);
    }

    /// @notice Process rewards already delivered by an approved Merkl operator.
    function processRewardsFor(address address_, uint256 minShares) external nonReentrant returns (uint256 assets) {
        return _ours(address_).processRewards(minShares);
    }

    /// @notice Recover an archived vault to its original owner without touching
    /// that owner's current slot. Before settlement, this cancels any review.
    /// Campaign rewards after settlement remain bound to the fixed heir.
    function recoverArchivedVault(address address_) external nonReentrant {
        InheritanceVaultMorpho vault = _ours(address_);
        if (vault.owner() != msg.sender || vaultOf[msg.sender] == address_) revert NotOurVault();
        if (vault.claimedAt() != 0) {
            vault.ownerSweepAfterSettlement(msg.sender);
            return;
        }
        uint256 shares = IERC4626Minimal(strategy).balanceOf(address_);
        uint256 idle = IERC20(WLD).balanceOf(address_);
        if (shares == 0 && idle == 0) revert InvalidAmount();
        vault.ping();
        if (shares != 0) vault.ownerWithdrawShares(shares, msg.sender);
        if (idle != 0) vault.ownerWithdrawWLD(idle, msg.sender);
    }

    /// @notice Redeem wallet-held receipt shares (including inherited shares).
    /// Their exit fee has already been paid; there is no second service fee.
    function redeemWalletShares(uint256 shares, uint256 minAssets) external nonReentrant returns (uint256 assets) {
        if (shares == 0 || minAssets == 0) revert InvalidAmount();
        SafeERC20Lib.safeTransferFrom(strategy, msg.sender, address(this), shares);
        assets = IERC4626Minimal(strategy).redeem(shares, msg.sender, address(this));
        if (assets < minAssets) revert SlippageExceeded();
    }

    function _mine() private view returns (InheritanceVaultMorpho) {
        address address_ = vaultOf[msg.sender];
        if (address_ == address(0)) revert NoVault();
        return InheritanceVaultMorpho(payable(address_));
    }

    function _ours(address address_) private view returns (InheritanceVaultMorpho vault) {
        // Only createVault can register a child; its WLD and strategy are fixed
        // by construction. Self-reported provenance alone grants no membership.
        if (!knownVaults[address_]) revert NotOurVault();
        vault = InheritanceVaultMorpho(payable(address_));
    }
}
