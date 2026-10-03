# Release evidence

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
| Automated executor, actual Anvil | 138 passed |
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

The current notification Worker also has a separate runtime release blocker.
A live Cron trace at 2026-10-03 19:18:48 UTC on version
`6a3ceebe-3b12-4633-964f-09212acbc49e` ended with `exceededCpu` and
31 ms CPU time. Its automatic-transfer completion timestamp was stale despite
the read-only health endpoint responding. The [Workers Free CPU limit is 10 ms
per Cron invocation](https://developers.cloudflare.com/workers/platform/limits/).
Local Anvil tests do not establish hosted CPU readiness. Resolve this limit and
verify advancing successful cycles before treating automatic payout as available.
Workers Paid is an operational option with a [$5 monthly base subscription and
usage-based overage](https://developers.cloudflare.com/workers/platform/pricing/);
changing billing requires approval. No plan upgrade has been performed.

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
