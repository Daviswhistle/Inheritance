# Existing-contract review package

Prepared November 3, 2026. This package is ready to accompany a future review;
it has not been submitted. It does not claim TFH acceptance. The current Portal
draft is unverified and limited to South Korea.

## Scope

Review the already-deployed immutable inheritance factories and their child
vaults, including the 10% fee on realized positive net gains after strategy
costs and loss recovery. Please confirm whether review through the Mini App
submission covers these contracts and fees, or specify any separate intake,
remediation or audit required for the existing deployments.

The operator has no record of repository sharing before deployment. Public
source is available, but does not establish that historical procedural step.
The relevant requirements are [repository access and fee review](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines).

## Deployed scope and source

World Chain mainnet, chain ID 480. Current configured factories:

| Purpose | Address | Source |
| --- | --- | --- |
| WLD yield | `0x1a856aE8c3abd8a3746F542688a1846Bc6208435` | [Factory](../contracts/InheritanceVaultMorphoFactory.sol), [vault](../contracts/InheritanceVaultMorpho.sol), [deployer](../contracts/InheritanceVaultMorphoDeployer.sol) |
| USDC yield | `0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2` | [Factory](../contracts/InheritanceVaultUSDCFactory.sol), [vault](../contracts/InheritanceVaultUSDC.sol), [deployer](../contracts/InheritanceVaultUSDCDeployer.sol) |
| Basic WLD | `0xb74342FC15C504108cFD91366493590A9d570D26` | [Factory](../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol), [vault](../contracts/InheritanceVaultWLD.sol) |

Existing-position compatibility also includes basic WLD
`0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88`, earlier WLD yield
`0xfC3F6f0B2234923b3F3aDBAaC797e920C8FdA248`, and earlier USDC yield
`0x67c8DE756FCD04dc5976960533931984d0348758`.
The current strategy contracts are WLD `0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f`
and USDC `0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B`.

Current source links are for navigation. Earlier deployments must be compared
with their deployment revisions and verified explorer source, not recompiled
from current comments and assumed byte-identical. Deployment/verification
receipts are retained in [RELEASE.md](RELEASE.md).

## Review boundaries

- The depositor controls their own vault. The developer has no customer-vault
  seizure, upgrade or recipient-redirection power. Factory calls bind owner
  operations to the caller's registered vault.
- The designated heir starts a claim after expiry. A seven-day challenge window
  applies; the owner can renew until payment executes. A relayer can execute an
  eligible payment only to the contract's fixed recipient.
- The service fee is calculated on realized positive net gains, separately from
  principal and the external strategy's fee. Review [YieldMath](../contracts/libraries/YieldMath.sol)
  together with both yield vaults and their income/full-withdrawal methods.
- Re7/Morpho strategy governance, liquidity, losses and fee changes are external
  risks disclosed before deposit. No independent audit has been completed.
- The new [end-inheritance flow](PLAN_EXIT.md) uses existing entrypoints in one
  atomic transaction. No contract, fee or operator privilege changed.
- [Operator gas funding](../contracts/OperatorGasFunding.sol) spends the operator
  treasury's tokens only, with fixed recipient constraints; it cannot spend
  customer-vault balances.

## Reproducible evidence

- `forge test -vvv`: contract behavior, access control, claims, withdrawals and failures.
- `forge coverage --report summary --ir-minimum` and
  `node scripts/check-custody-coverage.mjs <summary>`: CI enforces at least 90%
  critical-custody line coverage. This does not mean 90% branch coverage or audit.
- `node scripts/check-natspec.mjs`: public/external function documentation.
- `node scripts/verify/worldchain-forks.mjs`: pinned-chain fork verification;
  uses local test accounts, not production transfers.
- `scripts/verify/plan-exit.mjs`: SDK batch rollback, receipt and restart recovery.
- [Guideline assessment](GUIDELINE_REVIEW.md), [reviewer walkthrough](REVIEW_NOTES.md),
  [actual device coverage](WORLD_APP_ACCEPTANCE.md), [launch scope](LAUNCH_SCOPE.md).

The exact source/run IDs and outcomes belong in RELEASE.md. Actual iOS World
App approval/permissions and the beneficiary's complete production payout flow
remain outside the currently observed device evidence.
