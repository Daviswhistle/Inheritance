# November 4 audit remediation

Scope: the independent pre-submission review at `a9e93b1`. No Mini App submission,
external message, real-fund test or contract deployment is included.

| Finding | Change | Verification |
| --- | --- | --- |
| F01 uncertain additional deposits | Strict durable account/chain/factory/vault/token/amount journal before opening wallet. No fresh top-up or setup while unresolved. Persist returned identifier; confirm its exact receipt. Unknown identifiers remain blocked and may be checked against a transaction hash explicitly supplied from World App activity. Never infer success from balance growth or auto-adopt another deposit. Structured non-submission or the original identifier's confirmed terminal failure unlocks retry. | Seven lifecycle scenarios, including storage failure, timeout, ambiguous/missing/empty ID, account separation and mismatched receipt; real SDK + local-chain USDC deposit with a lost ID, reload, blocked repeat and receipt-only recovery. |
| F02 partial withdrawal | Remaining-assets warning only for a full-exit request. | Original product UI suite completes; WLD and USDC each pay exactly one token on a partial withdrawal with remaining assets retained. |
| F03 settled rewards | Neutral processing result and action; does not claim owner receipt. Deferred/unknown rewards prevent an unqualified all-complete heading. | Existing fixed-recipient contract tests and deferred-reward UI receipt checks; code path reviewed. |
| F04 profile dependencies | Verified address resolves immediately. Publish chain positions before optional name enrichment; bounded name requests and request/account guards. | Stalled metadata and overlapping refresh regression. |
| F05 schema retry | Clear only a rejected initialization promise. | Real handler recovery in the same isolate and restored scheduled work. |
| F06 legacy completion | Preserve sanitized optional-getter revert classification across batched observations. | Legacy/current/deferred/RPC-outage scheduled cases. |
| F07 claim alerts | Suppress pre-claim expiry reminders during pending/finalizable claims. | Notification decision regressions. |
| F08 amounts | Single-column asset cards at 320px; amounts never break internally. | Actual numeric Range geometry assertions in the product UI suite. |
| F09 toast | Observe actual header geometry, including the signed-in row. | Existing 320/390px header clearance assertions, unchanged. |
| F10 materials | Actual current app captures, seven blue/white store PNGs, consistent synthetic accounts, accurate batched approval terms and withdrawn/unverified records. | Four local-chain captures, all seven PNGs visually reviewed, dimensions/size checked. Portal current state separately read back: KR only, unverified. |

The iOS missing-approval failure was reproduced and traced to the test host's
Reject compatibility click activating its own Reject-next-sign-in injection.
See [root cause and baseline/fixed evidence](IOS_LOGIN_RETRY_2026-11-04.md).
The fixed focused native test passes three real rejections and a final approval
on iOS 27.0. Final iOS 18.5 native CI **41810931516** on **3421c0e** passed **4 tests, 0 failures, 0 skips**; reviewed Done, final rotation/foreground and restored-deposit screenshots. Local iOS 27.0 combined full lifecycle/native Done tests passed **2/2** with no failures or skips.
The initial iOS 27 Done lookup failure was reproduced as a hardware-keyboard setup/OS accessory geometry mismatch. Correct device settings and a native-only finite, visible and hittable accessory check passed the full lifecycle and a real native Done dismissal regression (2 tests). App-owned 44px targets remain enforced. Combined final-harness validation is tracked in the iOS record; none of these host tests prove real iOS World App behavior.

Local checks: TypeScript, ESLint, production build, copy/i18n, transaction
confirmation, durable storage, login lifecycle, profile enrichment, deferred
rewards, original product UI (68 layouts) and additional-deposit local-chain
recovery passed. The backend's eight suites total 212 checks, with the temporary
Node diagnostic guard corrected before the final auth rerun (82/82).

Final runtime `f4cba93453337f36f8f423dd3e09fcb3b5ac8ce3` deployed successfully
in **41810159425** at https://2d7e96b3.inheritance.pages.dev. General CI
**41810159434** passed all three jobs. Production root, four referenced JS/CSS
files, three legal pages and seven store images match the immutable deployment
(15 files); root SHA256 is
`15f0671ae1c9e38610c6e1e34ed32b9658dba18d278dcdce2193dce872d97db3`.
Worker version: `969b50c2-6dc3-477e-9892-4a55a955cd03`.

Actual Android World App was force-closed and reopened on the final deployment;
wallet sign-in, ended Home and WLD/USDC asset screens were reviewed. Empty assets
no longer claim active deposits or show the owner as their own inheritance
recipient. No real-fund transaction was sent. Safari/WebKit's real-SDK lost-ID
top-up/reload test and all 15 local-chain exit tests passed on the final runtime.

Seven new PNGs were uploaded to the Portal's existing unverified draft; upload
responses committed each image. Description readback matches the prepared copy,
KR/en+ko remain selected and the app remains **unverified**, not submitted.
The metadata JSON now mirrors that actual current draft rather than replacing
it with an older proposal. Native iOS 18.5 run **41808903884** passed login retry and process recovery but failed a geometry stability assertion because unrelated diagnostic permission logs changed. The strict geometry-signature fix and OS-native accessory check passed the final native run **41810931516** on **3421c0e**: **4 passed / 0 failed / 0 skipped**. See the iOS record and portable final summary.
Earlier queued native runs 41807766575 and 41808624056 were cancelled as superseded,
before they ran; original failed 41756895853 is retained.

The initial full CI's new profile regression failed because it assumed repository
root as its working directory. The test now resolves its own script location;
no product behavior or assertion was weakened. The later complete CI passed.
 Real iOS World App remains a separate device limitation.
TFH contract/fee agreement is not established by open source or these tests;
no new inquiry was sent. Existing contract addresses, fees and assets are unchanged.

Final native evidence: [sanitized summary](evidence/ios-audit-remediation-final-2026-11-04.json). Runtime/backend/public files are byte-identical between the deployed f4cba93 and tested 3421c0e; subsequent changes are evidence and browser regressions only. Existing production assets were untouched; a new-factory production round trip remains outside this no-fund remediation.
