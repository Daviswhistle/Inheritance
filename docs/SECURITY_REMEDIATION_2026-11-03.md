# Contract security remediation — 2026-11-03

## Status and authority

This is a **new-generation source repair, not an upgrade of the live contracts**.
The production Mini App and current factory addresses remain unchanged. On November 4,
the operator approved and funded 0.00004 WETH for deployment; canonical proof passed.
The WLD replacement factory is mined at `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff`
and exact generation verification passed. Its finality precedes the USDC deployment. See
[deployment progress](WORLDAPP_DEPLOYMENT_2026-11-03.md). The USDC replacement, app/Worker cutover,
asset migration, notifications and submission have not occurred.
The operator requested repairs and validation, with reasons and costs before any
redeployment or asset movement. Submission remains stopped.

Baseline: main `a805626`; the original findings and five characterization proofs
are on [security-review/2026-11-03 at 58fb6da](https://github.com/Daviswhistle/Inheritance/blob/58fb6da739c821d30ccfd09c98835f49675483d6/docs/SECURITY_REVIEW_2026-11-03.md).
Those original proofs were rerun unchanged: five passes confirm the old failures,
not their repair. The new tests assert successful protected payouts instead.
This is internal engineering review, not an independent audit certificate.

## Repairs

| Finding | New behavior | Important boundary |
| --- | --- | --- |
| M-01: Merkl `claimed` outage blocks principal | A gas-bounded self-call isolates getter failure, malformed ABI and gas exhaustion. WLD exits use strategy assets while retaining unknown idle WLD; USDC principal exits independently of its WLD reward read. Inheritance fixes the beneficiary and releases cash or shares without waiting for the reward counter. | Unknown WLD is retained, not treated as zero rewards or silently given to the owner. Strict reward reconciliation still requires a valid counter. |
| M-02: rejected USDC fee transfer rolls back inheritance | A self-only subcall encloses redemption, invariant checks, accounting and fee transfer. If any step fails, the entire subcall rolls back; the outer guarded settlement transfers receipt shares with the normal proportional share fee. | This is a receipt-share payout, not a promise of immediately spendable USDC. Transferability of the strategy shares remains necessary. No fee waiver or new operator custody is introduced. |
| L-01: forced ETH locks prototype slot | Owner-only, reentrancy-guarded `sweepEth` permits recovery before or after expiry, so the empty slot can be released. | The multi-token prototype is not a production route and need not be deployed. |

### Deferred WLD ownership and accounting

`rewardsDeferred=true` means the vault fixed an inheritance recipient while it
held WLD whose reward history could not be read. Until successful reconciliation,
**all WLD held, including transfers received during that interval, goes to that
fixed recipient**. This conservative rule is necessary: a later cumulative
counter cannot reconstruct which earlier and later tokens were gifts. Simply
subtracting rewards or using the larger of the old balance and new counter would
allow the owner to take part of a late reward in some mixed sequences.

Only proven canonical rewards are fee-bearing. `RewardsClaimed` continues to
report canonical amounts; `DeferredRewardsSettled` separately records the gross
cash disposed in the deferred epoch, so gifts are not counted as earned rewards.
The flag clears only with successful payout. A failed payout rolls back accounting
and the flag. After reconciliation, the previous late-reward/gift rules resume.
An empty WLD balance does not create a deferred epoch or require another paid
transaction merely because the getter was temporarily unavailable.

`principalPosition()` provides a Merkl-independent quote: WLD strategy assets
only, or USDC strategy assets plus idle USDC. It preserves tracked capital,
loss offsets and donation exclusions. It does not promise strategy liquidity.
Income-only harvesting remains strict; it must not spend protected capital on an
unverified reward assumption.

### App and notification integration

- New methods are optional for old immutable generations. Network or malformed
  reads remain unknown; a known unsupported selector preserves legacy behavior.
- Exit review falls back to the principal quote, explicitly discloses retained
  WLD, and avoids describing the partial withdrawal as recovery of all assets.
  A confirmed receipt clears the request even when WLD remains; the remainder
  stays visible and recoverable.
- Gift-only deferred epochs can be processed even with zero canonical rewards.
  The UI verifies the fixed recipient's settlement event, cleared flag and zero
  WLD balance at the canonical receipt block.
- Held WLD is read from the token balance, not the canonical reward counter.
  A browser test caught the old display showing zero for 1.25 WLD of held gifts;
  the rendered amount is now asserted against the actual balance.
- Inheritance views distinguish pending/unknown WLD from completed payout.
  Watchers stay active and suppress a completed notification while the flag is
  true or unreadable. After finalized reconciliation they deliver completion
  once and retire. No autonomous extra reward transaction was added.
- Settled-vault discovery uses three entries per page so the extra capability
  reads remain within the Worker request budget.

## Toolchain and validation

New generation: Foundry **1.3.2**, Solidity **0.8.38**, optimizer **200**, **viaIR**,
EVM **Cancun**. Solidity 0.8.38 fixes the reported optimizer bookkeeping bug
[SOL-2026-7](https://docs.soliditylang.org/en/latest/bugs.html).
The old legacy-codegen build exceeded EIP-170 after remediation. The reviewed IR
build fits: WLD runtime **22,946 bytes**, USDC **22,524 bytes**, below 24,576.
Factory/helper runtime and creation sizes are also checked. `profile.legacy`
retains the old compiler/codegen settings for the corresponding historical source;
it is not a way to deploy this new revision.

- Full optimized execution: **501 passed, 0 failed, 0 skipped**, 21 suites; fuzz
  runs increased to **1,024** for this execution. All required fork environments
  were set explicitly.
- Read-only World Chain forks: **25 tests**, including four new real-strategy
  remediation tests. Acceptance block **35,837,437**, hash
  `0x43ebd78a409a1788cca639dfabf52c4e09a24f71698793d9751ffdadaf7b4079`.
  New fee tests use real accrued positive yield and cool all recorded dependencies
  before settlement. They verify exact receipt fees, backing/share-supply rollback,
  normal cash settlement and deferred mixed-gift/late-reward recovery.
- Adversarial local tests include revert, false/malformed return, a token that
  mutates balances before returning false, gas-consuming getter, caller privilege,
  callback/reentrancy, late mixed funds, zero-reward gifts, gain/loss quotes,
  forced ETH, rejected ETH receiver and slot reuse.
- The existing dishonest-redemption test now requires rollback followed by real
  share payout; it still rejects the owner's dishonest cash withdrawal and proves
  no fictitious cash, fee or second settlement.
- Instrumented custody/helper line coverage: **1,258/1,325 (94.94%)**, above the
  existing per-custody and aggregate 90% gates. This is separate minimum-IR
  instrumentation, not production bytecode or a branch/security proof.
- Local finalizer integration: **151 checks passed**, all transactions on Anvil.
  Simultaneous gas exhaustion in Merkl, strategy redeem and share valuation also
  passed through the actual factory entrypoints. Estimated gas with 20% padding:
  **786,788 WLD / 794,703 USDC**, both within the existing **900,000** limit.
  Actual usage was **621,780 / 628,273**; both padded-limit and full-limit execution
  preserved the fixed beneficiary and retained unknown WLD.
- Notification/auth integration **81**, scheduling **28**, alerts **29** passed.
- Original Chromium exit flow: **16 checks** including accessibility, cancellation,
  atomic rollback, process-loss recovery, restart, rounding and mixed-asset exit.
  Three new mobile-browser flows cover deferred principal withdrawal and both
  USDC/WLD gift-only payout with receipt and actual balance verification. These are test-host
  results, not new production-wallet or actual iOS World App acceptance.
- Read-only generation verification checks the complete factory/deployer runtime,
  every public and private immutable, and both STOP-prefixed child-code chunks.
  It reconstructs the exact reviewed vault creation code. Isolated Anvil checks
  pass for both generations and reject changed code, private chunk pointers,
  creation lengths and fee configuration. AST-enabled verification artifacts must
  match the reviewed build's creation/runtime bytecode exactly.

### Native-host validation and failure history

[CI 41636284563](https://github.com/Daviswhistle/Inheritance/actions/runs/41636284563)
passed all three jobs at `ef8012e`, including the generation verifier's normal
and corruption checks. The product code at `9b0bd79` also passed
[native run 41631777839](https://github.com/Daviswhistle/Inheritance/actions/runs/41631777839):
two tests, zero failures/skips on iPhone 16 Pro / iOS 18.5 Simulator. Downloaded
Xcode results and screenshots confirm login/lifecycle/keyboard checks and recovery
of a locally submitted 1.000001 USDC deposit without resubmission. This is the
native test host, not actual iOS World App or a production transaction.

Two preceding failures are retained rather than hidden by the passing run:

- Run 41630789594 timed out before host readiness because cold IR compilation
  consumed the 90-second startup budget. Compilation now completes before that
  server-readiness timer starts; transaction waits were not weakened.
- Run 41631578898 failed awaiting approval after a process restart. Its DOM trace
  contained a correctly targeted pointer-down/touch-start but no end/click, so
  no completed sign-in gesture or authentication request was demonstrated.
  The exact OS cancellation/delivery cause remains unproved. The later passing
  run alone does not prove a fix. Test-only commit `48d5b75` adds cancellation
  telemetry and requires a stable, hittable button, one native press and one
  completed trusted click before waiting for approval. It does not retry a
  failed gesture or alter product authentication.

The strengthened test subsequently passed in
[run 41634163323](https://github.com/Daviswhistle/Inheritance/actions/runs/41634163323)
at `48d5b75`: two passed, zero failed/skipped. The downloaded trace records three
stable button observations and one trusted pointer-down, touch-end and click on
"Agree and sign in", followed by the approval screen. Screenshots again show
restored input values and the 1.000001 USDC interrupted-deposit recovery. This
confirms the completed input and successful flow; it does not retroactively
establish the OS cause of the earlier incomplete gesture. Later `ef8012e` changes
only the read-only deployment verifier, its test, CI wiring and this report;
product and native-host code are unchanged from that native run.

Reproducible commands (Foundry 1.3.2 on PATH):

```sh
forge fmt --check
forge build --sizes
forge test -vv
node scripts/check-natspec.mjs
node scripts/gen-abi-errors.mjs --check
node scripts/test-yield-abi.mjs
node scripts/test-deferred-rewards-ui.mjs
node scripts/test-deferred-rewards-chain.mjs
node scripts/test-remediation-gas.mjs
forge build --ast --skip test --skip script \
  --out /tmp/yield-generation-ast-out --cache-path /tmp/yield-generation-ast-cache
AST_ARTIFACTS=/tmp/yield-generation-ast-out node scripts/test-yield-generation.mjs
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
WORLDCHAIN_FORK_BLOCK=35837437 node scripts/verify/worldchain-forks.mjs
node scripts/verify/remediation-cost.mjs
```

A bare `forge test` without RPC environment variables skips fork setup; it is not
the complete 501-test run above. The fork runner fails if any required suite is
missing or skipped. Private raw logs, screenshots and cost receipts are under
`../evidence/contract-remediation-nov03/` outside the repository.

## Applying the repair and its cost

Current factories and vaults are immutable: no administrator or proxy can patch
their runtime or replace their stored child creation code. **Two new yield
factories are required.** Each deployment creates the factory, its immutable
deployer and two creation-code data contracts. The basic WLD factory, strategies,
tokens, gas-funding contract and undeployed prototype do not need replacement.

Read-only RPC estimate on **2026-11-03 11:47 UTC**, World Chain block **37,185,393**:

- Required two-factory total: approximately **0.00002184 ETH**.
- With 20% execution-gas margin and the L1 fee upper bound: approximately
  **0.00002645 ETH**. This is a snapshot, not a fixed quote or spending approval.
- The observed operator balance is short of that reserve by approximately
  **0.00000897 ETH**. Funding/bridging costs are additional and were not incurred.
- The estimator uses public RPC, reviewed optimized artifacts, unsigned transaction
  bytes and the chain's L1/operator fee oracles. It never reads keys, signs or
  broadcasts. At this block operator fee scalar and constant were zero.
  See [OP Stack fees](https://docs.optimism.io/op-stack/transactions/fees).

Asset movement is separate from deploying factories. An empty old vault has no
funds to migrate. A funded old vault remains subject to the old defects until its
owner withdraws and redeposits, or transfers eligible receipt shares through a
reviewed path. The operator cannot move an absent owner's funds. Do not redirect
or reset existing recipients, deadlines, pending claims or signed operations.

Migration cost depends on actual vault balances, liquidity, receipt shares and
World App's live transaction quote. Cash exits may realize the existing positive
net-gain service fee, in addition to network costs; principal is not the fee base.
No user's migration amount or cost is authorized or estimated as a fixed fee
here. Before a specific move, prepare an exact from/to/asset/amount review and
fresh World App gas quote. Do not use old test-spending approvals again.

Before broadcast: re-estimate exact final artifacts and nonce, get a bounded ETH
spending/funding authorization, use a new durable deployment-state file (the old
scripts' state files belong to previous generations), verify factory/helper
runtime **and reconstructed child creation-code chunks**, then update new primary
routes while retaining all old routes, allowlists and notifications as specified
in [LEGACY_YIELD_ROUTES.md](LEGACY_YIELD_ROUTES.md). Source repair and factory
rotation alone do not migrate any asset. Submission remains stopped.

Use the read-only [generation verifier](../scripts/verify/yield-generation.mjs)
with the new factory address and independently reviewed asset/strategy/fee values
before enabling a route. Its CLI arguments are documented at the top of the file.
Old deployment scripts' normalized runtime check alone is insufficient because it
masks private code pointers and does not reconstruct the child creation code.
