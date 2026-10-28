# World App guideline review — updated October 28, 2026

This is an implementation and evidence review, not a claim of World App approval,
legal certification, or independent security audit. The previous submission was
withdrawn by the operator before this revision. The Portal was read back as
`unverified` before changes.

## Current submission status and requirement classification

The operator withdrew the October 24 request. After technical remediation, a
new request on October 28 was read back as `awaiting_review` at 04:09 UTC
(13:09 KST). The user subsequently withdrew that request; a fresh Portal readback
confirmed **unverified**. No new submission has followed that withdrawal.

The disclosed source-sharing and jurisdiction gaps were not resolved by sending
the request. Under the user's current instruction, they must be substantively
addressed along with actual iOS World App validation before resubmission.
See [MAC_HANDOFF.md](MAC_HANDOFF.md) for the current readiness gate and
[RELEASE.md](RELEASE.md) for the historical technical receipts.

The official review policy requires a complete working app, meaningful live SDK
integration, accurate listing information, reviewer access, and compliance with
the laws of the selected countries. It does **not** prescribe a blanket legal
opinion certificate or a physical-device test report attachment. The contract
guidelines strongly recommend an independent audit; that recommendation is not
an unconditional audit-certificate requirement. Missing evidence is not itself
proof of a product defect or illegality.

Actual physical Android testing now covers wallet sign-in cancel/retry/success,
draft numeric input/Done and one authorized self-notification received on the
phone. On the deployed October 25 runtime, the Privacy Policy modal title and
contact-cancel manual recovery also passed. This is partial device acceptance;
contact selection and updated notification handling also passed. Native
deposit cancellation passed with a 0.094 WLD network quote. On October 27 a user-
approved 0.01 WLD deposit, actual close/reopen recovery and principal withdrawal
were confirmed on-chain and in the phone UI. A tiny residual remained after the
withdrawal; exact acceptance boundaries and costs are in
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md). Native test hosts remain
separate evidence because they simulate approval responses.

The working device is a Samsung SM-S911N / Android 16 / World Money 4.0.4401.
Earlier emulator installation failures are historical; use the connected phone.
Physical-iPhone acceptance has not been performed.

The operator confirmed individual operation in Korea and wants the maximum
lawful availability. The seven Portal countries are unchanged. The source is
public; the operator has no pre-deployment TFH sharing or legal-review record
to supply. [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) records the concrete classification
questions rather than inventing a universal legal-opinion attachment.

## Official references

Checked against the current [App Guidelines](https://docs.world.org/mini-apps/guidelines/app-guidelines),
[Design Guidelines](https://docs.world.org/mini-apps/guidelines/design-guidelines),
[App Review Guidelines](https://docs.world.org/mini-apps/guidelines/policy),
[Notification Guidelines](https://docs.world.org/mini-apps/guidelines/features-and-guidelines),
and [Smart Contract Development Guidelines](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines).

| Requirement | Implementation and evidence |
| --- | --- |
| Distinct mobile tasks and direct navigation | Home / Assets / Plan / Help remain distinct before and after sign-in. No wallet command is sent merely by opening a tab. Existing 24px horizontal padding, 12px tab safe-area spacing, accessible targets and responsive layouts are retained. |
| Keyboard controls | A 44px Done action sits 24px above the visible keyboard. It dismisses editing without submitting a transaction. Financial review and tab navigation return after editing. Below 240px visible height, the focused field takes priority and the native keyboard's dismissal control remains available; this is a documented narrow-landscape accommodation, not identical rendering at every size. |
| Consent before data use | Before sign-in, the action area explains wallet address/username use and a one-hour device session, with in-app Terms/Privacy links. Continuing explicitly requests agreement. Final plan review separately discloses monitoring and device recovery records. Contacts and notification permissions remain separate World App requests. |
| Poor connectivity | Nonce requests and signature-verification responses, including response-body reads, abort after 15 seconds. Failure stores no session and allows an explicit retry. Transaction recovery still verifies original receipts and never interprets a timeout as permission to deposit again. |
| User identity | Prefer World usernames; retain an address fallback when username lookup is unavailable and show the full recipient address for final transaction review. |
| Useful MiniKit integration | Wallet authentication, transaction approval, selected-contact access, World Chat and notification permission use the real installed SDK. Backend SIWE validation checks one-use nonce, signature, wallet, origin, statement and chain. |
| Functional notifications | Expiry, claim and completion alerts only. Portal readback: two per day, no full-contact import, no wallet-access whitelist. Delivery requires each recipient's permission. |
| Financial disclosure | Plan entry/review shows dated asset-specific lending/reward APRs and explicit unavailable states. Final review separates the live Re7 vault performance fee, Inheritance performance fee, conditional WLD network fee, exact amounts/recipient and loss/liquidity risks. A total-wallet-debit breakdown keeps each token amount separate and adds the conditional WLD fee; the mini app does not invent a preapproval fee quote or sum unlike currencies. A token-specific example illustrates the fee order without promising returns. Yield-risk consent starts unchecked. No paid yield-boost membership, token presale, guaranteed return or legal-will claim is offered. |
| Contract control | Customer vaults/factories are not upgradeable and provide no developer asset-seizure function. Owner means the depositing user's wallet. The executor can relay a due transfer only to the fixed heir; its signer cannot choose a recipient or file the heir's claim. Morpho strategy governance remains a disclosed external risk. |
| Contract documentation | All 203 handwritten public/external functions and receive handlers have NatSpec. CI checks the requirement. Access roles and fee behavior are explained below and in the source. These changes add comments only; executable Solidity is unchanged and no contract redeployment is performed. Compiler metadata hashes can change when comments change, so old on-chain source verification must retain the original deployment source revision. |
| Coverage | CI now measures coverage and enforces >=90% line coverage for every primary customer vault/factory/deployer and for their aggregate including shared helpers. Unsupported Foundry configuration keys that previously claimed enforcement were removed. Branch coverage is reported separately. |
| Store assets and support | Current UI captures are regenerated; illustrative balances are labeled. Content card is 1035×720 (3×345×240), without text or essential details in its bottom 282px. PNG files remain below 500KB. Help provides Terms, Privacy, Yield Terms and daviswhistle@naver.com. |
| Review access | Public source: https://github.com/Daviswhistle/Inheritance. Product: https://inheritance.pages.dev/. Reviewer flow: [REVIEW_NOTES.md](REVIEW_NOTES.md). The operator has no pre-deployment TFH source-sharing record to supply; public access does not establish that historical step. |

## Contract roles and coverage interpretation

Only the depositing owner or the vault's immutable factory can exercise owner
operations; factories bind those operations to the caller's registered vault.
The heir files the claim, the seven-day window is enforced on-chain, and an owner
can renew until payment executes. Anyone can relay a due automated settlement,
but cannot redirect its proceeds. Canonical late rewards retain their fixed
recipient; owner-authorized residual sweeps do not grant a developer withdrawal
power. Protocol fees are separately calculated on realized gains, not principal.
The operator-only gas funding contract uses its treasury, fixed recipients,
price checks and budgets; it has no user-vault spending authority.

Local pinned Foundry 1.3.2 instrumentation measured WLD / Morpho WLD / USDC vault line
coverage of 95.76% / 94.85% / 98.68%. The custody aggregate **including**
SafeERC20Lib, YieldMath and ImmutableCreationCode was 1201/1268 lines (94.72%).
Helper coverage is lower (80.00% / 67.86% / 39.47%); it is not omitted from the
aggregate. Morpho WLD branch coverage was 59.46%, so these results must not be
presented as 90% branch coverage or an independent audit. CI uses the pinned
Foundry 1.3.2 release and retains its own coverage artifact. `--ir-minimum`
coverage instrumentation can have imperfect source mappings and differs from
the normal optimized deployment build.

## Verification and remaining external evidence

- Local contract suite: 375 passed, zero failed, five fork tests skipped without
  an explicitly configured live RPC. This run does not certify current market liquidity.
- Follow-up: all five World Chain fork suites ran at block **36,753,480**,
  hash `0x636136a382c158bc475fb402b8c26cc54e11a50fb0e85de3611352a5d60848fd`:
  **21 passed, zero failures, zero skips**. `scripts/verify/worldchain-forks.mjs`
  pins all suites to the same block and rejects skips/missing suites. These tests
  use local funded accounts and explicit reward-root/illiquidity fixtures; they
  do not send mainnet transactions or demonstrate native wallet approval.
- Chromium product UI: 68 layouts, with accessibility checks enabled.
- Current macOS WebKit: 19 checks and 31 layouts, including pre-login privacy,
  keyboard Done geometry, Korean fee/debit review, offline recovery and interrupted
  deposits. No JavaScript errors. Exact source results are in [RELEASE.md](RELEASE.md).
- Android native host: 17 layouts / eight scenario groups on WebView 124.
- Authentication/notification authorization: 77 passed, including stalled nonce
  headers and verification bodies, no stored session on timeout, and successful retry.
- Typecheck, lint, production build, localization and CSS-class checks passed.
- The production cold-load probe at 150ms latency / 1.6Mbps / 4× CPU measured
  2.167, 2.125 and 3.760 seconds to guest entry. One run exceeds the 2–3-second
  guideline target; tab changes were 24–46ms. This is not a device latency guarantee.
- Native iOS XCTest results are source- and environment-specific. Earlier runs
  passed; the e4be10c run failed on an offscreen amount-field tap, and its test
  navigation fix is tracked with current results in [RELEASE.md](RELEASE.md).
  Simulator results do not establish physical iPhone World App acceptance.

On October 24 no device acceptance record was available. October 25 and 27
actual Android results supersede that gap only for the observed flows. The later
real deposit and principal-withdrawal receipts are confirmed, with round-trip
network cost `0.063726535762749712 WLD`. The post-withdrawal `2923` wei residual
means the live test is not evidence of a zero-share full exit. The follow-up
All-selection race fix is verified with local fixture funds, not another real
transaction. Physical iPhone acceptance, first-use human comprehension and an
independent security audit have not been established. See the acceptance table
for the precise boundary.

Existing Portal countries are KR, US, GB, CA, AU, JP and SG. This revision does
not expand that list or assert lawful financial/inheritance service availability
in those countries. Legal review cannot be replaced with software tests or a
Terms disclaimer. The now-withdrawn submission disclosed these limitations;
it was not a declaration that every
external requirement was satisfied. The later October 28 request was also
withdrawn. Its disclosures do not resolve the historical source-sharing gap or
the operator/service classification. Those remain concrete work before another
review request under the user's current direction.
