# Mac continuation — 2026-11-03

## Independent audit remediation — 2026-11-04

Audit findings at `a9e93b1` are addressed in
[AUDIT_REMEDIATION_2026-11-04.md](AUDIT_REMEDIATION_2026-11-04.md).
Additional deposits now have durable recovery and exact-receipt confirmation;
partial withdrawals, settled reward descriptions, name lookup dependencies,
backend retry/alerts, narrow-screen amounts and toast geometry are corrected.
Store images and batched-approval terms were regenerated/aligned.
The iOS retry cause is directly reproduced in the test host, with a fixed native
regression pass; matching 18.5 CI and production/device readback are pending.
Do not submit. No extra funds, contract deployment, asset migration or external
message was performed. Existing funding runner is complete; do not run it again.

## Cancelled-plan screen correction — 2026-11-04

The Android World App showed duplicate empty-asset text, both restart and settings
buttons, and a settings heading after inheritance had ended. The app now shares
one ended-state card between Home and Plan, with one restart action. A confirmed
exit uses its verified wallet-return message in that card; it does not add a
second completion box. Reloaded/empty exits only state that no assets remain.
The state requires complete balance reads and self-recipient settings for every
unsettled owned plan; retained assets, active plans and unknown reads keep their
recovery/management paths. Restart explicitly opens setup; its Back returns to
the ended state. No production transaction or submission is part of this work.

Local TypeScript and error-copy checks passed. Chromium exit tests passed before
the duplicate completion-box consolidation; the final WebKit exit suite passed
all 15 scenarios with actual local-chain withdrawals/recipient changes/restart,
including receipt and rollback checks. Screenshots reviewed at
`evidence/cancelled-ux-nov04/webkit-final/`. The Android before captures are private.
Runtime `be5eca9e813b7e1281ce60050d9551f39bb5d5b8` is deployed at
https://2240fa43.inheritance.pages.dev. Deployment run **41756895746** and general
CI **41756895869** succeeded. Production root and all four referenced JS/CSS files
match the immutable deployment; root SHA256 is
`1b28d0154d99b6be4e3322817a2ee6891c7cee4f4ed18bc4e4d424eef4828483`.
After force-closing and reopening actual Android World App, login completed and
the connected account showed the ended card on both Home and Plan. Restart opened
setup without a wallet request; Back restored the ended card. Reviewed private
captures: `ended-home-live.png`, `ended-plan-live.png`, `restart-live.png`,
`back-live.png` in `evidence/cancelled-ux-nov04/`. No production transaction,
additional spending, customer-asset migration or Mini App submission occurred.
The subsequently completed native iOS host run **41756895853** failed twice at login retry;
this checkpoint does not claim a fresh native-host pass or actual iOS World App
validation.

## Production cutover — 2026-11-04

Both replacement factories are finalized and active for new primary routes:
WLD `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff` (37192969),
USDC `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e` (37193547).
Both immutable fee recipients are `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a`,
1000 bps. Earlier immutable contracts and their balances are unchanged.

Production runtime `1e4715d6425c3b369fd3519e1a905dfaa47f11f4`; deployment run
41676338353 succeeded. Immutable Pages deployment:
https://3a35cdc0.inheritance.pages.dev. Worker version:
`b07b7a46-8a56-4a0c-be02-c39f193a152f`.
All 22 public files match both the immutable deployment and the local build
with explicit `NODE_ENV=production`; root SHA256 is
`9b4c2ff874c5fc3e029e46d014e8db084caf6d2266f3d2355d402aaf11ff3391`.
An earlier local build inherited a development React environment and therefore
had different React/entry hashes; correcting the local build mode produced exact
matches without a source or production change. Python's local CA bundle also
failed HTTPS validation; verification used Node's working TLS trust, never
certificate-verification bypasses.

Ten selected GitHub variable values were read back after applying the eight
changes. The public automation health verifies seven supported factories:
current basic WLD, both new yield generations, and all four earlier yield
factories. The frontend additionally retains the manual-only basic generation.
Portal readback: original ten contracts plus the two new factories, four Permit2
tokens unchanged, KR only, unverified. Funding-only WETH/router permissions
remain removed and both operator JS routes remain inert.

Nonce 2 wrapped **16534664601754 wei** as WETH in block **37194135**;
transaction `0x4f5233f56f42362df424b4f86b19d11db790d0e9bcf107294b0cc54ee4f6e1b8`,
all-in wrap fee **71479824343 wei**. It is finalized. Nonce 3 returned exactly
**16534664601754 wei WETH** to the approved World App Safe in block **37194854**:
`0xebda291047c44de35e37826de3f970587526ca43155275dceb7f6560179ae70a`.
The recipient's WETH balance increased by that exact amount and the temporary
EOA's WETH balance is zero. Return fee **49358573070 wei**; all four fees total
**23217058662086 wei**; retained native dust **248276736160 wei**.
The equation spent + returned WETH + native dust = **40000000000000 wei** passed.
The return receipt is finalized (observed finalized block 37194966), and the
guarded runner returned **complete** after verifying all four canonical receipts,
zero temporary WETH balance, nonce 4 and the exact funding reconciliation.
No further transaction is needed. Retain the temporary keystore for its native
dust; do not delete, expose or regenerate it.
No additional funding, customer asset migration, external message or Mini App
submission is authorized by this checkpoint.

Evidence outside the public repository: `production-cutover-artifacts-nov04.json`,
`production-automation-health-nov04.json`, `portal-cutover-nov04.json`,
`rollout-variable-plan-nov04.json`, `remainder-wrap-nov04.json`, and
`return-receipt-nov04.json`, and `runner-complete-nov04.json`.

### iOS test-harness follow-up

Final native-host validation passed: run **41700415152** on **0799828**, iPhone
16 Pro / iOS 18.5 / arm64, **2 passed, 0 failed, 0 skipped**. Downloaded approval,
QWERTY, third rotation/foreground, Done, keyboard-dismissal and recovery PNGs were
reviewed. The approval heading receives focus, the Account picker stays closed,
and Approve/Reject remain available. Full input geometry, native accessory Done,
three stable samples and post-capture checks all remain enforced. Recovery shows
USDC 1.000001. This is a native test host, not actual iOS World App validation.
The separate current browser integration smoke passed **10/10**; bridge unit
checks passed **6/6**. General CI **41700415409** also passed.
Private evidence: `ios-final-41700415152/{review.txt,ios-summary.json,run.log}`.

Later commit 3e908a2 changes only documentation and the standalone browser-smoke
completion assertion. The native workflow, app, contracts, iOS host and its
bootstrap/start/pending inputs are byte-identical to tested 0799828. Redundant
automatic native run 41702978616 was intentionally cancelled; 41700415152 remains
the reviewed native result, not a skipped failure.

Run 41673388897 failed only the login/native-lifecycle visibility helper;
interrupted-deposit recovery passed. Screenshot and AX/CSS evidence show the
focused input fully visible. The retained keyboard query had pinned a stale
identity during a keyboard layout change. Test-only ca55eac now uses one fresh
portrait snapshot and reacquires landscape keyboard geometry on each poll;
all original visibility/height/stability checks remain. Swift parse passed.
Replacement native run 41678818435 exceeded the job's 25-minute limit.
All first-test geometry checkpoints through repeat-foreground-3 passed, but
11 XCTest system-animation idle waits each consumed 60 seconds; the first test
was still in its final Done tap and recovery testing had not started. This is
not a full pass. Forced cancellation left only incomplete xcresult Staging,
so its captured checkpoints are logs, not reviewed screenshot artifacts.
Commit c9e30be raises only the workflow's whole-job limit to 45 minutes; every
individual assertion and stability requirement remains unchanged. New native
run 41683367120 completed with 1 failure out of 2: pending-deposit recovery
passed, the first native-keyboard visibility assertion did not. Its root
snapshot retried, but the old logs cannot distinguish missing data from too few
completed stable samples. The failure screenshot shows the input fully visible
and the OS QuickPath first-use introduction covering the keyboard area; the app
AX tree does not expose that tip. This is evidence of a simulator setup issue,
not proof that it alone caused the assertion failure.

Commit 7bd106e uses a fresh WebView snapshot for DOM geometry and a fresh native
keyboard query per sample, adds exact-tip-only dismissal and detailed query/
sample/reset diagnostics. No geometry, hit-test, height, timeout or stability
assertion was relaxed. Swift Simulator SDK typechecking passed. Commit 8c36672
prepares only the selected disposable simulator's keyboard tutorial preference,
with readback, following Appium's documented test-device setup. Native run
41688191187 passed the initial keyboard assertion and pending-deposit recovery,
but failed in landscape because the new WebView-only helper incorrectly required
a DOM Done button. PlanSetup intentionally hides that toolbar below 240 CSS
pixels and uses the native keyboard accessory. The failure screenshot shows the
full input and native Done; AX confirms WebView bottom 139, Done y=139/h=44,
keyboard top 221. This was a test regression, not an obscured app input.
Commit 8f9b186 verifies each layout separately: normal viewports require DOM Done;
short viewports require an absent DOM toolbar and one hittable native Done wholly
within the accessory band. Existing full visibility, 44-point height, nine hit
samples, three stable samples and post-capture recheck remain enforced.
Run 41691298772 attempt 1 on 5eebfe0 ended before any step or artifact:
GitHub identified hosted-runner acquisition failure and ARM64 capacity constraints.
Intel fallback run 41693995249 on 46ca812 executed both tests: recovery passed,
but the first login test could not find Reject. Its PNG shows a valid wallet-auth
pending card with Approve/Reject and an open native Account Owner/Heir selector.
The captured trace does not establish whether focus or a pointer opened that
selector. The title "Test host controls" is shared with normal approvals and is
not evidence of a wrong dialog. A browser-tested host-only correction explicitly
focuses its non-interactive title when it opens, avoiding the default first
Account select. Approval decisions, native checks and their deadlines remain unchanged.
ARM retry 41691298772 attempt 2 passed both native tests (zero failures) in
318.960 seconds. Downloaded screenshots confirm real QWERTY/full input, the
third landscape and foreground cycle, native Done, restored review/navigation,
and recovered USDC 1.000001. Third-landscape geometry passed three stable
samples over 1.93s plus the post-capture fourth sample at 3.40s. Distinguish this
pass from attempt 1. Standard Apple Silicon remains the normal runner;
the Intel fallback is recorded as failed, not presented as native validation.
The explicit heading-focus correction f99a33c passed targeted initial/retry
focus, Reject and Approve checks, plus six bridge unit tests. The broader browser smoke initially timed out waiting for obsolete success
copy. Isolated pre-fix baseline 46ca812 reproduced the same failure while both
plans were successfully created. Commit 4ac62b4 checks the existing ready-card
state instead; all original asset/recipient chain assertions remain. The full
current browser smoke passed all ten integration checks. Native run 41700415152 on 0799828 passed both tests with the heading-focus
correction; its reviewed screenshots confirm the intended initial focus.
General CI 41691298593 and 41693995134 passed.
The older queued run 41676338433 was cancelled. Product runtime remains 1e4715d.
Private evidence: `ios-failure-41673388897/`, `ios-fixed-41678818435/diagnosis.txt`,
`ios-final-41683367120/diagnosis.txt`, and `ios-verified-41688191187/diagnosis.txt`.

> The sections below preserve earlier checkpoints. Their pending approvals,
> balances and deployment states describe that checkpoint only; the production
> cutover and final funding reconciliation above are the current state.

## Both factory CREATEs mined and verified — 2026-11-04

The WLD CREATE is finalized. The USDC CREATE succeeded in block **37193547**:
- USDC factory: `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e`
- Transaction: `0xb957ab3a322470dce768d0ae7121d30c574fb94c718eab39060be5519a7b4f4c`
- USDC helper: `0x9713961Fb3485e97AD07860906f676E66A47c04e`
- USDC all-in fee: **11396046838323 wei**.
- Both CREATE fees total: **23096220264673 wei**.
- Temporary EOA ETH remaining: **16903779735327 wei**.

Exact USDC factory/helper runtime, all immutable values, both creation-code
chunks, reconstructed child code and ABI settings passed at the receipt block.
Both factories use `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a` as fee recipient,
1000 bps. The old immutable generations retain their original fee recipients.
Private proof: `usdc-deployment-verified-nov04.json`.
Both USDC source payloads now have stored Sourcify creation/runtime exact matches
(factory match 58236766, helper 58236764). Blockscout currently fully verifies all
four factory/helper contracts, and their stored source files and constructor
arguments match the reviewed repository. Its old USDC-helper mirror job failed,
but the current stored helper verification is via eth-bytecode-db; preserve both
observations without claiming the original failure cause was proven.

A local build with the exact planned production variables passed: two new primary
routes, four retained yield routes, and both basic generations (eight frontend
trusted factories; seven support automatic execution). Actual CREATE blocks and
earliest legacy discovery blocks were checked. Build proof:
`cutover-config-proof-nov04.json`; planned ten variable values:
`rollout-variable-plan-nov04.json` (not applied yet). CI 41673388925 passed at f8c60d0.
The initial local pnpm wrapper tried to refresh dependencies and aborted without
a TTY; using the already installed Vite build command succeeded without changing
dependencies. Normal deployments retain inert operator JS tombstones too.

Wait for finalized block >=37193547 before the guarded runner's nonce-2 WETH
wrapping step; nonce 3 returns the fixed remainder to the World App Safe. Do not
regenerate the key, replace transactions, re-fund, or change the fixed manifest.
No app/Worker/Portal primary cutover has occurred yet. Backend config changes
are prepared locally/on the feature branch only; the two newest old factories
are explicitly retained alongside the two oldest. Asset migration and Mini App
submission remain prohibited by the current scope.


## Earlier first-factory verification — 2026-11-04

Funding block 37192271 is finalized. The guarded runner submitted only nonce 0,
and the WLD factory CREATE succeeded in block **37192969**:
- Factory: `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff`
- Transaction: `0xfefc01fb9398c57bfeb99484f368d607478d68314443d4cb7ccf78167e9a5bea`
- Actual all-in transaction fee: **11700173426350 wei**.
- Remaining temporary EOA ETH: **28299826573650 wei**.
- Fee recipient: `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a`, 1000 bps.

Exact factory/helper runtime, all immutable values, both creation-code chunks,
reconstructed child bytecode and ABI settings passed verification at the receipt
block. Private evidence: `wld-deployment-verified-nov04.json` and
`wld-deployment-cost-nov04.json` in the deployment evidence directory.

The runner now returns `pending_finality` for nonce 0. Wait until finalized
block >=37192969 before its next step. The USDC factory is not deployed; neither
remainder wrapping nor return has run. New factory routes are not activated in
the app/Worker/Portal. Funding must never be repeated. Existing budget approval
remains valid; no additional user action is required for the fixed guarded steps.
Latest full CI 41667520290 passed, including the new receipt and rollout checks.

Actual-deployment fork validation passed: the deployed WLD factory created a
22,946-byte child matching all reviewed immutable values; owner/heir/slot guards
and principalPosition under an injected Merkl getter failure behaved correctly.
This used only localhost Anvil and a test account, not a public-chain vault.
Sourcify v2 returned stored exact creation/runtime matches for the WLD factory
(job b426eaff-4142-41c6-89e2-638d3d9210c0) and helper
(job 8b95a406-dc54-42a6-a082-25ba08d43073). External explorer propagation is separate.

Funding-only permissions were restored to the original ten contracts, with the
four Permit2 tokens unchanged. Fresh browser readback before cleanup confirmed
exactly original ten + WETH + SwapRouter02, with no stale EOA permission.
Cleanup hosting run 41670407632 succeeded: both operator HTML paths serve normal
SPA fallback and both operator JS paths are inert 62-byte tombstones. Normal root
HTML hash is unchanged. Do not reopen the retired funding page or re-send funds.


## Earlier funding approval and receipt — 2026-11-04

The operator explicitly approved **0.00004 WETH total funding**, with deployment
and return costs within that amount, then completed native approval. The exact
fixed two-call batch succeeded in block **37192271**:
- Funding transaction: `0x3894b0624245ccf500fc14075ff5f90e09643824ee99439c73c742484c3c47ad`
- User operation: `0x9aa9e9825c6e7524b335d8aead600b7a9e8058ca45ca0cb01304fef5e8efa14c`
- Temporary EOA received exactly **40000000000000 wei**, nonce remains zero.
- The receipt's only outgoing ERC-20 Transfer from the user wallet is the approved
  WETH amount. No extra fee was shown on the native approval sheet.

Canonical receipt verification passed: selected successful UserOperation,
getUserOpHash binding, exact atomic calldata, official code hashes, exact WETH
transfer/unwrap, and pre/post recipient and router balances. Private evidence:
`work/evidence/worldapp-deployment-nov03/funding-proof-nov04.json`.
The first dry run exposed an ethers read-only Result encoding TypeError; passing
a plain tuple to getUserOpHash repairs argument encoding without weakening proof.
The local four-step deployment/recovery/return regression passed again.

The operator page timed out after 90 seconds before manual approval completed;
this did not cancel the transaction. Chain evidence recovered the successful
result, and phone status refresh showed funds found with resend blocked. Commit
`de817ee` fixes late-result capture while retaining the lock and duplicate guards.
It is pushed but not hosted yet. Never repeat the funding transfer.

The guarded runner currently returns `funding_pending_finality`. At the latest
checkpoint (head 37192596, finalized 37191963), funding block 37192271 is not yet
finalized; EOA balance remains exactly 40000000000000 wei and latest/pending
nonces are zero. It has not signed or broadcast a factory deployment. Wait until finalized block >=37192271,
then use the approved frozen manifest hashes and the canonical hashes above.
The budget approval persists; do not ask for the same 0.00004 WETH again. Halt
if fresh all-in costs exceed that budget. Submission remains prohibited.


## Earlier resumption and approval checkpoint — 2026-11-04

The operator explicitly resumed work. Submission remains stopped and deployment
funding still needs an exact native quote and amount approval. World App is the
only available wallet. No real funds were used, and no new contracts were deployed.

Diagnostic commit `6f06781` is now pushed. Its sanitizer regression and funding
browser checks passed; isolated build ID is `1f49012b5f57`, with the same frozen
v2 manifest. Hosting run 41664442631 succeeded. Hosted HTML/JS exactly match the local
build, and normal product root HTML remains unchanged.
The previous functional CI run 41653828104 completed successfully.

Fresh chain readback at block 37192080 found the temporary EOA balance zero,
latest/pending nonce zero, and no code at either planned factory address.
Private evidence: `work/evidence/worldapp-deployment-nov03/resume-chain-nov04.json`.
The operator reauthorized USB debugging. The phone loaded build `1f49012b5f57`
and exact-wallet server signature verification passed. A single new fixed-batch
request reached the actual native approval sheet: send **0.00004 WETH**, with no
separate network fee displayed. No Portal permissions were changed on resumption.
The earlier `invalid_contract` did not recur; its exact address/cause is unproved.
Do not attribute this to the diagnostic-only source change.

The native approval is pending with the operator. Amount approval was requested
for 0.00004 WETH total funding, deployment and return within that budget, and no
additional displayed fee. No approval response or canonical receipt is recorded
yet. Do not retry or publish another native request while this is unresolved.
Private screenshot: `phone/resume-native-nov04.png`; hosting proof:
`resume-hosted-nov04.json` under the same private evidence directory.


## Historical pause — 2026-11-03

Work was paused at the operator request and resumed on November 4. No mainnet funding/signing/deployment/asset migration
or money spending occurred. The phone operator page was closed; there is no
pending native approval or user-operation hash.

Current hosted router build `4be96bf5e6d0`, frozen manifest `0x59421057...7e9a208`,
was verified after successful run 41653827159. Normal product root HTML remains
unchanged. Exact target-wallet authentication passed. The first native router
batch returned `invalid_contract` before quote/approval; details contain
`miniappId` and `contract`, which the hosted sanitizer redacted. The rejected
address is not yet identified. Do not guess or expand allowlists speculatively.

Local commit `6f06781` permits strictly shaped public contract/app identifiers in
diagnostics. It has not been published to the phone; do not claim the diagnostic
fix solved native execution. The latest published functional commit is 064de83.
These handoff/report updates remain local and uncommitted at pause.

Portal temporary entries currently remain: original ten contracts plus canonical
WETH and SwapRouter02 (12 total); Permit2 tokens unchanged. The operator-only
funding page remains hosted, with target-wallet auth and fixed intent guards.
Resume by publishing/rechecking the bounded diagnostics, identifying the precise
rejected contract and correcting only a verified missing setting. Actual funding
requires an exact fee quote and amount approval; no such approval has been given.
World App is the operator's only wallet. Submission remains stopped.

## Historical router preparation — before approved funding

The cost source and future immutable fee recipient are World App wallet
`0xE819320Ed3D03f9912b06a48cC5E7f06060CC67a`. No mainnet funding, deployment,
asset migration or submission has occurred; no money was spent. The operator has
no other wallet. All previous direct CreateCall/native-ETH attempts definitively
failed before quote or approval, and those operator permissions/pages were retired.

A separate standard Uniswap router route is now prepared at `064de83`:
WETH.transfer(router, 0.00004 WETH) and unwrapWETH9 to the fixed temporary EOA,
as one atomic native batch. The public v2 manifest is
`deployment/worldapp-router-funding-2026-11-03.json`, hash
`0x59421057c53ab0bbfb1c7cd07ffb33a7c5ce1b2fd44bd539734c0087e7e9a208`.
It preserves the same deployment EOA, two CREATE addresses and new fee recipient.
Do not regenerate the key or alter the frozen intent after opening a native request.

Actual Safe fork tests verify exact funding, rollback and the router-dust race.
Guarded runner recovery/CREATE/return tests and independent review passed.
Historical native receipts exposed the general MultiSend wrapper; both official
fixed wrapper address/codehash pairs are now supported with exact inner calls.
No production signature was made. Native acceptance/fee approval is still pending.

The Portal currently has its ten previous contracts plus canonical WETH and
SwapRouter02; Permit2 permissions are unchanged. Funding-only hosting run
41653827159 was dispatched, and must be read back before device testing. Normal
product runtime remains f6dc58a. Do not merge to main or submit. See
[WORLDAPP_DEPLOYMENT_2026-11-03.md](WORLDAPP_DEPLOYMENT_2026-11-03.md) for prior
failures, cleanup receipts, exact targets, evidence, costs and execution boundaries.

## Current authority — submission stopped

The operator rejected the previous readiness assessment and explicitly said not
to submit. November 3's fresh Portal readback is **unverified**, **KR only**.
Do not resubmit this revision without a subsequent explicit instruction. Earlier
submission receipts below are historical. Code fixes, validation and deployment
remain authorized; no additional production funds or outbound messages are used.

The current work reviews all user journeys, not just isolated wording. See
[HUMAN_UX_REVIEW.md](HUMAN_UX_REVIEW.md) for observed failures, reference sources,
changes and validation boundaries. Empty contracts, separate wallet investments,
fee-adjusted balances, transaction review and recipient payout states now have
explicit, different presentations. Do not call browser checks a user study.

Earlier runtime `55ede20` was deployed and matched against the production alias; native
host test source `1d4670c` passed both tests in run 41412039522. Android verified
the final empty state, asset separation, settings and visible setup return.
The subsequent cold-start investigation corrected the persistent-blank diagnosis:
actual pixels render after native loading while UIAutomator omits web content.
See ANDROID_COLD_START.md for timed captures, action checks and the corrected
verification procedure; no product runtime fix was claimed for this finding. No new real
transaction, notification, external message or submission was performed.

## November 3 — remaining contract security repairs (not deployed)

Branch `fix/contract-security-remediation` repairs the two conditional yield-vault
exit failures and the undeployed forced-ETH prototype defect. It includes matching
app/notification handling for retained WLD and the new compiler/IR build. See
[SECURITY_REMEDIATION_2026-11-03.md](SECURITY_REMEDIATION_2026-11-03.md) for actual
regressions, mainnet-fork evidence, costs and migration boundaries.

**Do not treat this source repair as a live-contract upgrade.** Production remains
runtime `f6dc58a`; no new contract, app or Worker deployment, funding, migration or
submission was performed. Applying the repair requires two new yield factories
and separately reviewed movement of any funded old vaults. The operator asked
for reasons/costs before these actions; old transaction approvals are not reusable.
Do not merge this branch to main merely to save work: app/backend changes would
trigger production deployment before new-generation rollout is reviewed.

Validation: 501 optimized contract tests passed with zero skips, including 25
World Chain fork tests. Functional commit `ef8012e` passed CI 41636284563, including
exact factory/deployer/child-code verification and corruption rejection. Native
host run 41634163323 at `48d5b75` passed both tests with completed-login gesture
telemetry and interrupted-deposit recovery. It is not actual iOS World App
validation; the earlier incomplete native touch's OS cause remains unproved.
The remediation report preserves both failures and subsequent evidence.

## November 3 — login, logout and restarting an ended plan

Runtime `f6dc58a` is deployed at https://5a3a5e6a.inheritance.pages.dev.
It adds visible sign-out, a bounded login with reload recovery,
and suppresses late authentication responses after timeout/sign-out. Wallet
identity no longer waits for a balance RPC response. Sign-out clears the local
session and resets the document; account-scoped transaction recovery records
remain for the next sign-in. It does not end a plan or move funds.

Ended empty plans no longer offer renewal/exit transactions or identify their
owner as the recipient. Restart opens setup directly and explicitly reviews
reactivation of the selected existing vault, including renewal of an expired
deadline. Unselected ended assets stay ended. Android verified sign-out and
re-login; Chromium/WebKit login and exit regressions passed. Native run
41615531022 exposed a stale test viewport query. The test-only repair in
498d773 passed both native tests in rerun 41618049272, zero failures/skips.
See RELEASE.md for the failure evidence and local simulator limitation.
Submission is still stopped.

The separate November 3 security branch was reviewed and its conditional exit
failures reproduced. This UI/auth change does not remediate immutable deployed
contracts or claim a new security audit.

## November 3 — authentication and guideline corrections

Current production is `aa67a75` / https://d92b0dde.inheritance.pages.dev.
Official wallet authentication remains; the fake client-only World ID branch is
removed. Exit recovery storage is disclosed in the review and bilingual Privacy
Policy. Portal languages are now `en`, `ko`; country is KR and status remains
unverified. Only language and draft description fields changed. The TFH contract
review package is prepared, not sent or accepted. Final CI `41579363657`,
deployment `41579363738` and native iOS `41579363563` passed (2 native tests,
zero failures/skips). Actual Android sign-in/privacy/exit-review cancellation
passed; production files match. See RELEASE.md. Submission remains stopped.

## November 3 — exit flow correction

The operator rejected recipient removal without asset recovery. The new default
exit batches recipient removal and full recovery to the owner, with a separate
keep-invested/remove-only option. Already detached assets have a Home recovery
action. See [PLAN_EXIT.md](PLAN_EXIT.md) for behavior and recovery boundaries.
Fifteen dedicated local-chain and accessibility checks pass, including atomic failure,
process-loss recovery, missing operation hash and rounding-sensitive full exit.
Runtime `2938a05` is deployed at https://46b15c0e.inheritance.pages.dev.
Public HTML, four imported assets and six static documents match the immutable
release. CI `41483406456` and deployment `41483406606` passed. Both Chromium
and WebKit pass all 15 exit checks. Actual Android verified the final empty exit options and review/cancel.
Three preceding native iOS runs passed 2 tests each; final presentation run
`41483406437` ended before any test step because GitHub could not allocate a
hosted Mac runner. Do not call it an app test failure or pass. The current
auth/privacy correction and rerun results are in RELEASE.md.
No real funds, outbound messages or submission were used.

## Latest presentation revision — November 3 integration

Runtime `9e6857a` integrates the operator/Gemini changes and is deployed at
https://84332757.inheritance.pages.dev. Public production HTML, four imported
assets and six static documents/assets match this deployment. The incoming
15-file working diff was preserved privately before editing; the blue/white
layout, typography, anchored actions, legal styling and revised terminology
are retained.

Final corrections remove the death disclaimer from the general transfer guide
while keeping the living-owner transfer condition in pre-deposit review and
legal terms. Seven days means eligibility to receive, not guaranteed payment.
Unconditional safe/instant withdrawal wording was removed. Mixed received and
unreceived assets now show a receipt-status heading. Repeated success messages
cannot evict an error; duplicates refresh instead of accumulating.

Local validation: typecheck/lint/build; 10 locale checks; 13 mobile regression
checks; 66 error cases; 68 Chromium layouts including 37 axe accessibility
states with zero violations; 31 WebKit layouts; 10 disposable-chain user
journeys; 12 bilingual legal checks. Native iOS run `41472483141` passed both tests with zero failures/skips on
iPhone 16 Pro / iOS 18.5 Simulator. Downloaded result summary and keyboard /
process-recovery screenshots were inspected. This is a native test host, not
the actual iOS World App. Actual Android verified cold link entry, all guest
tabs, the expanded guide and Terms -> Privacy -> close after deployment.
CI `41472483108` and deployment `41472483240` passed.
Submission remains stopped. No real funds or external messages were used.

### Previous presentation revision — November 2

`b5842ae` is deployed at https://e2f8e217.inheritance.pages.dev after the operator
rejected the earlier wording review. Main change `ca7d390` replaces unexplained
Korean check-in labels with **기한 연장하기**, explains the chosen period with
concrete days, leads the funded Home with the deadline date, and reconciles the
owner/recipient, empty, asset, help, error and legal copy. The setup approval
action is **이 금액 맡기기**; the native wallet still requests final approval.
`b5842ae` shortens three first-use strings after actual Android reading.
See COPY_REVIEW.md's follow-up and the 21:24 KST RELEASE.md receipt.
CI/deployment and browser checks pass, public files match, and Android Home/Plan
show the final revision. New native runs 41443475080 and 41443966856 were still
running at 21:24 KST; do not reuse earlier native passes as results for this code.
Submission remains stopped. No new login or real transaction was performed.

### Previous presentation revision

`481b34f` is deployed (see the 19:50 KST RELEASE.md receipt); the whole-app
revision is `b643e0f`, followed only by a more precise registration success message. The whole-app copy
review covers entry, balances, setup, owner/recipient actions, fees, recovery,
alerts, history, errors and Korean legal reading. See COPY_REVIEW.md for the
criteria and examples. Typecheck/lint/build, CI, Chromium/WebKit, local financial
journeys and bilingual legal checks pass. Production files match the immutable
deployment and Android pixels confirm the revised Help and Korean legal dialog.
Native runs 41430777472 and 41431460190 have now both passed: two tests each,
zero failures or skips, confirmed from their downloaded Xcode result summaries
on November 2 at 20:21 KST. The earlier failed run 41424288591 never acquired a
GitHub-hosted runner; its check annotations identify runner capacity, not an app
test failure. See the latest RELEASE.md receipt. These are simulator test-host
results, not actual iOS World App approval/permission validation.
Submission remains stopped. Earlier runtime references above are historical.

## Historical objective and standing authority

The submission stop above overrides the earlier resubmission objective below.

Complete World App guideline remediation, actual-device validation, necessary
fixes/deployment and resubmission when ready. The user withdrew the earlier
submission and authorized these actions. Push and deployment are authorized.
They explicitly resumed work October 28 after the October 27 pause. After the
subsequent submission, the user rejected treating disclosed gaps as readiness,
withdrew the request, and instructed us to resolve TFH review procedure, a
defensible country scope and iOS validation before resubmitting. The engineering
assessment accepts the existing native iOS Simulator plus actual Android World
App evidence; absence of a physical iPhone alone is not a submission blocker.

ADB inspection/tap/input on the connected Android phone is authorized. Stop
captures during secret entry. The user subsequently authorized the agent to
handle authentication/confirmation steps; human input is still required for
biometrics or an unavailable device PIN. This does not expand spending authority.
One 0.01 WLD deposit/withdrawal test and its necessary costs were approved; this
is not permission to spend unrelated funds.
November 1 authority covers autonomous Android verification; only additional
funding transactions need an amount approval. The user initially deferred USDC, then approved 0.01 USDC and at most 0.15 WLD
combined network costs. The completed round trip cost 0.071165159939716087 WLD;
that approval is for this completed test, not unrelated future spending. The previous residual was recovered without an owner network fee.
Exactly one approved self-notification has already been used. Do not send another
notification, contact message, invitation or external inquiry without authority.

## November 2 16:03 KST — first-use revision submitted, Korea only

After the first-use walkthrough, actual Android correction/readback, final
browser checks, native host acceptance and CI, the authorized revision was
submitted. Independent Portal readback at **2026-11-02T07:03:28.119Z /
16:03:28 KST** confirms **awaiting_review**, exactly **KR**, developer allowlisting
true. Only `verification_status` changed from the immediate pre-submit snapshot.
App/metadata IDs are unchanged. Pre-submit main: `cf6f74f`; deployed runtime:
`85b3d2a`; native test source: `74d7667` (run 41402516155, two passes, no failures
or skips). The production alias matches https://89d74460.inheritance.pages.dev.

The improvement-focused submission covers the deadline/request/seven-day
explanation, separate sign-in and deposit approval, optional assets, recipients
outside saved contacts, visible interval rules and automatic reading-position
movement when opening setup. It links the reviewer walkthrough and source/test
evidence. Hero/setup previews and store copy match the revised interface.
The existing immutable-contract and realized-profit fee review request is
included. Native host approvals are described as simulated. This is review
pending, not TFH approval or public launch. No additional real transaction,
notification or external inquiry was sent. Private receipts and device evidence
remain outside Git. The phone was returned to Home without entering amounts.

## November 2 — first-use clarity verified

The operator requested a first-time-user walkthrough and further UI fixes.
Runtime `8cf931c` clarifies the deadline trigger, request/seven-day wait,
login versus deposits, optional assets and recipients outside saved contacts.
Pre-submit Portal readback was **unverified**, still exactly **KR**. The new
16:03 KST receipt above is the current status. Existing remediation,
deployment and Korea-only submission authority remains unchanged.
See the newest [RELEASE.md](RELEASE.md) section for completed checks and the
Chromium relative-profile-path diagnosis. Runtime `85b3d2a` also fixes the actual Android issue where Add to my plan
opened a form below the visible area. Production is https://89d74460.inheritance.pages.dev
(public alias matches all six imported assets). Deployment 41401139077 and CI
41401139045 passed; Chromium 68 layouts and WebKit 21 checks / 31 layouts passed.
Actual Android confirms the revised instructions and new form-opening behavior,
with the keyboard closed. The phone is back on Home and no values were entered.
Native run 41399668170 passed recovery but failed its pre-Done overlap arrangement;
Test-only `17d8e89` uses a slow drag and a final hold. Further geometry analysis
found the unresolved `@sam` error row makes the overlap infeasible under the
80px input-clearance floor. `74d7667` uses configured `@test_heir` and waits for
resolution, retaining the exact overlap and event-target gates. See
[KEYBOARD_DISMISSAL.md](KEYBOARD_DISMISSAL.md). Final native run
[41402516155](https://github.com/Daviswhistle/Inheritance/actions/runs/41402516155)
(test source `74d7667`) passed both tests, zero failures or skips. All five Done
traces start on the actual button, prevent touchend, emit no extra click, remove
input focus and restore actions. All four exact-overlap arrangements reached the
target in one measured adjustment. Pending-deposit recovery passed after process
termination. CI 41402516259 passed. Production code remains `85b3d2a`.
No additional funds or notifications are used.

## November 2 15:08 KST — revised UI submitted, Korea only

The operator-authorized revised release was submitted after runtime CI, native
lifecycle/recovery, browser, production-readback and actual Android UI checks.
Independent Portal readback at **2026-11-02T06:08:56.622Z / 15:08:56 KST**
confirms **awaiting_review**, exactly **KR**, developer allowlisting true. Only
`verification_status` changed from the immediate pre-submit snapshot. App and
metadata IDs are unchanged. Pre-submit main: `7e13bba`; deployed runtime:
`fd16206`; final native test source: `a89aec9` (run 41396499474).

The submission describes the clearer amount/recipient summary, separate wallet
costs, two fee roles and calculation tables, compact live-rate details, preserved
draft and interrupted-request recovery. The refreshed store preview is committed.
It links the reviewer walkthrough, source/fee evidence and verified test results.
Actual Android and the simulated iOS host are distinguished. Existing immutable
contracts and the realized-profit service fee are requested for code review.
This is **review pending**, not TFH approval or public launch. No new financial
transaction, notification, email or Telegram message was sent during this revision.
Exact changelog, private device evidence and the independent submission receipt
are retained outside Git.

## November 2 — deployed UX revision after operator withdrawal

The operator withdrew the 02:45 KST request and requested clearer mobile UI/UX.
Pre-submit Portal readback confirmed **unverified**, with **KR only** unchanged.
The revised release was verified and resubmitted as recorded above.

The review now leads with exact amounts, recipient and interval. A separate
wallet-debit receipt distinguishes the deposit from an additional WLD network
fee whose quote is shown in World App. Asset-manager and service fees remain
visible before unchecked risk consent. Per-asset calculation tables replace
long prose examples. Setup keeps live rate details available on demand;
recovery leads with completed deposits, remaining work and its next action.
The store setup preview has been regenerated from the revised test screen.

Runtime verification also reproduced a mined-receipt confirmation stall on an
idle Anvil chain: the provider cached the preceding block height and waited for
a future block event. Under the same 250 ms cache, the old block-event wait timed
out at 1,804 ms; direct receipt/confirmation polling confirmed at 309 ms without
mining another block. `529668f` retains canonical-hash, confirmation-count,
receipt-status, expected-event and post-state gates while polling the receipt.
`fd16206` also bounds receipt RPC waits by the request deadline. All 15
confirmation tests pass, including a stalled RPC, delayed confirmations, reverted
and mismatched receipts. No additional real funds or notifications were used.

Production source `fd162062d79b2f2af52bff98ff017af6dfbbb44a` is deployed at
https://inheritance.pages.dev and immutable https://e52ac60c.inheritance.pages.dev.
[Deployment 41395540398](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540398)
and [CI 41395540405](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540405)
passed. Public HTML and all six imported assets match the immutable release;
three legal documents return 200; the Worker is ready, funded and cycling without
a halt or last error. Chromium product checks passed 68 layouts; WebKit passed
21 checks and 31 layouts with zero page errors. The full local-chain flow passed
92 checks on the receipt-polling revision, followed by the final bounded-RPC
unit checks and stable-runtime Chromium/WebKit reruns. Translation (9), mobile
(12), type, lint, CSS usage and production-build checks passed.

Actual Android World App testing on Samsung SM-N986N / Android 13 confirmed
sign-in, Done dismissal, retained amounts, live-rate details, exact WLD/USDC
review amounts, separate conditional network fee, both fee roles and calculation
tables, disabled approval before consent, and Edit preserving both amounts.
The display-only 0.01 WLD and 0.01 USDC inputs were cleared and the app returned
to Home. No transaction approval, new spend or notification occurred. The new
store setup preview was uploaded and the Portal confirmed the metadata commit.

Native run 41395213145 passed the keyboard lifecycle but failed a stale
recovery-title assertion after the intended copy change. Run 41395540414 also
failed that assertion and stopped before a subsequent Done gesture because the
fixture could not align the interval label beneath the button; its first two
Done gestures passed. This run is not counted as acceptance. The exported
accessibility hierarchy from 41395213145 contains the restored “Continue
unfinished setup” region and heading; the test still searched for “Finish your
saved plan”. Test-only `a89aec9` corrects that expectation. Final native run
[41396499474](https://github.com/Daviswhistle/Inheritance/actions/runs/41396499474)
passed both tests with zero failures and skips on iPhone 16 Pro / iOS 18.5
Simulator. All five traced Done gestures started on the actual button, prevented
touchend, emitted no extra click, removed input focus and restored actions.
The intended exact label-overlap gate was reached before the relevant taps.
Pending-deposit recovery survived process death. Source `a89aec9` changes only
the test expectation relative to the deployed runtime. CI 41396499548 and
documentation CI 41397770996 passed. The native host uses simulated approvals
and is not actual iOS World App.

## November 2 02:45 KST — previous Korea-only request (withdrawn)

The operator selected **South Korea (KR) only** on November 2. The 01:52 KST
KR/AR/CO submission was withdrawn for this scope change. Independent Portal
configuration readback confirmed **unverified**, exactly **KR**, with only
availability copy and supported countries changed. After final verification,
the Korea-only request was submitted. Independent readback at **November 2
02:45:23 KST / November 1 17:45:23 UTC** confirms **awaiting_review**, exactly
**KR**, developer allowlisting preserved, and only verification_status changed.

Runtime `afd5bab` limits new plans and deposits to KR residence and KR network
location. Prior AR/CO residence records cannot authorize new requests. Existing
balances, withdrawals, renewals, claims and submitted-transaction recovery remain
accessible outside KR. Local eligibility (11 tests), WebKit (21 checks / 31
layouts), translation, type, lint and build checks passed; independent commit
review found no actionable defect. Production `4a35244` was deployed and independently checked; actual Android
Korea-only acceptance passed. Native policy run 41329500340 passed two tests
with no failures, including all five traced Done gestures without extra clicks.
Two subsequent native fixture failures were diagnosed before the Done action.
Test-only `340fefd` corrects the fixture and query timing; final native run
41331879980 passed both tests, all five Done gesture assertions and pending
recovery. CI and independent review passed. The failure evidence and corrections
remain in KEYBOARD_DISMISSAL.md; the submission receipt is tracked in RELEASE.md.

The keyboard cause and fix remain established by the before/after native trace:
see [KEYBOARD_DISMISSAL.md](KEYBOARD_DISMISSAL.md). The previous three-country
submission receipts below are historical and no longer the active request.

## Historical verified checkpoint

- Runtime source: `85b3d2a6081467f9e3a4be879a3b693047a11407`, descendant of requested baseline `91944cc`.
  Main is the continuation branch. See [RELEASE.md](RELEASE.md) for current CI,
  deployment, native-test and independent-review receipts.
- Production: https://inheritance.pages.dev ; immutable: https://89d74460.inheritance.pages.dev.
  Deployment [41401139077](https://github.com/Daviswhistle/Inheritance/actions/runs/41401139077): passed for this runtime; Pages and notification Worker deployed successfully.
  CI [41401139045](https://github.com/Daviswhistle/Inheritance/actions/runs/41401139045): passed, all three jobs successful.
  Readback: November 2 KST readback passed: production HTML and all six imported JS/CSS files match the immutable deployment; three legal documents return 200; the Worker reports ready, funded and a fresh cycle with no halt or last error.
- Financial UI separates dated lending/reward rates, live strategy fee, service
  fee and conditional WLD network costs. Review shows per-token deposit amounts
  plus the conditional fee as total-debit components; the SDK does not expose an
  exact preapproval network quote to this mini app. Quote and settled debit differ.
- Earlier validation: November 1 discovery/metadata browser scenarios passed 10 checks; typecheck/lint/build and 12 mobile units passed. Independent commit review of `ff66905` found no actionable defect. The preceding runtime consolidated factory event scans and deferred optional metadata until details open; actual Android Home/Plan/Assets/details reopened without the earlier RPC warnings.
  Earlier full-withdrawal validation: the complete local-chain browser suite passed 92 checks, including refreshed/full/partial withdrawal, identity outage recovery, idle USDC plus WLD exit, and WLD arriving during approval. Separate automated code review: completed against the complete final commit with no actionable findings; its focused checks covered seven withdrawal scenarios and keyboard closing/recovery.
  Logic-source iOS (`ff66905`): [41299595716](https://github.com/Daviswhistle/Inheritance/actions/runs/41299595716) — passed on iPhone 16 Pro / iOS 18.5 Simulator: two tests, zero failures and skips; exported screenshots and raw summary independently inspected.
- Physical Android: Samsung SM-S911N / Android 16 / World Money 4.0.4602 on November 1 (4.0.4401 for October tests).
  Login cancel/retry/success, keyboard Done, legal title, contact cancellation,
  manual recovery/selection, notification status, one received self-notification,
  deposit cancellation, real deposit, close/reopen and principal withdrawal passed
  for the specifically recorded versions. See [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).
- Real-money test used `e4be10c`. Deposit principal 0.01 WLD; quoted network fee
  0.098 WLD. Actual net network fee 0.063726535762749712 WLD; actual deposit debit
  0.073726535762749712 WLD after the unused reserve was refunded. Withdrawal
  returned 0.010000000000056801 WLD with zero owner WLD network fee.
- The original live All action left 2923 token wei after a quote-refresh race.
  On November 1 the fixed All action recovered the remaining 2923 wei. The
  canonical receipt and post-state confirm zero idle/shares/assets/cost basis,
  hasAssets=false, and zero owner WLD fee. Close/reopen restored the empty
  position. No unrelated wallet-held USDC shares were used.
- November 1 also exercised native notification re-grant: cancel/off, retry,
  activate/on. No additional notification was sent. Keyboard Done, background
  draft retention, insufficient-USDC-balance blocking and contact-cancel manual
  recovery passed on the updated World Money host.
- Subsequent live USDC test: 0.01 USDC deposited, restored after close/reopen and
  fully withdrawn; canonical zero cash/shares/assets/cost basis, hasAssets=false.
  Quote 0.11 WLD; actual combined network cost 0.071165159939716087 WLD, with no
  extra withdrawal debit. Existing wallet shares and native ETH were unchanged.
  Actual beneficiary claim to receipt still needs a willing heir and real deadlines.
  Do not label Android as exhaustive.
- `8cf03af` only corrects English/Korean wallet-share fee wording: the screen also
  shows externally obtained shares, so it cannot claim a prior inheritance fee was
  paid. Typecheck/lint/build and CI passed; transaction logic is unchanged.
- Private phone/transaction/contact evidence stays outside Git. Do not publish
  tester-linked addresses, transaction linkage or screenshots in public docs.

## Historical November 2 submission — subsequently withdrawn

Regional controls are deployed and production readback passed. The actual
Samsung SM-N986N / Android 13 / World Money 4.0.4602 passed residence blank,
unsupported-country choice, explicit KR confirmation, Help reset, close/reopen
persistence and blocked/unblocked top-up controls; no new money or notification
was used. The Portal description now explains the controls; an independent
readback confirmed only description changed and KR/AR/CO remains unverified.

Runtime iOS run [41318884346](https://github.com/Daviswhistle/Inheritance/actions/runs/41318884346)
passed two tests with zero failures/skips; raw summary and screenshots were read.
The preceding run failed once after foreground/Done moved focus to the period
field. Test-host-only `dcec319` added event tracing and three repeated foreground/
dismissal cycles. Native run 41320004172 and CI 41320004149 passed. All traced Done
taps reached the button and restored controls. The original failure did not recur
in two subsequent executions; its cause remains unconfirmed, and no runtime
keyboard fix is claimed. That earlier readiness judgment was rejected; the cause-specific reproduction
and correction above supersede it. See RELEASE.md for the exact evidence boundaries.

The authorized resubmission is complete. Independent Portal readback at
2026-11-01 15:23:28 UTC / November 2 00:23:28 KST confirmed **awaiting_review**,
metadata `meta_9cf3b324ec9a1838a56c5b6d98be8674`, KR/AR/CO unchanged and developer
allowlisting preserved. Only verification_status changed after submission.
The submitted changelog requests review of existing contracts and the service fee,
reports the pre-deployment sharing gap and asks for a separate intake if required.
Do not resubmit again or send an inquiry automatically; the next step is the
actual review outcome. No additional money, notification or email was used.

## External decisions still open

Portal app `app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, is now configured for **KR only**.
Earlier KR/AR/CO requests were withdrawn. Use the current release section and
[RELEASE.md](RELEASE.md) for the latest verified submission status.

The operator is an individual in Korea and explicitly selected Korea-only launch
on November 2, superseding the earlier maximum-country instruction.
There is no historical pre-deployment TFH source-sharing or legal-review record.
One approved source-review/remediation inquiry was sent to TFH October 25 at
15:33 KST. The sent thread was rechecked November 1 with no reply or decision. Earlier
related-inbox checks also found no decision. The Korean classification inquiry remains unsent. Do not duplicate
messages or treat a sent email as TFH acceptance. [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md)
records the Korea-only decision and the previous candidate assessment, including specific
reasons other markets were not added. The Korean no-reporting software-service
interpretation is now the operational basis; an FIU reply is not a prerequisite.
Do not invent a universal paid legal report, incorporation, audit or device-certificate rule. A disclosed review request does
not establish legal clearance or TFH acceptance of the historical sharing gap.

## Readiness criteria applied to this resubmission

This is the user's project-specific readiness requirement, not a claim that the
Portal imposes a universal legal certificate or physical-device attachment.
Do not resubmit merely by listing these gaps in a changelog. The original review
rejection concerned UI/UX and tab distinction, not contracts or countries; do not
conflate it with our separate compliance findings. The official Portal is the
submission route; @MateoSauton is an official post-rejection contact, not a newly
invented mandatory preapproval. A prepared Telegram message remains unsent after
the user corrected the rejection premise instead of authorizing it.

1. The latest November 1 instruction is to finish preparation and then submit,
   requesting review of the existing public source and fees through the official
   Portal. The user explicitly declined another support email. Include the
   unverified pre-deployment sharing history and ask for any required separate
   intake/remediation step. This authorizes requesting review; it does not
   establish TFH acceptance or retroactively satisfy source sharing.
2. KR only is the authorized initial scope. The official UI checks trusted KR
   edge country and explicit KR residence confirmation before new vaults and
   deposits, including retries and top-ups. Unknown/outage cases fail closed.
   Preserve withdrawals, renewals, settings, existing claims and receipt recovery.
   Verify runtime deployment/readback and device results before submitting.
3. Retain the verified iOS evidence and its scope: the actual WebKit/MiniKit
   native-host tests passed on local iOS 27.0 and final-source CI iOS 18.5; actual
   Android World App testing covered native flows and the principal round trip.
   The simulator host models approval callbacks; it does not establish the real
   World App iOS approval/permission screens. Physical iPhone testing is useful
   additional evidence, not an invented universal prerequisite. The user has no
   available iPhone; do not block only on that fact or repeatedly request one.

A TFH follow-up and Korean classification inquiry were prepared but not sent.
The government inquiry is optional and currently held, not a required launch
process. First apply current legal definitions to the actual service and narrow
any remaining decision-changing question. A separate outbound approval is still
needed before sending a new email, contact message or government inquiry; the original TFH
permission covered one send. No new funds transaction or paid service was used.

Read [RELEASE.md](RELEASE.md), [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md),
[GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md), [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) and
[REVIEW_NOTES.md](REVIEW_NOTES.md). Recheck current state before acting. Resubmission
is authorized only after the substantive readiness work is complete.

This Mac has Xcode 27.1; select it per command with DEVELOPER_DIR rather than
changing the global developer directory. Local native hosts use real MiniKit
transport, fixture funds and simulated approvals. Keep that evidence separate
from actual World App iOS testing.
