# World App deployment work — 2026-11-03

## Current result and authority

The operator wants deployment fees paid from World App wallet
`0xE819320Ed3D03f9912b06a48cC5E7f06060CC67a`, also the new immutable fee recipient.
**No mainnet funding, signing, factory deployment, asset migration or submission
has been performed. No money has been spent.** Amount-specific approval is still
required before a real transfer. Submission remains stopped.

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
CREATE verifications, WETH return and corrupt-journal rejection passed. The
pending-nonce refusal was source-reviewed but not separately fault-injected.
Independent source review found no remaining blocker for preserving this
preparation. Production dry-run reports `awaiting_fixed_funding`; no real key was
used to sign. The failed native funding path remains the execution blocker.

## Evidence and remaining work

Private evidence root: `../evidence/worldapp-deployment-nov03/` relative to the
repository. **Do not upload the whole directory**: it includes private signing
material and device evidence. Public source contains only the reviewed manifests.
`fallback-local-proof.log` records fork evidence;
`funding-final-chain-readback.json` records final block 37189772: funding account
balance/nonce zero and both factories without code.

Remaining: establish a supported gas-funding path before asking for an exact
real-funds approval. Temporary permissions and production operator hosting have
been cleaned up and verified. The attempted World App funding route is currently blocked. Native
preflight rejection must not be described as successful deployment or disguised
through a different opaque call route. New contract receipts, exact deployed-code
verification, app/backend rollout and any legacy asset movement remain separate
unfinished steps.

References: [World sendTransaction](https://docs.world.org/mini-apps/commands/send-transaction),
[World withdrawal instructions](https://support.world.org/hc/en-us/articles/32733048611859-How-do-I-withdraw-tokens).
