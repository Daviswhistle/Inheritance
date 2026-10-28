# Release evidence

## October 28 deployment — wallet-debit transparency and full-withdrawal recovery

Runtime source: `3e675010e5c0e5641a2b433a01e76f5cfec2e529`, descendant of requested `91944cc` baseline.
This follow-up includes earlier legal-title, contact recovery, permission-status,
in-app sign-in and dated-rate disclosures. No executable contract, fee percentage,
strategy, allowlist or operator spending budget changed.

The final plan review now shows total-wallet-debit components: exact per-token
deposits plus a conditional WLD network fee. Deposits reach the vault in full;
the network charge is additional. The mini app cannot obtain the native fee quote
in advance, so it neither invents a number nor sums unlike currencies. The World
App quote and the post-transaction settled debit are explicitly distinguished.

Actual phone testing exposed a separate All-withdrawal race: the old UI inferred
full exit from exact equality with a changing valuation. All is now explicit,
scoped intent; its visible amount follows refreshed valuation, and submission
reads a fresh protected minimum before using withdrawAllFromMyVault. Manual input
clears All intent and keeps an exact partial withdrawal. Independent review found
and reproduced an idle-only USDC case that could leave WLD behind; the amended
full-exit path protects the directly read USDC amount and also pays held WLD. Unavailable valued-share
quotes stop before the wallet. Idle WLD retains the full-exit route, including
cash arriving during wallet approval; its fresh position accounts for canonical
cash-reward fees without requiring a share valuation. Idle USDC remains
recoverable from its directly read balance.

Validation for this runtime:

- Typecheck, lint, production build, 9 localization checks and 22 rate/fee checks
  passed. Current monetary and mobile verification: the complete local-chain browser suite passed 92 checks, including refreshed/full/partial withdrawal, identity outage recovery, idle USDC plus WLD exit, and WLD arriving during approval.
- macOS WebKit: 19 checks / 31 layouts / no JS errors for the debit disclosure.
  Chromium localized product UI: 68 layouts. Its old seven-topic Help assertion
  was corrected for the existing eighth Network fees topic.
- Separate automated code review (Codex commit review): completed against the complete final commit with no actionable findings; its focused checks covered seven withdrawal scenarios and keyboard closing/recovery.
- [CI 40629700573](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700573): passed, all three jobs successful.
- [Pages/Worker 40629700530](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700530): passed for this runtime; Pages and notification Worker deployed successfully.
  Immutable Pages: https://6fff670a.inheritance.pages.dev. Worker version: `44ac6f50-9fae-469e-962e-660cfc35545a`.
- [iOS native host 40629700598](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700598): in progress; final-source native results are not yet established.
  Local native iOS at `aa47552`: Xcode 27.1 / iPhone 16 Pro / iOS 27.0, both XCTest methods passed with zero failures or skips. Prototype source hashes matched that revision; canonical recovery and portrait/landscape/foreground evidence were retained. The subsequent idle-WLD handler amendment is covered by the local EVM regression and the final-source CI result above.
- Production HTML/imported assets/legal documents/Worker automation readback:
  October 28 readback passed: production HTML and all six imported JS/CSS files match the immutable deployment; three legal documents return 200; the Worker reports ready, funded and a fresh cycle with no halt or last error.

The native test host adopts UIKit's scene lifecycle, required by the installed
iOS 27 SDK ([Apple migration guide](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)).
The product keeps fixed navigation hidden during keyboard dismissal after input
blur, preventing Done from tapping through to Help. A one-second upper bound
restores navigation after a permanent window resize. WebKit tests both the
closing interval and the bounded recovery.

Amount and recipient navigation uses bounded drags above fixed controls rather
than full-page swipes that can overshoot short screens. Full CSS input geometry,
native occlusion, hit targets, preserved values, keyboard controls, rotation,
process-death recovery and canonical fixture receipts remain asserted. The
accessibility height baseline is rounded to pixels before applying its existing
one-pixel tolerance. These are host/driver corrections, not evidence that the
physical iPhone World App has been tested. The earlier e4be10c and a4b9ec4 iOS
runs failed; only the exact current result above establishes the current status.

Actual World App Android acceptance used e4be10c: the user personally approved
one 0.01 WLD deposit and a later withdrawal. The full deposit reached the new
vault. Quoted network fee was 0.098 WLD, while the actual net network charge after
unused reserve refund was 0.063726535762749712 WLD; actual deposit debit was
0.073726535762749712 WLD. Close/reopen restored the funded 30-day plan without a
second deposit approval. Withdrawal returned 0.010000000000056801 WLD and charged
no owner WLD network fee. The test principal was recovered, but 2923 wei WLD
remained after the original race; this is not a real zero-share full-exit receipt.
Private tester-linked receipts/screenshots are not committed. No unrelated USDC
wallet shares, invitation or second self-notification were used.

The factual TFH inquiry was sent October 25 at 15:33 KST. October 28 sent-thread readback
found no response or decision. This is proof of sending, not review-team routing
or acceptance. Individual Korean operation and the seven existing country
settings retain the concrete classification questions in [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md).
Portal descriptions/captures were updated and read back; Portal status remains
unverified. No resubmission is claimed. See [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md)
for the precise actual-host boundary and [MAC_HANDOFF.md](MAC_HANDOFF.md) for the
small current continuation checkpoint.

## October 24 follow-up after second withdrawal

Portal readback is `unverified`. The 11:41 UTC submission recorded below was
withdrawn by the operator and is no longer the current state. No follow-up
submission has been made yet.

Five World Chain fork suites passed **21 tests, zero failures, zero skips** at
block `36753480` (`0x636136a382c158bc475fb402b8c26cc54e11a50fb0e85de3611352a5d60848fd`).
The new `scripts/verify/worldchain-forks.mjs` requires an explicit RPC, checks
chain 480, selects one block for all suites and saves a source/block receipt.
The gas-refill fork test now honors that block. The manual `worldchain-forks.yml`
workflow retains logs and receipt for 90 days and fails on any skipped or missing
suite. No product runtime or deployed contract changed in this follow-up.

Follow-up verification commit: `b09627748594e84660b1683dc0a41479c08d8ad1`.
[World Chain fork acceptance 40091745672](https://github.com/Daviswhistle/Inheritance/actions/runs/40091745672)
passed; the downloaded receipt confirms a clean tree, the same block hash, 21
passes and zero skips. [CI 40091742269](https://github.com/Daviswhistle/Inheritance/actions/runs/40091742269)
passed all three jobs (contracts, Mini App and notification backend).

Official must-have requirements and recommendations are distinguished in
[GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md). Korea was confirmed as the operator's
country; distribution countries remain unchanged. Concrete scope questions are
in [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md), and actual World App steps/results are in
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md). Device results are pending.

## October 24, 2026 guideline remediation

The operator withdrew the previous submission; Portal readback confirmed
`unverified`. This revision adds pre-sign-in data/session consent and in-app legal
links, explicit monitoring/recovery disclosure, a keyboard Done control 24px above
the visible keyboard, and bounded sign-in network reads. All 203 handwritten
public/external contract handlers now have NatSpec. Unsupported coverage settings
were replaced with a measured CI gate. Executable Solidity is unchanged.

Local checks: product UI 68 layouts; WebKit 29 layouts; Android 17 layouts/eight
scenario groups; auth/notification authorization 77 tests; contracts 375 passed,
zero failed and five RPC-dependent fork skips. Pinned Foundry 1.3.2 custody line
coverage including helpers is 1201/1268 (94.72%); this is not branch coverage.
Typecheck, lint, build, localization, CSS mapping and negative controls for the
NatSpec/coverage gates passed. Store artwork was regenerated from the current UI.

Ten Portal contracts and four Permit2 tokens remain configured. Current deployed
entry-point/token variables were independently checked against the Portal list.
The daily notification cap remains two and full-contact import is disabled.

Real World App device acceptance, physical iPhone, human comprehension, independent
audit and jurisdiction-specific legal clearance remain unverified. The operator
confirmed no device/legal records are available. Details and reviewer access are
in [GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md). Remote CI, native iOS, deployment
and resubmission receipts follow here.

Runtime commit: `a56335f8a978db1dda9b154b3a606b5de74382ae`.

- [CI 40090185065](https://github.com/Daviswhistle/Inheritance/actions/runs/40090185065): all three jobs passed, including the retained custody coverage artifact.
- [Pages/Worker 40090185020](https://github.com/Daviswhistle/Inheritance/actions/runs/40090185020): passed; immutable Pages URL `https://30a7c891.inheritance.pages.dev`, notification Worker version `ffeb3342-3d1a-41f6-b2ce-046a6833470a`.
- [Gas refill 40090185079](https://github.com/Daviswhistle/Inheritance/actions/runs/40090185079): passed; the existing Worker was redeployed by its contract-path filter, without a new on-chain contract.
- Production JS/CSS bytes match the immutable Pages deployment. Legal pages resolve and the new privacy disclosure is live. Sixteen English/Korean guest layouts at 320/390px pass without runtime exceptions.
- A disposable unfunded EOA passed genuine production SIWE verification. Nonce replay returned 401, the Pages session authorized an empty Worker index, anonymous access returned 401 and foreign-origin access returned 403. No user funds or notifications were involved; this is not native World App approval evidence.
- Automation was funded, supported and fresh, with no halt/error; `lastCycleAt` advanced from `2026-10-24T11:31:24.404Z` to `2026-10-24T11:33:25.016Z`.
- Public-site cold-profile performance under 150ms latency, 1.6Mbps download and 4× Chromium CPU slowdown: entry 2167 / 2125 / 3760ms; tab transitions 24–46ms. One run exceeds the guideline's 2–3-second initial-load target. These are simulated conditions, not physical-device timings or a guaranteed latency bound.
- Final product screenshots were repeated with Korean fonts available; 68 layouts and 37 accessibility states passed with zero reported axe violations.
- Portal descriptions link the guideline review and disclose missing real-device/legal clearance. Seven image uploads committed successfully, and metadata was read back before submission.

[Native iOS 40090185124](https://github.com/Daviswhistle/Inheritance/actions/runs/40090185124)
passed both XCTest methods on the same runtime commit, with zero failures or
skips. iPhone 16 Pro simulator screenshots were inspected for portrait Done/input
clearance, the short landscape input, restored actions and the recovered
`1.000001` USDC balance without resubmission. The final Android rerun also passed
17 layouts/eight scenario groups. These remain test-host results, not actual
World App approval services.

Re-submitted on **October 24, 2026 at 11:41 UTC (20:41 KST)** for app
`app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`. Submission returned
`awaiting_review`; a separate configuration readback confirmed the same state
with developer listing enabled. This is a submitted review, not approval.
The subsequent documentation commit does not change the verified runtime.

## October 23, 2026 independent release and design review

### Final deployment and review submission

Re-submitted app `app_28c40a2a42b7f6c95789c2d5231b1314` through the developer
portal on **2026-10-23 at 12:41 UTC (21:41 KST)**. Submission returned
`awaiting_review`, and an independent configuration readback at 12:41:38 UTC
confirmed that status for metadata `meta_9cf3b324ec9a1838a56c5b6d98be8674`.
Developer listing remains enabled. This is a submitted review, not an approval.
All seven store images and the updated descriptions were verified before submission.

- Runtime `fbd69847ff8a1e779c377705a175be88639005f8` deployed successfully in
  [deployment 39948853311](https://github.com/Daviswhistle/Inheritance/actions/runs/39948853311).
  Public JS/CSS bytes match release `https://93626753.inheritance.pages.dev`;
  production and legal pages were checked live.
- Final native verification `93472b8435786b9d39a442bccf3f7ecf8da5523b` passed
  [iOS 39953168957](https://github.com/Daviswhistle/Inheritance/actions/runs/39953168957)
  and [CI 39953168941](https://github.com/Daviswhistle/Inheritance/actions/runs/39953168941).
  The commits after the runtime deployment change tests/documentation only.
  Both XCTest methods passed; portrait, landscape, foreground and recovered
  `1.000001` USDC screenshots were independently inspected. Input values and
  complete bounds remained visible, fixed controls stayed hidden during editing,
  and recovery did not submit the deposit again.
- Final Android verification passed **17 layouts / 8 groups / zero reported errors**;
  Linux WebKit passed **13 groups / 29 layouts**. Financial checks passed
  **225 unit/fuzz tests and 8 current-block fork tests**.


The user authorized continued independent agent review, improvements and review
submission. Portal readback confirmed the October 21 feedback: "follow design
and app guideliens. improve UX. tabs have the same UI." The response and concrete
review steps are in [reviewer notes](REVIEW_NOTES.md).

Independent UX inspection captured current English/Korean guest and owner flows
at 390px and owner flows at 320px. Home prioritizes check-in; Assets manages
balances and income; Plan manages recipients and intervals; Help contains rules
and support. Empty balances, risk consent and recovery remain explicit. Final
320px review checks included full legal-link/CTA clearance, exact amounts,
over-balance/self-recipient errors and rejected-approval recovery. The English
Help language label no longer repeats "Language".

The adversarial UX pass also found that a cancelled additional deposit could
leave its recovery controls below existing plan settings. On first recovery
display or return from a wallet action, the app now focuses and reveals the
recovery heading. Background reads retain the reader's scroll/focus. A persisted
WebKit regression verifies the complete recovery action at 320px, unchanged
on-chain balances after rejection and the exact `1.000001` amount after editing.
The complete WebKit suite passed **12 groups / 29 layouts** after the fix.

Final native screenshot inspection then exposed a landscape input partly
covered by the keyboard even though the old accessibility-bound assertion
passed. A late layout-scroll regression reproduced an input extending to
93.3px in a 70px editing viewport. Subscribing to window scrolling restored the
full input to 10.3–58.3px without oscillation; the complete WebKit suite passed
**13 groups / 29 layouts**. The native test now checks full DOM and native input
geometry against the keyboard/accessory, waits for stable measurements and
rechecks after screenshot capture. Read-only trace telemetry records the
measurements; it does not move inputs or scroll the page for the test.

The native trace then separated two additional issues. In landscape, UIKit's
keyboard guide omitted WKWebView's 44px accessory toolbar; the test host now
uses the actual public accessory-view and keyboard-notification frames rather
than a hard-coded subtraction. On return to portrait with the keyboard still
open, the app lost its original height baseline and restored fixed controls
over the input. Per-width height baselines and foreground recalculation correct
this. The browser regression covers that complete rotation/foreground sequence;
the native regression additionally requires hidden fixed controls and nine
unobstructed points inside the input. Earlier green runs whose screenshots
exposed these problems are not evidence that those cases were already correct.

The stronger regression also exposed test-instrumentation limitations: repeated
accessibility queries exhausted the original sample deadline, snapshot values
truncated the telemetry at 512 characters, and snapshot keyboard frames retained
portrait coordinates after rotation. The final sampler reads full telemetry and
the oriented keyboard frame directly, then samples the app frames together.
Full bounds, all nine unobstructed points, hidden fixed controls, retained text,
three stable observations and the post-capture check remain required.

Store artwork was regenerated from current app captures. The income showcase
now explicitly describes loss recovery, investment losses and cash liquidity;
it does not imply guaranteed principal. All seven PNGs meet their dimensions,
500KB limit and no-metadata requirements. Portal metadata explains the different
tab purposes and retains the existing fee, risk and custody disclosures.

Financial verification at World Chain block **36,708,856** found matching runtime
bytecode for both current factories and deployers (excluding immutable slots).
Both Re7 strategies reported a 10% performance fee; the service fee remained
1,000bps. Direct deposit/redeem previews matched share conversion without an
additional entry/exit deduction. This is evidence for the configured direct V1
routes, not a statement about fees charged by a separate wallet interface.
Financial unit/fuzz checks: **225 passed**. Current-block fork checks: **8 passed**,
covering deposits, withdrawals, inheritance, share redemption and both assets'
income collection. No production financial transaction was sent.

Before this final polish, commit `1f6dc508` passed CI `39941868921`, deployment
`39941869016` and native iOS `39941869001`. Its live Pages HTML matched release
`2a7abd7f`; legal pages returned HTTP 200. Independent automation-health reads
advanced from 11:01:59 to 11:03:59 UTC with ready, funded, fresh, not-halted
Durable Object execution. These observations do not prove a future payout.

Actual World App approval/notification services, physical-iPhone acceptance,
unfamiliar-person comprehension and an independent external security audit are
not established by these agent, browser, emulator or fork checks.

## October 13, 2026 app-first production and resubmission

The user authorized production deployment and review resubmission. Main was
fast-forwarded to reviewed commit `013cdd387ffe652dbba9aacd7b8450ddbea9034c`.
Its main CI completed successfully in all three jobs:
https://github.com/Daviswhistle/Inheritance/actions/runs/38410077458.
Pages, shared D1 preparation and the notification Worker deployed successfully:
https://github.com/Daviswhistle/Inheritance/actions/runs/38410076798.

The public app serves `index-Dgt7ohzW.js`. English and Korean first entry, all
four tabs, expanded rules, legal links and preserved World App shared paths
passed at 320×640 and 390×844 with the actual SDK outside World App, without
authentication requests or runtime errors. Privacy, Terms and Yield Terms
return HTTP 200. All seven public store images match the reviewed repository
bytes. The deployed automation health was enabled, supported, funded and fresh,
with verified gas funding, `halted: false`, `reason: ready` and Durable Object
execution. This is service health evidence, not proof of a future payout or
native notification delivery.

The existing Portal metadata was in `changes_requested`. Its MCP edit tool
requires `unverified`, so the official team GraphQL API conditionally moved only
that app's existing metadata back to an editable draft. Metadata and all seven
images were then updated through the Portal MCP and read back. Submission
validation enforces a 40-character annotation; the final 37-character tagline is
`Prepare assets for someone you trust.` The prepared metadata file matches it.
The 21-word overview and full fee, risk, claim and control disclosures remain.

Review submission succeeded at **2026-10-13 14:18:11 UTC**. A separate readback
at 14:18 UTC confirmed `awaiting_review` for app
`app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, with developer allow-listing retained.
This confirms resubmission, not approval. Native-device acceptance, observed
user preference and an independent external security audit remain unverified.

## October 13, 2026 independent product review fixes

An independent sub-agent reviewed candidate `64ab73d` with 21 direct user-flow
checks and 22 browser captures. It found two P2 issues: a shared link could put
another owner's received plan ahead of the selected plan, and the fixture's
`txLog` never recorded requests, making its no-request assertions ineffective.
The calling session verified both findings against the source and reproduced
the missing request record with a deliberately rejected SDK call.

The selected owner's received-plan group now appears first. The test fixture
records each `sendTransaction` invocation, including rejection and an atomic
multi-call batch. A positive control proves a rejected call increases the count;
the existing successful four-call settings operation records one request.
Regression checks open links to each of two owners and verify the selected
person and tappable claim appear first at 320×640 and 390×844 without a request.

The complete plan-experience browser suite passed **59** checks after these
fixes, including all existing no-request assertions with the corrected recorder.
Runtime errors and external requests were zero. Typecheck, lint, locale checks,
CSS mapping and a production build with current public deployment variables
also passed. The earlier unified-plan browser result uses its own functioning
bridge-call recorder and is separate from the defective `txLog` assertions.

This follow-up is based on `64ab73d` on `fix/usable-inheritance-experience`.
Production and Portal have not been updated. Native World App device acceptance,
first-user observations, independent external security audit and store approval
remain separate evidence requirements.

## October 13, 2026 usable inheritance review candidate

This candidate includes the app-first entry and makes the useful actions easier
to find. Entry explains preparing assets for one trusted recipient. An optional
three-step guide, also available in Help, distinguishes login from check-in,
expiry from a claim, and the seven-day review from actual execution. The owner
sees the next check-in and its action before asset totals. Plan opens with owner
settings and an expandable invitation; eligible recipients see their next claim
or completion action before currency details.

Setup and final review keep their action above navigation. Disabled actions
explain the missing step. Known zero wallet balances explain funding; failed
token reads retain the draft and offer retry while blocking approval. The review
retains exact amounts, full recipient, service and strategy fees, unchecked risk
consent, and an explicit independent-audit disclosure. An interrupted setup
shows saved progress and recovery controls without a disabled new-plan form.
The editing toolbar follows a reduced visual viewport and normal navigation
returns when editing ends.

Local validation passed: complete plan experience browser **57**, unified plan
browser **83**, canonical role recovery **5**, locale **7**, frontend typecheck,
lint and CSS mapping. The UI and recovery suites use real local Anvil contract
transactions and canonical receipts. No external notifications or chain writes
were sent. The actual installed SDK production build was opened outside World
App using the current public deployment variables: English and Korean entry,
expanded rules, all four tabs, legal links and preserved shared paths work at
320×640 and 390×844 without authentication requests or runtime errors.

The complete-plan and unified suites were rerun after the keyboard, spacing and
per-asset balance-read amendments:
both reduced-layout and simulated visual-only keyboards keep the focused input
above the action bar. Full Terms and Privacy Policy links remain visible and
tappable at the end of review on both sizes. Failed or stalled token reads cannot
invalidate a healthy other-token draft. Each token's precision is checked before
publishing its amount; expired responses cannot overwrite a fresh read. Form and
action-bar size changes trigger keyboard position correction, including a
background error appearing during recipient input. The final wallet wait was
bounded by its deadline and the affected entry/setup/timeout prefix was rerun.
Native commit review found the overwritten bottom padding, cross-asset timeout
blocking and keyboard layout growth; those findings were fixed before final
re-review. Current UI captures were regenerated.

Six store images were generated from the current app and inspected. They and
the existing logo meet the dimensions and 500KB limit, contain no PNG metadata,
and match their build copies. Prepared store descriptions lead with the benefit
and retain the claim, fee, investment-risk, control and audit disclosures.

Branch: `fix/usable-inheritance-experience`, task parent `bb45590`. This records
a validated local candidate, not a production deployment or Portal submission.
Native iOS/Android keyboard, wallet approvals and push arrival still need device
verification. New-user task observations are needed before claiming that people
find the app easy to use or prefer it. No independent external security audit
has been performed; store approval remains a separate external decision.

## October 13, 2026 app entry review candidate

The marketing landing page is removed. Home, Assets, Plan and Help are available
before sign-in and remain stable for wallets without a plan. Unauthenticated
balances are unavailable rather than illustrative or zero. Signing in requires a
button tap; shared links enter Plan and retain the vault in the World App link.
An explicitly opened Plan stays selected after owner discovery. Empty screens
lead to setup or received plans, and unavailable discovery is distinguished from
an empty result. Authenticated money and recipient controls retain their gates.

Entry fits 320x640, 390x844 and desktop without scrolling or covering the primary
action. Headings describe app functions; promotional copy, the illustration and
landing footer are removed. Legal and fee information remains in Help and the
transaction review. Store captures use the current UI; the content card contains
no embedded identity or promotional text and reserves its bottom 94px for the
host overlay at 3x export. All store PNGs are below 500KB and have no metadata.
The changes follow the official [App Guidelines](https://docs.world.org/mini-apps/guidelines/app-guidelines)
and [Design Guidelines](https://docs.world.org/mini-apps/guidelines/design-guidelines).

Local verification passed: app entry/shared plan browser 45, unified plan browser
83, canonical identity recovery 5, SIWE/notification authorization 76, locale 7,
typecheck, lint, CSS mapping, Foundry formatting/full tests and generated ABI
parity. A production build using current public GitHub deployment variables was
also opened with the actual SDK outside World App: all four tabs and the World
App entry link work at 320/390px, with no auth requests or runtime errors.

Review regressions verify that a failed heir index offers retry without declaring
an empty plan, and wallet-held receipt assets suppress the Assets setup message.
Assets waits for a complete wallet-share lookup; a selected-token or share-read
failure offers retry instead of presenting an empty result.
Restored unfinished setup opens Plan automatically and retains a resume action
on Home/Assets. Verified received plans remain reachable during partial discovery.
Archived assets retain their recovery screen without an empty Home message; guest
tiles explicitly describe plan balances rather than general wallet balances.
Background balance polling does not supersede an unfinished same-scope read;
a 33-second initial read still reveals held receipt assets after the poll interval.
Reads that stall for 45 seconds expose retry and discard late results. Background
refresh keeps a settled Assets setup action available while balances are read.

This is a local review candidate on `fix/app-first-entry`, based on `6fb901d`.
Production deployment, updated Portal images and review submission are pending;
local Chrome checks do not establish native phone acceptance or store approval.

## October 6, 2026 KST shared owner plan and heir journey release

Owner recipient and interval settings now cover every unsettled configured asset.
Interval changes include an atomic check-in. Check-in from Plan takes one tap and
one wallet request, keeps the live interval and preserves an unsaved interval draft.
Interrupted settings recover the original canonical receipt without resending,
including after a basic slot or every current slot has been released. Remaining
USDC settings stay accessible after WLD pays out. Withdrawals, income collection
and wallet-share redemption remain available during settings recovery.

Heirs see WLD/USDC grouped by owner, can open either currency after discovery,
claim eligible assets together and reopen verified cash/share receipts. Invitations
show the last authenticated heir visit and reported notification permission.
Completion alerts and API access use the immutable finalized yield recipient.

Reviewed task `85ad587` against fixed parent `d7e442d` passed the final complete
native commit review (`gpt-6.1-sol`, max, default tier) with no remaining findings.
Local Anvil/Chrome checks passed: shared plan 29, unified plan 83, WLD 43, USDC 16
and identity recovery 5. Contracts: 375 passed, five opt-in fork skips. Finalizer
151, auth 76 and scheduling 28 passed, as did types, lint, production build,
translations and CSS definitions. The old recovery harness now follows the current
check-in route while preserving actual timer and receipt assertions.

[PR 3](https://github.com/Daviswhistle/Inheritance/pull/3) merged as `e095435`,
whose tree matches the reviewed task. Exact-task CI `37337633133`, production CI
`37339156934` and [deployment `37339156924`](https://github.com/Daviswhistle/Inheritance/actions/runs/37339156924)
passed. Authenticated Cloudflare readback confirms canonical Pages deployment
`5cbc6c73-9767-4ed4-9a6e-d9a245f1d4e2` serves `e095435` and notification Worker
version `f38bf9e5-747f-4cc1-9b3a-f806dac086e4` serves 100% of traffic; the Worker
version matches the deployment job receipt.

The ordinary production browser rendered English/Korean at 320/390px, retained
the language choice and provided World App entry without runtime errors. A genuine
unfunded ephemeral EOA signature verified production one-use nonce/session
issuance, rejected replay and foreign-origin access, and accessed only its empty
Worker records. Live automation health is ready, supports USDC and shows an
advancing fresh cycle. These checks sent no production chain transactions or
external test notifications; no contracts were redeployed.

Live Portal readback remains `awaiting_review`; all ten configured wallet-call
addresses and required Permit2 tokens are registered. Store approval and real
iOS/Android approval sheets, contacts and push arrival remain external evidence.
Current contracts support one heir across the plan. The proposed future design
uses percentages totaling 100%, one recipient by default and a ten-recipient target
subject to contract/wallet benchmarks; multiple recipients are not a shipped feature.
Private execution evidence is under `/tmp/inheritance-plan-experience-20261005`.

## October 5, 2026 simplified setup and check-in release

New WLD + USDC setup creates missing positions, grants exact approvals and
deposits atomically in one wallet request instead of three. The initial screen
asks only for amounts, recipient and interval. Fee/risk consent appears once in
the final review; reminders are optional after funding. Ordinary check-in opens
wallet approval directly. Pending claims require explicit cancellation review,
and changed claims or targets invalidate that approval before submission.

Reviewed task `ea89a92` passed a full native commit review against fixed parent
`eef40ff` with no remaining findings. The prior review's stale consent selectors
in the two yield browser suites were corrected. Actual Anvil/Chrome checks passed:
82 unified flow checks, 43 WLD yield checks and 16 USDC yield checks, including
atomic rollback, response-loss recovery without duplicate deposits, legacy partial
plans, income/reward exits and inheritance. Existing basic, notification, role,
recovery, shared-link and discovery browser suites also passed. Both exact-task
CI runs passed, including 375 contract tests (five opt-in skips) and 68 auth checks.

[PR 2](https://github.com/Daviswhistle/Inheritance/pull/2) merged as `bc236a1`,
whose tree matches the reviewed task. Production CI `37296536962` and deploy
`37296536877` passed. Cloudflare's canonical Pages deployment
`56180aaf-b54e-40cf-b9fe-91562e398785` serves that commit. The actual served bundle
contains the atomic journal and claim review, retains both income factories and
excludes the test bridge. Notification Worker `f1281db2-856f-4539-8853-f49b3f84940d`
receives 100% of traffic. Refill Worker remains
`8b92fe85-6f33-4ce5-a5c8-2256268feb4d` at 100%. Public automation is enabled,
supported, funded and ready, with no halt.

Fresh production Chrome checks passed at 320/390px in English and Korean, with
persistent language choice, the World App entry link and no runtime exceptions.
An unfunded ephemeral EOA passed genuine SIWE sign-in, nonce replay rejection,
Pages/Worker session acceptance and foreign-origin/anonymous rejection. These
checks sent no blockchain transaction and changed no existing watcher. This UI
release deployed no contract and transferred no funds. Portal readback remains
`awaiting_review`, with ten allowed contracts and four Permit2 tokens. Native
phone wallet/contact acceptance and store approval remain separate unverified
surfaces. This documentation update does not redeploy the application.

## October 5, 2026 production deployment and store submission

Reviewed task commit `09b9c0e` completed a fresh native commit review against its
fixed `ff4b3e7` parent with no actionable findings. The first launch-review attempt
failed on model capacity; the same model, Max effort and non-Fast profile succeeded
on retry. Both exact-task CI runs passed. Production merge `f1e94c5` has the same
source tree and its CI, Pages/backend deployment and gas-refill deployment all
passed (runs `37280207795`, `37280207855`, `37280207875`).

Pages deployment `18fc5c62-06e1-4aa6-a174-6cc96a1a1c3a` serves the merge commit.
Primary Worker version `e2c50404-7a31-4da2-b9eb-c5d19b0e1e8a` and refill Worker
version `8b92fe85-6f33-4ce5-a5c8-2256268feb4d` each receive 100% of traffic.
Live bindings preserve shared D1 and all existing secrets; both new income
factories, earlier factories, the pinned gas controller and a zero cumulative
payout gas cap were read back. Automation reports ready, funded, verified gas
funding and no halt. Refill runs in its Durable Object and awaits sufficient
operator fee assets; this is not proof of continuous self-funding or a live swap.
Six observed postdeployment Cron events per Worker completed successfully;
primary caller CPU was 2 ms in the latest samples and refill caller CPU was 0 ms.
Two advancing watchdog samples at 07:55:43 and 08:05:43 UTC were healthy.

The served browser was checked without a fixture bridge or signer: 320/390px
layouts, English/Korean selection and persistence, World App entry and zero
runtime exceptions passed. A genuine ephemeral, unfunded EOA signed the deployed
nonce flow; session issuance, nonce replay rejection, unauthenticated API
rejection, shared Pages/Worker session acceptance and foreign-origin rejection
passed. No blockchain transaction or existing watcher change was made by those
production checks. All seven served store PNGs matched reviewed source hashes.

The portal readback confirms `awaiting_review` for
`app_28c40a2a42b7f6c95789c2d5231b1314`. Ten allowed contract entries, the four
Permit2 tokens, updated descriptions and seven images were verified. Submission
initially rejected the long annotation; it accepted the corrected 35-character
annotation, now reflected in `MORPHO_STORE_METADATA.json`. This documentation
update does not change the deployed application or Worker code.

Final balances: treasury 0.000017483552679017 ETH, refill bot 0.00001 ETH and
keeper 0.00002 ETH. Actual new World Chain network fees total
0.000027944596220571 ETH. The Bags source wallet's 0.00089088 SOL was fully used
as recorded below. Native phone wallet/contact acceptance, World App store
approval, an actual future seven-day payout, third-party security audit and
public adoption remain unverified; the production auth check establishes the
server path and does not replace native-device acceptance.

## October 5, 2026 final launch candidate and onchain receipts

The final interface combines WLD and USDC into one plan, defaults new balances to
Morpho, and separates available income from principal withdrawals. The exact
deposit review displays our 10% realized-positive-net-gain fee and the strategy's
separate current performance fee. A changed strategy fee invalidates that review
before another wallet request. The initial internal review found a setup nonce
recovery issue and a stale reviewed-fee comparison; both were corrected and the
full amended candidate `39a9978` passed a fresh independent native review.

Fresh verification: 375 Solidity tests passed with five opt-in skips; 16 genuine
World Chain fork checks passed without skips; 151 actual Anvil finalizer checks,
12 gas-funding/recovery checks and 10 real-protocol local-fork gas checks passed.
The final unified browser suite passed 76 checks. The complete legacy browser
suite also passed all transaction, layout, notification, cancellation, role,
recovery, selection, discovery and outage stages. Types, lint, localized copy,
production build and Worker packaging passed. These browser tests use a local
World App bridge and do not establish actual phone wallet/contact acceptance.

The user-authorized Bags wallet funding used 0.00089088 SOL in total: 0.00088088
SOL bridge input and 0.00001 SOL network fee. Relay delivered
0.000031676606659751 ETH to the existing operator treasury. Its zero SOL residual
was checked on the finalized Solana chain. Private keys and signed journals remain
outside Git.

| Verified World Chain deployment | Address | Block | Total network fee (ETH) |
| --- | --- | --- | --- |
| WLD owner-income factory | `0x1a856aE8c3abd8a3746F542688a1846Bc6208435` | 35923975 | 0.000011616631101057 |
| USDC owner-income factory | `0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2` | 35923985 | 0.000012124908459366 |
| Protected operator gas setup, six transactions | `0x7544804412033CBd0Eaf47eC5e356C161298F9e9` | 35923997–35924016 | 0.000004203056660148 |

The compiled factory/helper runtimes, fixed assets, strategies, fee recipient and
10% service fee were read back from chain. The gas contract's exact immutable
runtime hash is pinned in both worker configurations. Setup approvals target that
contract, never the bot EOA; bot funding of 0.00001 ETH remains operator property.
The existing keeper's 0.00002 ETH payout reserve was retained. All six setup
receipts passed aggregate canonical finality and final allowance/identity readback
before software activation. This source
receipt records the included deployments, not an already completed frontend
deployment or World App store approval.

Gas exchange execution now runs in a SQLite Durable Object while Cron only
dispatches the work. Existing WLD/USDC factories and their deployment-block ranges
remain configured for discovery and management. No paid provider upgrade was
purchased. Final software deployment, production health and store submission
must be verified separately from these onchain receipts. Real native World App
acceptance, future seven-day live payouts, public adoption and external security
audit remain separate evidence surfaces.

## October 5, 2026 earlier operations and product candidate

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
the service and is not a monitor outside that provider. At this earlier
preparation stage, no paid upgrade or new onchain transaction had been made.

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

At that preparation check, frontend and new income contracts remained
part of the combined launch gate below; the candidate had not been activated in
World App or the store. Treasury and keeper balances then matched
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
