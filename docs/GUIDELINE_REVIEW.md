# World App guideline review — October 24, 2026

This is an implementation and evidence review, not a claim of World App approval,
legal certification, or independent security audit. The previous submission was
withdrawn by the operator before this revision. The Portal was read back as
`unverified` before changes.

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
| Financial disclosure | Final review includes exact amounts, recipient, service fee, strategy fee, loss/liquidity risks and initially unchecked yield-risk consent. No paid yield-boost membership, token presale, guaranteed return or legal-will claim is offered. |
| Contract control | Customer vaults/factories are not upgradeable and provide no developer asset-seizure function. Owner means the depositing user's wallet. The executor can relay a due transfer only to the fixed heir; its signer cannot choose a recipient or file the heir's claim. Morpho strategy governance remains a disclosed external risk. |
| Contract documentation | All 203 handwritten public/external functions and receive handlers have NatSpec. CI checks the requirement. Access roles and fee behavior are explained below and in the source. These changes add comments only; executable Solidity is unchanged and no contract redeployment is performed. Compiler metadata hashes can change when comments change, so old on-chain source verification must retain the original deployment source revision. |
| Coverage | CI now measures coverage and enforces >=90% line coverage for every primary customer vault/factory/deployer and for their aggregate including shared helpers. Unsupported Foundry configuration keys that previously claimed enforcement were removed. Branch coverage is reported separately. |
| Store assets and support | Current UI captures are regenerated; illustrative balances are labeled. Content card is 1035×720 (3×345×240), without text or essential details in its bottom 282px. PNG files remain below 500KB. Help provides Terms, Privacy, Yield Terms and daviswhistle@naver.com. |
| Review access | Public source: https://github.com/Daviswhistle/Inheritance. Product: https://inheritance.pages.dev/. Reviewer flow: [REVIEW_NOTES.md](REVIEW_NOTES.md). Historical pre-deployment TFH source sharing has not been established by this review. |

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
- Chromium product UI: 68 layouts, with accessibility checks enabled.
- Linux WebKit: 29 layouts, including pre-login privacy access without a wallet
  request, keyboard Done geometry, offline recovery and interrupted deposits.
- Android native host: 17 layouts / eight scenario groups on WebView 124.
- Authentication/notification authorization: 77 passed, including stalled nonce
  headers and verification bodies, no stored session on timeout, and successful retry.
- Typecheck, lint, production build, localization and CSS-class checks passed.
- The production cold-load probe at 150ms latency / 1.6Mbps / 4× CPU measured
  2.167, 2.125 and 3.760 seconds to guest entry. One run exceeds the 2–3-second
  guideline target; tab changes were 24–46ms. This is not a device latency guarantee.
- iPhone 16 Pro simulator: both native XCTest methods passed, zero failures or
  skips. Portrait, landscape and recovered-balance screenshots were inspected.
  Exact-commit CI, native and production receipts are in [RELEASE.md](RELEASE.md).

On October 24 the operator confirmed there is **no** real World App device
acceptance record and **no** jurisdiction-specific legal review to supply.
Real iOS/Android wallet approval/cancellation, contacts, permission dialogs and
recipient push delivery remain unverified. Native hosts use simulated approval
responses and do not close that gap. Physical-iPhone acceptance and first-use
human comprehension are also unverified. No independent security audit exists.

Existing Portal countries are KR, US, GB, CA, AU, JP and SG. This revision does
not expand that list or assert lawful financial/inheritance service availability
in those countries. Legal review cannot be replaced with software tests or a
Terms disclaimer. Submission requests World App review with these limitations
disclosed; it is not a declaration that every external requirement is satisfied.
