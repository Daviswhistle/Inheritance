# Release evidence — October 2, 2026

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

Fresh UI screenshots were generated from local test-chain example vaults and the actual application code. Store images are examples; displayed balances are not promised balances or earnings. The app charges no platform fee, provides no yield and does not claim an independent audit.

## Boundaries

A browser bridge stub does not verify real iOS/Android World App approval sheets, contact dialogs or push arrival. Those remain external device evidence. The app and automated transfer service are best effort; monitoring queues, gas funding, network outages and competing owner renewals can change the execution time. Store review is an external decision.
