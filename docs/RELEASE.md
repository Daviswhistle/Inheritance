# Release evidence

## October 5, 2026 operations and product candidate

This adds per-vault Durable Object alarms and a derived eligible-claim queue.
A pending financial transaction no longer stops other funds from being observed
or notified. The existing D1 signer lease, exact staged signature, gas reserve
and finalized receipt checks still govern every payout. Healthy distant funds
wake at most four hours apart and at the earlier existing reminder, expiry or
challenge boundary. Registration requests a prompt check. An actual 1,000-row
SQLite test bootstraps schedules in five 200-row coordinator ticks without
scanning the chain; it does not certify 1,000 live users or an execution SLA.

A separate five-minute watchdog uses persisted Durable Object alarms and a Cron
recovery path to track failed checks, stale execution, observed
pending duration, gas and fee limits. Telegram delivery has persisted attempts,
retries, incident deduplication and recovery notices. It shares Cloudflare with
the service and is not a monitor outside that provider. No paid upgrade or new
onchain transaction has been made for this task.

Income history verifies only canonical finalized `IncomeWithdrawn` receipts,
keeps exact WLD/USDC units, groups them by UTC month and exposes incomplete
coverage. It does not count deposits or principal as income. Older bytecode
without the income API is marked unsupported. Korean/English primary screens
include persistent language choice, resolved heir names and full recipient
addresses. Rare errors and advanced legacy/reward screens still use English.
A delayed identity response can no longer overwrite an edited interval.

Local validation: 151 genuine financial Anvil checks; 27 actual SQLite scheduling
checks including 1,000-row bootstrap, concurrent payment discovery and database
outage rearming; 11 runtime-boundary checks; 68 auth, 28 alert and 16 DB checks;
18 watchdog and 14 fee-report checks; 9 history and 6 translation checks; 75 unified
browser checks plus 43 WLD and 16 USDC browser checks. Types, lint, production
build, localized-copy gate, CSS and both Worker packages pass. New native-browser
coverage verifies genuine collected income, immediate asset isolation, heir name,
Korean selection and narrow layouts, finality-error recovery and history retained
after factory rotation and release; the World App bridge remains a fixture. Checks
and immediate scheduling are serialized per actor, and missing timing fields
retry within one minute. Public fixture accounts sign locally on the current
Anvil chain, including deliberate chain switches. Unsupported FIFO
sources retire, and a vault-specific RPC failure preserves its hint with backoff
so later claims can proceed. The report checks the actual RPC chain ID, uses
public-RPC-compatible log pages and rejects events outside the requested page.
Basic balance-only read failures retain one-minute retries and error visibility;
recovery delivers the waiting owner warning. Known Morpho receipt existence still
works without cash valuation. Unfinalized slot releases retry once per minute and
keep monitoring until finalized or removed.

The read-only report separately records cash fees, WLD rewards, strategy shares,
execution gas and chain extras. Missing vault coverage, operator fee evidence,
FX or operating costs stays unknown. Four recorded treasury receipts were read
without spending gas; their missing operator-fee evidence prevents a complete
expense or net-profit claim. See [operations instructions](OPERATIONS.md).

The reviewed `9200fe0` operations commit is live in the primary Worker as version
`4083bf78-05d0-4d14-92ec-a25377438b54`. Migration `0004_scheduling` is applied,
the existing database and signer bindings are retained, and ten consecutive
observed Cron cycles completed successfully at 3–4 ms caller CPU time. The live
queue was initialized with no active watchers or pending payouts at verification;
this is not a live payout test. Both exact-commit CI runs and the completed native
review passed. The separate watchdog's original Cron did not produce a sample
for more than 25 minutes, then started with timed-out health fetches. The corrected
public Worker-to-Worker fetch configuration and added independent alarm path still
require their own reviewed deployment and two advancing healthy live samples.

Frontend and new income contracts remain
part of the combined launch gate below; this candidate has not been activated in
World App or the store. Current treasury and keeper balances are unchanged from
the values recorded below. The October 5 KST read-only combined activation reserve
is 0.000045079717486484 ETH including bot funding, leaving a
0.000021328175246647 ETH treasury shortfall. Keep the keeper reserve available for
payouts; independent deployment quotes cannot be funded separately from the same
starting balance.

## October 4, 2026 candidate — deployment pending

The candidate adds a unified WLD/USDC plan with default Morpho routes, protected
owner income collection, 10% realized-gain fees and purpose-constrained operator
gas funding. Previously deployed factories remain supported. The launch interface
now presents
Home, Assets and Plan; creation begins with token amounts and a local exact-value
review, income collection leads asset management, and optional account/principal
details remain accessible through disclosures. Store images use the same gift
identity as the application. Contract and runtime commits have completed
independent internal commit review. Local validation, including the adapted legacy
browser suite, has passed. Publication requires complete contract activation and
independent review of the latest launch-interface commit.

| Candidate verification surface | Current evidence |
| --- | --- |
| Combined Solidity suite | 375 passed, 0 failed; 5 opt-in fork tests skipped locally |
| Genuine World Chain protocol forks | 20 passed; transactions ran on local forks |
| Automated executor, actual Anvil | 141 passed |
| Guarded gas Worker, actual Anvil | 12 passed |
| Authentication | 68 passed |
| Alert decisions / database persistence | 28 / 16 passed |
| User-operation and receipt confirmation | 11 passed |
| Unified-plan actual browser checks | 66 passed, including confirmation retry after a pre-journal failure without an unrelated render while blocking duplicate taps; exact local final review, 320px layouts, single income card and recipient reset on asset switch, and Assets duplicate-deposit prevention and ordinary-deposit monitoring after cancelled setup; consented atomic check-in during interval alignment and required check-in receipt proof, partial-deposit monitoring, edit continuity, unavailable monitoring timeout and missing-route journal preservation; genuine SDK rejection before native handoff, completed-asset fee-query outage, receipt recovery before fresh consent, durable settings recovery, daily wallet-policy rejection, historical creation proof, USDC-held WLD totals and owner management from a shared link |
| Adapted legacy browser suite | 185 passed across stages: 30 transactions, 31 layouts (default and expanded disclosures), 38 notifications, 32 cancellation/recreation, 23 roles, 5 role recovery, 13 factory selection, 6 discovery and 7 outages. The final 30/32/23/13 checks use focused reruns after fixture adaptation; cancellation and role fixtures own fresh basic-only Vite configurations. Mainnet reads had 0 failures. |
| Morpho asset-specific browser flows | 43 WLD and 16 USDC checks passed on Anvil with current launch navigation, including rewards, liquidity failures, exits, claims and archived payouts |
| New income ABI / legacy routing | 132 functions matched / 28 route checks passed |
| Rewards proof / dated yield-rate validation | 25 / 18 passed |
| Frontend types, lint, build, CSS and English-only copy | Passed |
| Current UI store compositions | Six refreshed compositions below 500 KB, including combined WLD/USDC overview and protected income collection |

Production has not received this candidate. At the last preparation check, the
World Chain deployment treasury had 0.000023751542239837 ETH, below the combined
new-factory and guard activation reserve; the dedicated keeper reserve is retained.
The October 4 KST read-only preparation budget is 0.000044432928863794 ETH,
including 0.00001 ETH bot funding, leaving a 0.000020681386623957 ETH shortfall.
The Developer Portal metadata is `unverified`, reconfirmed by the app config
on October 4; the previous review has been removed. The treasury also has zero
WLD and USDC to self-fund activation. Its existing registration uses the
production URL whose
latest Pages frontend deployment is `3eb2e3d`; gas Worker deployment evidence at
`4e81931` is a separate surface. Existing portal copy still describes optional WLD
yield and separate setup and has not received this candidate. New deployments,
canonical bytecode verification, address
and legacy configuration, portal allowlisting, exact-commit CI/deploy receipts and
live health checks remain release gates. No production gas swap is claimed.

The previous notification Worker has an intermittent CPU failure. A live Cron
trace at 2026-10-03 19:18:48 UTC on version
`6a3ceebe-3b12-4633-964f-09212acbc49e` ended with `exceededCpu` and
31 ms CPU time and a stale completion timestamp. The same version completed
empty cycles at 37–41 ms on October 4; these successes do not establish operation
within the [10 ms Free Cron CPU budget](https://developers.cloudflare.com/workers/platform/limits/).

The CPU fix reuses parsed ABI definitions, prepares the signer at startup and
records empty cycles without chain RPCs. Actual execution now runs through the
internal SQLite-backed `InheritanceExecutor` Durable Object, with its
[30-second default CPU allowance and Free-plan availability](https://developers.cloudflare.com/durable-objects/platform/limits/).
The existing D1 journal, signer lease, gas reservations and financial checks remain
authoritative. Public requests cannot start payouts and a missing binding fails
closed. The 141 genuine local Anvil checks, eight scheduled-runtime checks, 68
auth checks, 28 alert checks and 16 database checks pass.

A hosted public-key fixture exercised signing and signed-transaction identity
recovery without broadcasting any transaction. Its Durable Object reached 51 ms
CPU while the calling Worker used 0–1 ms; all 14 observed invocation traces
completed successfully. This establishes runtime isolation, not a real inheritance
payout. Production acceptance still requires the exact deployed version,
`executionRuntime: "durable_object"` and advancing successful cron completions.
This path requires no subscription upgrade; shared account
[Free request and duration allocations](https://developers.cloudflare.com/durable-objects/platform/pricing/)
still apply. No billing change has been made.

A local browser bridge and internal commit review do not verify native World App
approval sheets or recipient push arrival and do not constitute an external audit.

## October 2, 2026 release — historical evidence

This records reproducible release validation and its limits. Production deployment receipts belong to the exact release commit in GitHub Actions. Verify the live service separately through `/api/health` and a fresh, advancing `/api/automation/health` cycle; local test results do not establish deployment or World App store approval.

| Verification surface | Result |
| --- | --- |
| Solidity contract suite | 140 passed, 0 failed |
| Automated executor, real Anvil chain | 69 checks passed |
| SIWE, device-clock tolerance, issuance limits, paginated permissions, notification links, durable alert records and monitoring finality | 57 passed, 0 failed |
| Alert decision and recipient delivery parsing | 28 passed |
| Notification database persistence | 16 passed, 0 failed |
| MiniKit operation/receipt confirmation | 7 passed, 0 failed |
| Human-readable revert messages | 53 passed, 0 failed |
| Browser transaction flows | 27 passed, 0 failed |
| Browser mobile layout | 33 passed, 0 failed |
| Browser notification UX and immediate post-creation management | 32 passed, 0 failed |
| Cancelled vault and release/recreate | 31 passed, 0 failed |
| Owner/heir roles across tabs and phases | 29 passed, 0 failed |
| Chain outage/recovery | 7 passed, 0 failed |
| Temporary role-read failure and subsequent real timer renewal | 5 passed, 0 failed |
| Delayed dual-factory selection, monitoring state, correct WLD routing and linked-vault session recovery | 13 passed, 0 failed |
| Heir discovery under candidate RPC and recent-event failures, canonical filtering and retry | 6 passed, 0 failed |
| Current deployed factory and legacy vault read paths | 0 failures |
| Types, lint, production build, CSS mapping, English-only copy | Passed |
| Public landing 320/390/960 px | No horizontal overflow; main CTA54px tall |
| Public shared-vault entry | Preserved through the HTTPS World App link |
| Store compositions | 345:240 content card, 1080px square showcases, 1200×600 meta image; all below 500KB |

The contract suite includes a permissionless executor test proving that an arbitrary caller cannot redirect WLD, an owner renewal after seven days cancels the claim, the review period cannot be bypassed and foreign/fake vaults cannot pass factory provenance checks. The executor checks include durable leases, concurrent signer changes, atomic fee/transaction staging, D1 write failure and lost acknowledgement, interruption before broadcast, exact signed-transaction recovery, canonical finalized receipts, removed-receipt recovery, observed fee overruns and missing L1 fee evidence. Watchers remain monitored until a payout or factory-slot release is finalized, and resume after a removed provisional payout. Nonce bursts stay bounded without storing raw connection addresses. Related-vault pages stay within Worker request limits and incomplete or failed scans remain explicit. A delayed identity-read browser test proves that switching factories cannot route a deposit to the prior vault or inherit its monitoring status; reauthentication restores a linked legacy vault and files a real claim through its source factory. A delayed old-session 401 cannot erase a newly verified login.

The new factory at `0xb74342FC15C504108cFD91366493590A9d570D26` was deployed at World Chain block 35771900. Its 11,906-byte runtime exactly matches the compiled artifact after accounting for immutable WLD values. The legacy factory remains supported. Chain receipts, deployment cost and the dedicated gas-only signer funding are recorded in `DEPLOYMENTS.md`.

Sourcify independently reproduced the creation and runtime code as `exact_match` at 2026-10-01 21:09:34 UTC, match ID 54490658. The public source is available at https://repo.sourcify.dev/480/0xb74342FC15C504108cFD91366493590A9d570D26. This is source/bytecode verification, not a security audit.

Readiness checks include remaining daily gas budget and the completed recovery outcome. A staged transaction blocked by a cap stays explicitly unavailable; an actually progressing pending transaction keeps its existing reservation. Previous UTC-day spending does not consume the next day's budget. A server-verified sign-in accepts a device clock one minute ahead or behind; session security and expiration remain independently verified by the Worker. Confirmed creation switches directly to vault management without a reload.

Readiness follows the latest cycle and current funding/caps. A cancelled claim's historical failure remains diagnostic; it does not report the whole service unavailable after another vault successfully settles.

Before advertising new-transfer readiness, the signer balance and remaining daily budget conservatively cover maximum allowed execution gas at the current network price plus the separate OP fee reserve. Individual execution still quotes the actual claim. Discovery preserves verified candidates while failed candidate or event reads remain explicitly incomplete; retry restores complete results without another sign-in.

Fresh UI screenshots were generated from local test-chain example vaults and the actual application code. Store images are examples; displayed balances are not promised balances or earnings. That historical basic-vault release charged no platform fee, provided no yield and did not claim an independent audit.

## Boundaries

A browser bridge stub does not verify real iOS/Android World App approval sheets, contact dialogs or push arrival. Those remain external device evidence. The app and automated transfer service are best effort; monitoring queues, gas funding, network outages and competing owner renewals can change the execution time. Store review is an external decision.
