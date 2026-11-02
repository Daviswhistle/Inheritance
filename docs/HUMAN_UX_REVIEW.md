# User journeys and interface review — November 2, 2026

## Release boundary

Submission is stopped at the operator's explicit request. The Portal was read
back as `unverified`, with KR as the sole supported country. Do not submit this
revision or reuse earlier readiness claims. Code, checks and deployment remain
in scope. No production funds, notifications or external messages are used.

## November 3 correction: completion means the money is returned

The earlier cancelled-balance check proved only that assets stayed visible.
It missed the user's actual expectation: ending inheritance should return the
assets. The default exit now reviews and batches full recovery with recipient
removal. Keeping assets invested is a separate remove-only choice. Already
removed recipients get a Home recovery action; empty plans omit investment
choices and do not claim a payout. See [PLAN_EXIT.md](PLAN_EXIT.md).

Acceptance covers receipt-confirmed payment to the owner, complete rollback
when either asset fails, cancellation without a transaction, quote/liquidity
failure, and restoring an interrupted request without sending it again. A
successful settings event alone is not evidence of a completed withdrawal.

## What the interface must answer

1. Where is my money: World App cash, inheritance savings, or a separate investment?
2. Is the amount zero, still loading, unavailable, or temporarily not withdrawable?
3. What can I do now, and what amount and destination will I approve?
4. What happened, and does an old result still apply to this screen?

## Reference material actually inspected

- [NN/g: recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/): keep the information needed for a task in its context.
- [NN/g: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): relevant feedback, familiar language, and remove competing information.
- [DWP: hint text](https://design-system.dwp.gov.uk/guidance/hint-text): improve the question before adding explanatory text.
- [Zerion's portfolio guide](https://help.zerion.io/en/articles/13831023-understanding-portfolio-tracking-in-zerion): asset detail follows the selected asset and separates balance from performance.
- Rainbow's public [BalanceSection](https://github.com/rainbow-me/rainbow/blob/242bfe582159d71a82d64d019930667a86c16fec/src/screens/expandedAssetSheet/components/sections/BalanceSection.tsx) and [EmptyAssetList](https://github.com/rainbow-me/rainbow/blob/242bfe582159d71a82d64d019930667a86c16fec/src/components/asset-list/EmptyAssetList.tsx): inspect balance/value grouping and loading presentation. No source code or artwork was copied.

These are design inputs, not evidence that users understand this app. Browser
checks and engineering walkthroughs are not a recruited usability study.

## Journey audit and changes

| Journey | Observed problem or requirement | Result |
| --- | --- | --- |
| First visit / sign-in | Explain deadline, recipient request and seven-day wait before money moves. | Retain visible introduction and explicit sign-in consent; guest navigation requests no wallet transaction. |
| Home, no savings | Empty existing contracts looked like two active funded vaults and demanded check-ins. | Explicit empty savings state, saved settings and next action; no routine timer/check-in demand for empty holdings. Unknown data cannot become an empty state. |
| Home, funded | Timer and internal contract vocabulary dominated balances. | Savings first, then date and check-in; headline balances deduct the quoted service fee. Retained funds are not hidden just because inheritance was cancelled. |
| Asset selection | All wallet investment routes appeared above the selected asset. | Selected currency stays consistent. Inheritance balance comes before a collapsed separate-investment section. |
| Balance understanding | Gross value, wallet cash and investment receipt counts competed. | Inheritance savings and World App cash have distinct labels; gross minus service fee is an optional calculation. Receipt units are not token amounts. |
| Add funds / withdraw / earnings | Buttons jumped to a wallet without an app-level amount/destination review. | Modal review shows amount and destination first. Full withdrawal leads with net receipt, plus a fee breakdown. Network cost remains separately disclosed. Cancel/Escape sends nothing. |
| Separate wallet investment | A raw share count and jargon implied money belonged to the plan. | Read token value and currently redeemable amount, explicitly outside inheritance. Review before approval. Recheck liquidity/quote and never redeem more than the reviewed shares. |
| Empty income | Zero earnings still exposed a destination field. | No income panel for an empty asset; no destination editor when earnings cannot be collected. History remains accessible. |
| Settings | Recipient, editing controls, check-in and a new deposit form could compete on the same screen. | Saved recipient/interval first, editing on demand. New setup and saved settings are separate views with a return action. |
| Recipient | Pending assets need an actionable request/wait/receive sequence; receipt units must not masquerade as currency. | Existing grouped stages retained. Investment-only payouts say how the assets were received, with units in details and a route to current withdrawal value. |
| Feedback / errors | Completed check-in text persisted across unrelated tabs. | Success is a transient toast; other status messages can be dismissed and clear when leaving their scope. Pending actions remain protected. |
| History / help | Block coverage appeared before useful history. | Keep receipt amounts/dates and incomplete-data warnings; put block-range diagnostics in details. Existing fee, risk, service and recovery explanations remain accessible. |

## Validation boundary

Use the final evidence in RELEASE.md. The new task-based local-chain suite is
`scripts/verify/human-journeys.mjs`. It includes an empty WLD/USDC plan with a
separate USDC investment, partial liquidity, failed valuation, changing quotes,
review cancellation, net/gross comparison, and both-language navigation.
It runs exclusively against disposable local tokens.

This revision does not change contracts, fee rates, beneficiary rights, country
eligibility or production balances. Actual iOS World App approval/permissions
remain distinct from WebKit and the previously tested native simulator host.
