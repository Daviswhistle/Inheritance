# World App deployment work — 2026-11-03

## Funding approved and received — 2026-11-04

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
