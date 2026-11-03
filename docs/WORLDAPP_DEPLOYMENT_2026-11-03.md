# World App deployment work — 2026-11-03

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


## Cutover preparation while finality is pending

Fresh approved-budget reprice uses 29915834628217 wei total conservative reserve
for two CREATEs and wrapping/return, within the 40000000000000 wei cap. This is
an estimate, not spent cost; the guarded runner reprices again before each sign.

Read-only rollout audit found that both legacy generations must be preserved:
- WLD legacy: `0x1a856aE8c3abd8a3746F542688a1846Bc6208435` and
  `0xfC3F6f0B2234923b3F3aDBAaC797e920C8FdA248`; earliest block 35795652.
- USDC legacy: `0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2` and
  `0x67c8DE756FCD04dc5976960533931984d0348758`; earliest block 35802847.
- Both VITE_LEGACY_* GitHub variables and the separate backend LEGACY_* variables
  need these lists. Workflow defaults add only the oldest generation, not the
  immediately previous primary. Align backend/wrangler.toml too.
- New primary deployment blocks must come from each actual CREATE receipt, never
  the funding block. Do not activate predicted addresses before full bytecode,
  configuration and child creation-code verification.
- Deploy the remediated Worker, verify every primary/legacy route, then publish
  the frontend. Retain all old Portal entries. Automation health must trust seven
  factories (basic plus six yield),
  up from the current five. Asset migration is separate and not authorized here.

The ethers tuple fix (`c989331`) and actual-receipt offline regression (`a4002a9`)
are pushed along with the late-native-result fix (`de817ee`). CI 41666722191 was still running at the latest check; local canonical proof,
negative fixture cases and runner regressions pass.
Hosted operator build remains 1f49012b5f57. No permission or product cutover occurred.

`15b29a7` adds a read-only deployed-factory gate, and `3d7b478` wires Pages after
Worker deployment and support verification. All five currently live factories
passed the exact workflow check against live health. The seven-factory proposed
configuration correctly fails until the new two are deployed/configured. Ten
negative/positive offline tests passed; the checker is wired into CI. These
workflow changes are source-only and have not cut over production.

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

## Deployment authority and production baseline

The operator wants deployment fees paid from World App wallet
`0xE819320Ed3D03f9912b06a48cC5E7f06060CC67a`, also the new immutable fee recipient.
**Approved funding is received and verified; factory deployment, asset migration
and submission have not occurred.** Deployment and remainder return may spend up
to 0.00004 ETH in total from that funding. Additional funding needs separate
approval. Submission remains stopped.

Normal production app runtime remains `f6dc58a`. Its rebuilt baseline is pinned
to `a8056264c8551fdea191574d919a409871722cb9`; root HTML SHA-256 remains
`3029614b2b89b21fe4a4ea00cdb6cbee385cbb21cbf3a224576d32427b0ddb35`.
Only isolated operator pages were hosted. App, auth and notification Worker jobs
were skipped; no database, production secrets or normal API bindings changed.

## Native direct deployment attempt

`565d920` prepared fixed CREATE2 calls through canonical Safe 1.4.1 CreateCall
`0x9b35Af71d77eaf8d7e40252370304687390A1A52`. Exact Safe-sender RPC and local
Safe-fork checks passed. Both predicted addresses remain **not deployed**:

| Factory | Direct-helper prediction, not deployed |
| --- | --- |
| WLD | `0xDA2d66dacd585B44c124Ae3f1f62F65715496fEA` |
| USDC | `0x030BF4E5d3d582B077E695CaC4F52d99d62951b4` |

Actual Android initially exposed an operator SIWE statement mismatch. `a165cfd`
uses the shared canonical `Sign in to Inheritance` statement; the existing server
policy is unchanged. Native authentication then passed server verification for
the exact target wallet.

Four WLD native preflight attempts returned `simulation_failed`, before any cost
quote, approval or user-operation hash. Diagnostic retries followed definitive
non-submission, not unknown outcomes. Commits `dcca257`, `20aa6ef`, `be56b6e`
added bounded redacted diagnostics and versioned assets. The final native
`details.debugUrl` was a string that did not parse as a supported HTTPS URL; no
usable trace was obtained. The exact simulation cause is **unconfirmed**. Neither
a World App gas ceiling nor a general CREATE2 prohibition has been established.

The CreateCall helper was removed from the Portal allowlist. The production
`/operator-deploy.html` route was removed by the later funding-only publish.
Historical immutable hosts do not establish current authorization or deployment.

## Fixed funding fallback prepared

`f37ef28` prepared an isolated temporary deployment account:
`0x9d5B282dE3a3Fad67EdcFA157D626F8Fc662606E`.
Its encrypted key is local/private and must not be included in public artifacts.
Key creation is pinned: missing or mismatched key material halts instead of
creating a replacement account. No production signature has been made.

Committed `deployment/worldapp-funding-2026-11-03.json` is the exact public intent:

- Manifest hash: `0xfd2eb55e812d764329aa10a050548a26e6a92aa85c6ac76d99c24d384d765697`.
- Proposed funding: **0.00004 ETH**, not yet approved or transferred.
- One atomic native batch: canonical WETH withdraw of that amount, then native
  ETH transfer to the single fixed account. No query overrides or arbitrary calls.
- Normal CREATE nonce 0 WLD prediction:
  `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff`.
- Normal CREATE nonce 1 USDC prediction:
  `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e`.
- Both predictions are **not deployed**. Both new factories fix the fee recipient
  to the World App wallet above, with the existing 1,000 bps service fee and
  canonical asset/strategy configuration.

At observation block 37189134, estimated two-deployment plus remainder-return
cost was 0.000023897360628842 ETH; the conservative gas/L1/operator reserve was
0.000029896404525198 ETH. These are RPC estimates, **not a World App fee quote**.
World App's additional sending fee is unknown. Any signing path must reprice each
step, respect the approved cap and return the usable remainder to the same wallet.

The actual Safe funding batch and both normal CREATE deployments passed isolated
fork checks, including full generation verification. Fork gas was 95,684 for
funding, 7,047,274 / 7,107,968 for deployments and 44,866 / 29,433 for the two
WETH remainder-return calls. The fork does not charge real OP L1/operator fees.
Rejected funding's second call rolls back the first withdrawal atomically.

## Hosted funding route and actual phone result

Funding-only hosting run `41649046210` succeeded at `f37ef28`, immutable host
https://5cc5abbb.inheritance.pages.dev. CI `41649045792` passed. Production
readback verified build `bea548c6e689`, the pinned funding manifest, unchanged
normal root HTML, and removal of the old direct-deployment page.

The page requires server-verified target-wallet authentication, exact chain and
wallet/WETH code hashes, and an unused zero-balance recipient. It persists an
attempt before calling the native bridge, uses an origin-wide exclusive lock,
and blocks unknown outcomes across reloads. Known non-submission permits a manual
retry only after investigation. This is a **single connected device** procedure;
there is no cross-device submission lock.

The first actual Android funding attempt returned **`validation_error` before
execution**, no quote or userOpHash. The native sheet showed a generic error.
The initial diagnostic sanitizer showed `details: [omitted]`; this did not prove
whether the original field was absent, null or another type. `1ab9480` adds safe
shape distinctions, bounded redacted string/array details and tests, without
changing the transfer payload. The second diagnostic-only native attempt at build `5fa193109e76` returned the
same `validation_error`, with `details` confirmed **undefined**. There was no
quote, approval or operation hash. Hosting run `41650768551` succeeded; the
normal root HTML hash remained unchanged. The error cause remains unconfirmed.

Block 37189627 readback confirmed temporary account balance 0, nonce 0 and no code;
both predicted factories also had no code. Actual phone navigation through
More → Withdraw → Ethereum → Crypto app → World Chain → Other explicitly offered
**WETH**, not a native-ETH option. No destination/amount was submitted there.
Sending WETH alone would not supply the EOA's native gas balance.

After the second definite non-submission, the current twelve-entry list was
reopened and checked. The temporary WETH and funding-account entries were removed
through the Portal MCP, restoring exactly the ten previous entries. The response
confirmed ten contracts and unverified status; Permit2 permissions were unchanged.
Operator-page removal run `41651316157` succeeded and both HTML routes returned
the unchanged normal SPA. An old JS bundle was still served from cache, so
`035b93a` adds inert retirement files for both script paths; cleanup run
`41651597772` succeeded. Final production readback confirms both HTML routes
return the unchanged normal SPA and both script paths contain only a 62-byte
inert retirement comment (SHA-256
`c6d428279a0c4405b8b0213f4e9bdb9c3c417ad41aafc9c2a1c313f3ef4173ac`). App remains KR only; no resubmission was made.

## Guarded runner — prepared, not executed on mainnet

`scripts/run-worldapp-fallback.mjs` defaults to read-only dry-run. Production
signing requires exact funding/deployment manifest approvals, the fixed cap,
and verified funding transaction/user-operation evidence. The funding-proof
module decodes canonical EntryPoint/Safe/MultiSend calls and requires the exact
reviewed two-call batch. It does not currently accept arbitrary external funding.

Before signing, the runner verifies pinned source/artifact hashes, constructor
arguments, chain and recipient. A private lock and journal prevent concurrent
execution; it re-reads state under the lock and requires both latest and pending
nonce to match. Signed transaction bytes are persisted before broadcast; unknown
submissions only allow the same bytes, never a newly signed replacement. Each
CREATE receipt receives full generation verification before the next step.
Costs are repriced with OP L1/operator reserves; nonce 2/3 return usable remainder
as WETH to the fixed World App wallet. Remaining native dust and keys are retained.

`fallback-runner-test.log` records chain 31337 test-only signatures for nonces
0/1/2/3. Dry-run without key access, missing approvals, unsolicited dust, exact
funding decoder, durable-before-broadcast, byte-identical recovery, both full
CREATE verifications, WETH return and corrupt-journal rejection passed. The final test also injects latest nonce 1 / pending nonce 2 and verifies
refusal before any new signature, as well as a cost-cap increase refusal.
Independent source review found no remaining blocker for preserving this
preparation. Production dry-run reports `awaiting_fixed_funding`; no real key was
used to sign. The failed native funding path remains the execution blocker.

## Follow-up after the operator confirmed World App is the only wallet

The failed direct-native transfer route above is retired. A separate standard
contract route is being prepared; it must not be confused with the failed v1
batch or called successful before a native quote and canonical receipt.

Uniswap's official World Chain registry identifies SwapRouter02 at
`0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6`. Its live runtime hash is
`0x8ae42530d55520d11a2d614228b01a9e9f9e85f5625606b6fa8e9e253d35c56d`,
WETH9 is canonical WETH, and observed WETH/native balances were zero.
The proposed atomic batch is WETH.transfer(router, q) followed by
router.unwrapWETH9(q, fixed deployment EOA), both value zero. It requires no
price swap, new helper deployment or allowance. **Never split these calls into
separate transactions**: intermediate router balances are publicly withdrawable.

The unwrap function sends its whole WETH balance, with q as a minimum. Zero
preflight balance cannot prevent a donation while approval is pending. The
receipt verifier therefore still requires exactly q to arrive; any mismatch
halts without another funding request or deployment signature.

`deployment/worldapp-router-funding-2026-11-03.json` preserves q, EOA, deployment
manifest and both constructor hashes. Its schema is separate v2; v1 remains a
historical artifact. Fresh block 37190038 quote reserves
0.000029181508180761 ETH for deployments and return from q=0.00004 ETH. This is
not the World App sending fee.

Commit `064de83` freezes manifest hash
`0x59421057c53ab0bbfb1c7cd07ffb33a7c5ce1b2fd44bd539734c0087e7e9a208`.
The actual Safe fork batch consumed 105,643 gas and passed exact-q/rollback/dust
checks. The v2 runner test passed CREATE/return/recovery and both fixed batch
wrappers; production signing remains unexecuted. UI commit `81e9c2d` passes
browser negatives for router hash/getter/inventory and prior unknown intents.
Native build is `4be96bf5e6d0`; hosting run `41653827159` is pending verification.
The Portal temporarily allows original ten contracts plus WETH and SwapRouter02,
with unchanged Permit2 permissions. No EOA or CreateCall helper is allowlisted.

Historical actual native receipts revealed that World App uses canonical Safe
1.4.1 MultiSend `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526`, runtime hash
`0x0e4f7fc66550a322d1e7688e181b75e217e662a4f3f4d6a29b22bc61217c4b77`.
The verifier previously accepted only canonical MultiSendCallOnly. It now pins
both exact address/hash pairs, preserving exact outer and inner call checks.
This was discovered before funding, not after spending user funds.

References: [Uniswap World Chain deployment registry](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-world-chain-deployments),
[unwrap implementation](https://github.com/Uniswap/v3-periphery/blob/main/contracts/base/PeripheryPayments.sol),
[Safe 1.4.1 MultiSend registry](https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/multi_send.json).

## Evidence and remaining work

Private evidence root: `../evidence/worldapp-deployment-nov03/` relative to the
repository. **Do not upload the whole directory**: it includes private signing
material and device evidence. Public source contains only the reviewed manifests.
`fallback-local-proof.log` records fork evidence;
`funding-final-chain-readback.json` records final block 37189772: funding account
balance/nonce zero and both factories without code.

Remaining: read back the v2 hosted route and inspect its actual native fee quote
before asking for an exact real-funds approval. The earlier direct-native route
remains failed and retired; the standard router route has not yet been accepted
by World App. Native
preflight rejection must not be described as successful deployment or disguised
through a different opaque call route. New contract receipts, exact deployed-code
verification, app/backend rollout and any legacy asset movement remain separate
unfinished steps.

References: [World sendTransaction](https://docs.world.org/mini-apps/commands/send-transaction),
[World withdrawal instructions](https://support.world.org/hc/en-us/articles/32733048611859-How-do-I-withdraw-tokens).
