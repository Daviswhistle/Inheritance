# Final pre-submission review — November 4, 2026

Reviewed baseline: `27344c23bc9c1c345971fe65a5e4c2feb9994ab1`.
This is a new review of the current product, after the earlier
[audit remediation](AUDIT_REMEDIATION_2026-11-04.md). Findings below were
reproduced against that baseline or found while validating these changes.

## Decision

The baseline should not be submitted unchanged. A successful withdrawal could
be repeated after its response identifier was lost, and additional deposits
did not recheck the current strategy fee. This change fixes both paths, adds
durable concurrency protection and improves the affected mobile screens.

The fixes are prepared on a review branch. This review does not merge, deploy,
submit the Mini App, send a TFH inquiry, or authorize real-fund transactions.
Production remains the previously deployed `f4cba93` until an approved rollout.

## Findings and fixes

| ID | Priority | Reproduced behavior | Resulting behavior |
| --- | --- | --- | --- |
| R1 | P1 | A 1 USDC partial withdrawal executed on the local chain. After the wallet response lost its operation identifier, the input and retry button remained active. Another explicit wallet approval sent a second 1 USDC. | Save an account-scoped withdrawal record before wallet handoff. Block further withdrawals until the original receipt, definite rejection or original identifier's confirmed failure is verified. Recovery never sends a withdrawal. |
| R2 | P2 | The strategy fee changed from 10% to 20%; the additional-deposit flow neither read the current fee nor required new fee consent. | Show live strategy and service fees with unchecked consent. Recheck the canonical vault, exact raw strategy fee, service fee and fee recipient immediately before wallet handoff. A change reopens review with consent cleared and sends no wallet request. |
| R3 | P2 | At 390px, balances of 12,345.123456 WLD and 123,456.123456 USDC exceeded their 123px value containers. Their numeric widths were 161px and 175px, so important digits required internal scrolling. | Asset cards wrap based on content width. Long values remain complete without reducing precision or shrinking the type. Short values retain the two-column layout. |
| R4 | P2 | After rejecting a close-plan request, an enabled primary button briefly showed white text on an intermediate background with 3.56:1 contrast. The final accessibility run caught this during the 140ms color transition. | Apply primary-button color changes immediately; retain the press transform. Frame sampling and the full accessibility suite cover the corrected state. |
| R5 | P3 | The Korean income explanation said principal was maintained unchanged, which could imply protection stronger than the disclosed investment behavior. | Explain that available income is withdrawn while remaining assets continue to be invested. Keep the loss and liquidity explanations. |

The withdrawal issue requires another wallet approval. It is not an automatic
second payment or a demonstrated ability to spend without the owner approving.
All reproductions used private Anvil chains and mock assets.

### Durable recovery and concurrent windows

The independent review of the first implementation found two races: separate
read/save operations could both admit a request, and a delayed legacy-storage
migration could overwrite a newer IndexedDB record. Both were fixed before
the final review.

Withdrawal and additional-deposit records now use strict IndexedDB
transactions with compare-and-set creation, update and deletion. Unique request
IDs and the prior record snapshot prevent a late response from clearing a
newer request. Legacy migration only writes an absent key; it preserves both
new records and deletion markers. Existing version-1 additional-deposit
records without request IDs remain recoverable.

Web Locks provide an additional same-account guard when supported. Conflicting
actions are rejected immediately, never queued for a later automatic wallet
prompt. The IndexedDB protection remains necessary and active without Web
Locks. This is protection within the same site's storage on one device, not a
cross-device lock; deleting site data removes the recovery record.

Receipt verification checks World Chain, the request's block boundary,
original vault, token, recipient and actual token transfer. Partial withdrawals
require net payout plus service fee to equal the requested gross amount; full
withdrawals require the stored minimum net proceeds. A manually supplied
failed transaction or a receipt that does not match the saved fields cannot
clear an unidentified request. A missing wallet identifier cannot be replaced
with an on-chain request ID; the user supplies the original transaction hash.

Implementation: [withdrawal](../app/src/withdrawal.ts),
[additional deposits](../app/src/additional-deposit.ts),
[storage](../app/src/plan-storage.ts),
[wallet lock](../app/src/wallet-action-lock.ts).
The bilingual [privacy policy](../app/public/privacy.html) describes the new
withdrawal recovery record before this behavior is released.

### Dependency security

Production dependency audits found two published `ws` advisories in the root
and app dependency trees: [uninitialized memory disclosure](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx)
and [memory-exhaustion denial of service](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p).
The installed versions were 8.17.1 and 8.18.3. No affected Node WebSocket
server/client path was found in the reviewed application source: the browser uses
native WebSocket mappings and the backend RPC/auth paths use HTTP transports.
That reachability assessment is narrower than claiming the dependencies were
free of known vulnerabilities.

Both dependency managers now override only `ws` to 8.21.0, the first 8.x
version fixing both advisories. SDK, ethers, viem and other direct-library
versions remain unchanged. The existing esbuild install policy is preserved.
Both production audits then reported zero known advisories. The audit results
and lockfile hashes are included in the evidence summary.

## Design, UI and UX assessment

The existing blue-and-white visual system is coherent across the app and seven
store images. The information hierarchy gives balances and the next check-in
action priority. The review did not find a reason to replace that design.
The changes address failures of reading and decision-making within it.

- Exercise English and Korean guest, owner and recipient flows; plan creation,
  assets, help, consent, partial withdrawal and empty-plan closure.
- Check 320px and 390px mobile layouts, a 1280px desktop viewport, and a short
  320 × 360 dialog viewport. Separate long-balance checks cover 320–414px.
- Check one page heading, reading-focus movement, dialog focus containment,
  Escape/Cancel focus restoration, 44px app-owned targets and reachable actions.
- Check exact token precision, complete recipient addresses, unchecked consent,
  location/residence restrictions and receipt-based completion.
- Give fee explanations the full width of narrow dialogs. Keep links and consent
  labels usable without removing material risk and fee disclosures.

The final local UI evidence and execution result are recorded in
[the review summary](evidence/final-submission-review-2026-11-04.json).
Automated accessibility checks cover the exercised states; they do not replace
screen-reader evaluation on actual phones.

## Verification

| Area | Evidence |
| --- | --- |
| Contracts | Local suite: 476 passed, 0 failed, 7 opt-in fork tests skipped. No Solidity changes in this review. |
| Critical custody coverage | [Baseline CI](https://github.com/Daviswhistle/Inheritance/actions/runs/41813035636): 1258/1325 lines, 94.94%. Morpho WLD branch coverage is 63.25%; the line result is not a branch-coverage or security-certification claim. |
| Contract documentation | NatSpec check: 207 handwritten public/external functions and receive handlers. |
| Static app checks | TypeScript, ESLint, production build, CSS class checks and bilingual copy checks passed. |
| Focused regressions | Withdrawal 10, additional deposit 7, storage 14, transaction confirmation 15; also login, eligibility, profile resolution, errors, mobile flows, income history and legacy routes. |
| Production dependencies | Root npm and app pnpm audits: zero known advisories after the ws-only update. Actual ethers/viem resolutions use ws 8.21.0 in both installations; typecheck, build and affected auth/backend checks were rerun. |
| Real SDK/browser/local chain | 12 money-safety scenarios passed, including two-window contention, fee changes, missing identifiers, reload/account switching, legacy journals, and positive-yield partial/full withdrawals for WLD and USDC. |
| UI and accessibility | 72 layouts, 38 axe checks with zero violations, 45 screenshots; exit 0 in 43.07 seconds. The new CI job is configured to run the same product UI and money-safety scripts and upload their evidence. Its remote result must be checked on the review commit. |
| Backend | Auth, notification decisions/database writes, scheduling, runtime and monitoring regressions passed. The backend implementation is unchanged. |

The positive-fee fixture uses the same local address for the heir and fee
recipient. Its wallet balance increase includes both net proceeds and fees.
Assertions check the two events separately; they do not call that total the
user's net payout.

The full UI run also exposed a test-process cleanup defect: Chromium could
remain alive after all assertions completed. The CDP driver now requests
browser shutdown and verifies process/socket closure, with bounded cleanup of
its own test child. The final successful run exited normally without forcing
`process.exit(0)` or weakening assertions.

Reproduce from the repository root after installing app/root dependencies,
Foundry, Chromium, Playwright 1.64.1 and axe-core 4.10.3:

```sh
forge build
node scripts/test-withdrawal.mjs
node scripts/test-additional-deposit.mjs
node scripts/test-plan-storage.mjs
node scripts/verify/money-safety.mjs
node scripts/verify/product-ui.mjs
```

For browser runs set `CHROME_BIN` to the installed browser, `PLAYWRIGHT_MODULE`
to the Playwright module when it is outside normal resolution, and
`AXE_CORE_PATH` to `axe.min.js`. `MONEY_SAFETY_OUT` and `VERIFY_TMP` select
temporary evidence directories. The complete pinned CI setup is in
[ci.yml](../.github/workflows/ci.yml).

## Published assets, performance and submission materials

Before these changes, no app/backend/public source differences existed between
baseline main and the deployed Pages revision `f4cba93`. Separately, fifteen
publicly served files—HTML, four referenced JS/CSS assets, three legal pages
and seven store images—matched the immutable
[Pages deployment](https://2d7e96b3.inheritance.pages.dev/) byte for byte. This
does not claim byte-level inspection of the running backend Worker. The
earlier store/runtime mismatch was not reproduced on this baseline.

The seven store PNGs were visually reviewed. Their visual language, example
balance labels and fee/risk explanations match the product. The content card is
1035 × 720 with no essential content in its bottom 282px. Current Portal state
was not independently reopened during this review; the earlier documented
state is an unverified KR/en+ko draft. Unverified is a normal pre-submission
state, not a product defect.

One synthetic run replaying the published static assets with gzip recorded
FCP/LCP of 2.256 seconds at 150ms latency, 1.6Mbps and 4× CPU slowdown; CLS was
0 and there were no failed asset requests or page errors. This is a lab
measurement of the published baseline, not measured World App startup on a
physical device or proof of every production network condition.

## Remaining release evidence

1. Merge and deploy the reviewed revision through the normal release process,
   then check the actual published assets and changed paths. The review branch
   does not change production by itself.
2. Run the changed money flows inside actual World App on iOS and Android.
   Existing iOS host evidence uses real WKWebView/SDK with simulated approvals;
   it is not actual iOS World App. A new-factory production deposit/withdrawal
   round trip and recipient production claim-to-final-payment remain outside
   this review's evidence.
3. Include the prepared [contract review package](CONTRACT_REVIEW_PACKAGE.md)
   and [reviewer instructions](REVIEW_NOTES.md). TFH review/fee agreement is not
   established by passing CI or publishing source. The repository records no
   evidence of pre-deployment repository sharing with TFH for the existing
   immutable contracts.
4. Explain the KR network and residence restriction to reviewers, including the
   isolated fixture path for reviewers outside Korea. Do not silently remove
   the production restriction to make a demonstration easier.

Official references: [design](https://docs.world.org/mini-apps/guidelines/design-guidelines),
[app/store guidance](https://docs.world.org/mini-apps/guidelines/app-guidelines),
[smart-contract guidance](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines).
The latter strongly recommends independent audits; that recommendation is not
rewritten here as a universal prerequisite certificate for all submissions.
