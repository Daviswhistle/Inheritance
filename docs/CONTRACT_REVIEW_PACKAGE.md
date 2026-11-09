# Existing-contract review package

Prepared November 9, 2026 for review of the deployed WLD/USDC vaults and their
service fees. This package indexes source, deployed addresses, control boundaries,
fee calculations and reproducible checks. Current app/device results and the
South Korea submission are tracked in
[SUBMISSION_READINESS.md](SUBMISSION_READINESS.md).

## Scope

Review the already-deployed immutable inheritance factories and their child
vaults, including the 10% fee on realized positive net gains after strategy
costs and loss recovery. Please confirm whether review through the Mini App
submission covers these contracts and fees, or specify any separate intake,
remediation or audit required for the existing deployments.

The contracts are already deployed. No pre-deployment repository-sharing review
record is available. The deployment history and public source below are supplied
for review of the existing contracts.
The relevant requirements are [repository access and fee review](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines).

## Deployed scope and source

World Chain mainnet, chain ID 480. The remediated yield factories below have
been mined and checked against the reviewed runtime, immutable configuration
and both child-creation-code chunks. Initial production app/Worker activation completed
on November 4, 2026 (KST), from commit `1e4715d` in deployment run
[41676338353](https://github.com/Daviswhistle/Inheritance/actions/runs/41676338353).
The production HTML and all 21 build files matched the explicit
`NODE_ENV=production` build and
[immutable Pages deployment](https://3a35cdc0.inheritance.pages.dev). Worker
version `b07b7a46-8a56-4a0c-be02-c39f193a152f` reports the basic factory, both
new yield factories and all four legacy yield factories as supported. Portal
permissions retain the original ten contracts plus the two new factories; the
South Korea draft remains unverified.
The activation receipt above is historical. The latest app release is
`80a2f18`, with successful deployment
[42613413275](https://github.com/Daviswhistle/Inheritance/actions/runs/42613413275)
and [immutable Pages build](https://05c5fe99.inheritance.pages.dev).
Current readiness separates this release from the older activation record and
from older-contract Android transactions.

| Purpose | Address | Source |
| --- | --- | --- |
| Remediated WLD yield (block 37192969) | `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff` | [Factory](../contracts/InheritanceVaultMorphoFactory.sol), [vault](../contracts/InheritanceVaultMorpho.sol), [deployer](../contracts/InheritanceVaultMorphoDeployer.sol) |
| Remediated USDC yield (block 37193547) | `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e` | [Factory](../contracts/InheritanceVaultUSDCFactory.sol), [vault](../contracts/InheritanceVaultUSDC.sol), [deployer](../contracts/InheritanceVaultUSDCDeployer.sol) |
| Basic WLD | `0xb74342FC15C504108cFD91366493590A9d570D26` | [Factory](../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol), [vault](../contracts/InheritanceVaultWLD.sol) |

Both remediated factories fix the service fee at 1000 bps and its recipient at
`0xe819320ed3d03f9912b06a48cc5e7f06060cc67a`. Their helpers are WLD
`0xc3CEda14416469144aaCb08637aAD1E61c0AC175` and USDC
`0x9713961Fb3485e97AD07860906f676E66A47c04e`. Existing factory settings and
customer balances are unchanged.

Public Sourcify records report exact creation/runtime matches for both
[WLD factory](https://repo.sourcify.dev/480/0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff)
and [helper](https://repo.sourcify.dev/480/0xc3CEda14416469144aaCb08637aAD1E61c0AC175),
and the [USDC factory](https://repo.sourcify.dev/480/0xB3d5ead33a91287C2D39b345041D5a44dC381c5e)
and [helper](https://repo.sourcify.dev/480/0x9713961Fb3485e97AD07860906f676E66A47c04e).
The remediated build uses solc 0.8.38, viaIR, optimizer 200 and Cancun.

Legacy compatibility retains WLD yield
`0x1a856aE8c3abd8a3746F542688a1846Bc6208435` and USDC yield
`0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2`, as well as basic WLD
`0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88`, earlier WLD yield
`0xfC3F6f0B2234923b3F3aDBAaC797e920C8FdA248`, and earlier USDC yield
`0x67c8DE756FCD04dc5976960533931984d0348758`.
The current strategy contracts are WLD `0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f`
and USDC `0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B`.

Current source links are for navigation. Earlier deployments must be compared
with their deployment revisions and verified explorer source, not recompiled
from current comments and assumed byte-identical. Deployment/verification
receipts and the latest app release and production checks are recorded in
[RELEASE.md](RELEASE.md).

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
  Receipt-share valuation has a 150,000-gas bound. If it fails, the existing
  policy waives that exit's service fee, transfers all shares to the recipient
  and records no fee debt; later wallet redemption does not collect it. A
  successful quote with a larger gas allowance does not change this bounded
  on-chain result.
- Re7/Morpho strategy governance, liquidity, losses and fee changes are external
  risks disclosed before deposit.
- The [end-inheritance flow](PLAN_EXIT.md) uses existing entrypoints in one
  atomic transaction. The remediated generation separately isolates failed
  reward-counter reads from principal exits and makes a rejected USDC cash fee
  roll back before receipt-share inheritance. Deferred WLD, including gifts
  received before reconciliation, remains owed to the fixed heir; gifts remain
  exempt from reward fees. No upgrade or customer-fund seizure power is added.
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

A deployed-USDC-child local fork retained the actual Re7 strategy code and
normal strategy state transitions. With a synthetic 100 USDC balance and local
USDC fee-rejection wrappers, cash settlement succeeded in the healthy case;
fee rejection rolled the cash attempt back and delivered all receipt shares
when the 150,000-gas valuation failed (the same quote succeeded at 2,000,000).
Those fixtures establish the deployed policy branch, not a production issuer
restriction, real-device transaction or future cash liquidity.

The exact source/run IDs and outcomes belong in RELEASE.md. Actual iOS World
App approval/permissions and the beneficiary's complete production payout flow
remain outside the currently observed device evidence.
