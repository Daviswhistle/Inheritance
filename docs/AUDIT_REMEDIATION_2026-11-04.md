# November 4 audit remediation

Scope: the independent pre-submission review at `a9e93b1`. No Mini App submission,
external message, real-fund test or contract deployment is included.

| Finding | Change | Verification |
| --- | --- | --- |
| F01 uncertain additional deposits | Strict durable account/chain/factory/vault/token/amount journal before opening wallet. No fresh top-up or setup while unresolved. Persist returned identifier; confirm its exact receipt. Unknown identifiers remain blocked and may be checked against a transaction hash explicitly supplied from World App activity. Never infer success from balance growth or auto-adopt another deposit. Structured non-submission or the original identifier's confirmed terminal failure unlocks retry. | Seven lifecycle scenarios, including storage failure, timeout, ambiguous/missing/empty ID, account separation and mismatched receipt; real SDK + local-chain USDC deposit with a lost ID, reload, blocked repeat and receipt-only recovery. |
| F02 partial withdrawal | Remaining-assets warning only for a full-exit request. | Original product UI suite completes and confirms exactly 1 USDC withdrawal with remaining balance. |
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
on iOS 27.0. The same iOS 18.5 full CI remains to be run on this final source.
The iOS 27 full lifecycle's later Done lookup failure is retained; it is not a
full native pass or proof of real iOS World App behavior.

Local checks: TypeScript, ESLint, production build, copy/i18n, transaction
confirmation, durable storage, login lifecycle, profile enrichment, deferred
rewards, original product UI (68 layouts) and additional-deposit local-chain
recovery passed. The backend's eight suites total 212 checks, with the temporary
Node diagnostic guard corrected before the final auth rerun (82/82).

Follow-up boundaries: deployment and final CI readback, Android final-build
inspection, matching iOS 18.5 host run, and refreshed Portal draft assets are
recorded when completed. Real iOS World App remains a separate device limitation.
TFH contract/fee agreement is not established by open source or these tests;
no new inquiry was sent. Existing contract addresses, fees and assets are unchanged.
