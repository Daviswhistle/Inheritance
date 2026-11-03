# Release evidence

## November 4, 2026 — repaired yield factories and production cutover

Runtime `1e4715d6425c3b369fd3519e1a905dfaa47f11f4` is deployed at
https://3a35cdc0.inheritance.pages.dev. Deployment `41676338353` and CI
`41676338421` succeeded. All 22 public files match the immutable deployment and
an explicit production-mode local build; root SHA256 is
`9b4c2ff874c5fc3e029e46d014e8db084caf6d2266f3d2355d402aaf11ff3391`.
Worker `b07b7a46-8a56-4a0c-be02-c39f193a152f` supports the new and all retained
automatic generations before Pages activation. Native iOS run `41673388897` passed interrupted-deposit recovery but failed
`testRealSDKLoginAndNativeLifecycle`: the test retained an obsolete keyboard AX
object after a keyboard-layout change and spent its stability deadline resolving
it. Its screenshot shows the full focused input above the keyboard; native/CSS
geometry and all nine hit-test samples confirm visibility. Test-only fix
`ca55eac` reads portrait input/WebView/Done/keyboard frames from one fresh snapshot
and reacquires the landscape keyboard query per poll, preserving all bounds,
height, visibility, timing and three-sample stability requirements. Swift parse
passes. The older queued runtime run `41676338433` was cancelled after this fix;
replacement native run `41678818435` reached all repeated geometry checkpoints
but was cancelled at the 25-minute job limit. Eleven 60-second XCTest system
animation idle waits accumulated; the first test had not completed and recovery
had not started. No pass is claimed, and its incomplete xcresult has no exported
screenshots. `c9e30be` extends only the whole-job limit to 45 minutes, leaving
all individual checks unchanged. Run `41683367120` passed pending-deposit
recovery but failed the first input-stability assertion. Its screenshot shows
full input visibility and an OS QuickPath introduction over the keyboard. The
old log cannot identify which snapshot/valid-sample branch prevented completion,
so that remaining uncertainty is retained rather than calling it an app pass.
`7bd106e` scopes fresh snapshots to the WebView, reacquires native keyboard
geometry, handles only the exactly identified OS lesson and records each query,
valid sample and reset reason. `8c36672` prepares the selected simulator's
keyboard tutorial preference with readback, consistent with
[Appium's device preparation](https://appium.github.io/appium-xcuitest-driver/10.43/getting-started/device-setup/).
All previous application visibility, touch and stability checks remain. Native
run `41688191187` passed the initial keyboard assertion and pending-deposit
recovery, but the scoped helper incorrectly required DOM Done in short landscape.
Screenshots and AX confirm the full input and native accessory Done, which the
product intentionally uses below 240 CSS pixels. `8f9b186` checks the two toolbar
layouts explicitly, requiring a unique hittable native Done within its accessory
band when the DOM toolbar is hidden. All visibility and stability checks remain.
Replacement run `41691298772` attempt 1 on `5eebfe0` failed before any step:
GitHub reported hosted-runner acquisition failure and ARM64 capacity constraints.
Intel fallback `41693995249` on `46ca812` completed with one pass (recovery) and
one failure (initial Reject lookup). The screenshot shows valid wallet-auth
Approve/Reject controls and an open native Account selector; the captured trace
does not distinguish automatic focus from a pointer opening it. The shared
"Test host controls" title is not evidence of a wrong dialog. The host now
explicitly focuses its title when opening, with a browser regression check;
its native verification is pending. No approval/visibility assertion was weakened.
ARM retry `41691298772` attempt 2 passed both tests, zero failures, in 318.960s;
its screenshot review is pending. Distinguish it from the earlier capacity failure. Standard Apple Silicon remains the normal runner.
Heading-focus fix `f99a33c` passed targeted initial/retry focus, Reject/Approve
and six bridge unit checks. A broader browser smoke timed out in both-asset plan
confirmation before the new assertion; baseline comparison is pending. The focus
fix still needs its own native verification. General CI `41691298593` and
`41693995134` passed all three jobs.
Production runtime remains `1e4715d`; these changes affect only testing.

The finalized WLD factory is `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff`
(block 37192969); the finalized USDC factory is
`0xB3d5ead33a91287C2D39b345041D5a44dC381c5e` (block 37193547). Both fix the
1000-bps service-fee recipient at `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a`.
Factory/helper runtime, immutable values, child-creation chunks and reconstructed
child code match the reviewed generation. All four contracts have exact
Sourcify matches and full Blockscout source records; this is source verification,
not an independent security audit. Old immutable contracts keep their original
configuration. No existing customer assets were migrated.

- Public health confirms seven supported automatic factories; the frontend also
  retains the manual-only basic generation. New primary routes use the repaired
  factories and all four earlier yield generations remain accessible.
- Portal has the original ten contracts plus the two new factories, unchanged
  Permit2 token permissions, KR only and unverified status. Funding-only router
  and WETH permissions were removed; the temporary operator scripts are inert.
- Actual Android World App: force-stop/deep-link entry pixels, authenticated Home,
  retained recipient/30-day settings, and WLD/USDC asset tabs verified. Empty
  vault positions remain distinct from wallet balances. No new deposit,
  withdrawal, notification or transaction approval was requested in this smoke check.
- Local forks created children through both actual deployed factories and
  verified exact runtimes, immutables and owner/heir restrictions. Merkl faults
  preserved principal access. Real unchanged Re7 USDC cash settlement and
  rejected-fee rollback/share payout passed; bounded valuation failure used the
  existing zero-share-fee policy. A separate mock-strategy variant confirmed
  proportional share fees when valuation succeeds. These are local-chain tests.

Deployment was funded with the approved 0.00004 WETH. Both CREATEs cost
23096220264673 wei; remainder wrapping cost 71479824343 wei and return cost
49358573070 wei. The Safe received exactly 16534664601754 wei WETH in block
37194854. Total fees 23217058662086 wei plus returned WETH and retained native
dust 248276736160 wei reconcile to the full approved amount. All four receipts
are finalized and the guarded runner reports complete; the temporary keystore
is retained for its native dust.
See [deployment evidence and final reconciliation](WORLDAPP_DEPLOYMENT_2026-11-03.md).
Submission remains stopped.

## November 3, 2026 — login recovery, sign-out and ended-plan restart

Runtime `f6dc58a06633c28144bcc292be732db25183ec6a` is deployed at
https://5a3a5e6a.inheritance.pages.dev. Production HTML and all four referenced
assets match the immutable deployment (November 3, 19:01 KST readback).
Deployment `41615531163` and CI `41615531224` succeeded. Native iOS run
`41615531022` passed the login/keyboard test but failed the pending-deposit test
before its transaction: the stability helper queried an old WKWebView rectangle
and received a zero frame after keyboard resize. The failure screenshot shows
the focused recipient field above the keyboard; its AX snapshot contains the
real nonzero viewport. Earlier functional run `41615178147` passed both tests.
The helper now reads both rectangles from one fresh app snapshot, retaining
hittability, 44-point height, full visibility and three stable samples over 0.8s.
It also checks stable viewport geometry and enables gesture diagnostics in the
pending-deposit test. Rerun `41618049272` on `498d773` succeeded: two tests
passed, zero failures/skips, iPhone 16 Pro / iOS 18.5. The result summary and
recovered-deposit screenshot were downloaded and inspected. No product code
changed after runtime `f6dc58a`; CI `41618049258` also passed.

A supplementary local iOS 27.0 probe did not reach the transaction stage:
the headless Mac toolchain did not display a software keyboard, including after
matching the CI keyboard preference. It is not counted as a product pass/fail;
its owned host/simulator were stopped and the original preference restored.
Submission remains stopped. No new production transaction or outbound message.

- Official MiniKit wallet authentication now has a 60-second overall timeout,
  rejects overlapping attempts and ignores late responses after timeout/sign-out.
  The timeout screen offers reload recovery. Authenticated identity no longer
  waits for balance RPC connectivity.
- Header and Help expose Sign out / 로그아웃. It clears the local credentials
  and resets the page, preserving account-scoped transaction recovery journals.
  Help explains that assets and inheritance settings remain unchanged.
- Ended empty plans show restart instead of redundant renewal/exit actions.
  The owner is no longer labelled as the heir after recipient removal. Restart
  opens setup directly and reviews reuse of the selected vault, with a renewed
  deadline before recipient reassignment; unselected ended assets stay ended.

Local validation:
- Typecheck, lint, build, locale 10 checks, CSS class consistency and built-copy
  checks pass; server authentication/authorization 77 checks pass.
- New login lifecycle regressions cover whole-login timeout, duplicate native
  commands, late nonce/signature/server responses, logout and successful sign-in.
- Chromium and WebKit each pass six login/session journeys with real MiniKit SDK
  and a simulated host: rejection/retry, sign-out/re-entry, Help, blocked RPC,
  unanswered wallet and late response, then successful reload/retry. Header
  layout and touch targets checked at 320px and 390px.
- Chromium and WebKit exit suites each pass all 16 checks, including real disposable-chain
  redeposit and full recovery after the ended plan's old deadline. Recovery
  storage 10 checks, mobile regressions 13 checks and unified routing tests pass.
- Actual Android World App: cold link entry, successful sign-in, header sign-out,
  return to guest, re-login with unchanged saved plan, Help sign-out and final
  account-card presentation verified. No transaction approval or funds used.
- Test-host browser checks are not actual iOS World App validation. Previously
  reported immutable-contract security findings are unchanged by this revision.


## November 3, 2026 — authentication and guideline corrections (submission stopped)

Runtime `aa67a75c382e44d9a30e95cdd09fc286a8b44861` is deployed at
https://d92b0dde.inheritance.pages.dev. Production HTML, four imported assets
and six static documents/assets match that release and the source documents
(November 3 13:40 KST readback). Functional changes are in `61b6892`; subsequent
commits correct the Privacy Policy revision dates and Portal evidence wording.

Corrections:
- Remove the unused World ID verification flag and client-only success/cache
  branch. Sign-in uses official wallet authentication and server verification.
  Old `wld-verified` markers are removed and grant no authority.
- Explain persistent exit recovery separately from tab-only settings records in
  English and Korean Privacy Policy. The exit review explains storage before
  approval; cancellation does not create an exit recovery record.
- Portal readback confirms `unverified`, KR only, languages `en` and `ko`.
  Only supported languages and draft descriptions changed. Descriptions now
  reflect end-and-withdraw, recovery storage and the contract review package.
- Replace obsolete current/awaiting-review assertions with the actual withdrawn
  state. Prepare CONTRACT_REVIEW_PACKAGE.md with contracts, permissions, fees,
  sources and reproducible evidence; it is not TFH acceptance.

Validation:
- Typecheck, lint, production build, locale (10), CSS and built-copy checks pass.
- Authentication/authorization suite: 77 passed, zero failures, including the
  retired verification marker alongside an untrusted cached address.
- Chromium and WebKit exit suites: 15 checks each, including disclosure before
  storage, small-screen accessibility, cancellation, atomic rollback and original
  request recovery. Test funds only; no new mainnet transaction.
- Bilingual legal pages: 12 browser checks, including 320px layouts and blocked
  localStorage. Production readback also checks both updated policy dates.
- Android World App: production cold link entry, explicit successful sign-in,
  in-app Korean Privacy Policy storage text, exit storage review and cancellation
  observed. Phone returned to Home; no wallet transaction approval was opened.
- Native iOS functional revision `61b6892`, run `41578881884`: 2 tests passed,
  zero failures/skips on iPhone 16 Pro / iOS 18.5 arm64 Simulator. Downloaded
  Xcode summary and keyboard-dismissal / interrupted-deposit recovery screenshots
  were inspected. Final source `aa67a75`, run `41579363563`, also passed both
  tests with zero failures/skips in the same simulator environment; its downloaded
  Xcode summary confirms the result. This is a native test host, not iOS World App.
  Previous run `41483406437` had no steps because no hosted Mac runner acquired
  it; application tests did not run in that attempt.

CI/deployment IDs: source `61b6892` passed CI `41578881894` and deployment
`41578881887`; policy-date revision `9a4f2cf` passed CI `41579156847` and deployment
`41579157103`; final CI `41579363657` and deployment `41579363738` passed.
The intermediate policy-date native run `41579157137` also completed successfully.

Remaining external evidence: no response to the existing TFH inquiry was found
in the connected mailbox on November 3. Existing-contract/fee review acceptance,
actual iOS World App approval/permission behavior, and the beneficiary's complete
production payout remain unverified. Simulator/local results do not establish
these. No new external message, notification, real funds or submission was used.
Private evidence: `../evidence/guideline-fixes-nov03/`.

## November 3, 2026 — end inheritance with asset recovery (submission stopped)

Runtime: `2938a05014cad181db8b8bc93e8cab8e4e5016dd`.
Immutable deployment: https://46b15c0e.inheritance.pages.dev.
Production: https://inheritance.pages.dev.
CI `41483406456` and deployment `41483406606` passed.
Public HTML, four imported bundles and six static documents/assets match the
immutable deployment (November 3 01:41 KST readback).

The default action now combines full asset recovery to the owner's wallet with
recipient removal. Keeping funds invested is a separate remove-only choice.
Previously removed recipients expose retained funds and a recovery action on
Home. Empty plans omit payout claims and irrelevant investment choices. A
failed asset exit rolls back the entire batch. Durable recovery resumes the
original request, including after loss of its operation identifier. No contract
or fee policy was changed. See PLAN_EXIT.md.

Validation:
- Dedicated real-SDK/disposable-chain suite: 15 checks passed in Chromium and
  15 in WebKit/iOS transport, including accessibility of the new review.
  Review/cancellation, reject/retry, quote/liquidity failure, actual atomic revert,
  process loss, lost hash, old remove-only balances, empty closure, already-closed
  no-op prevention, basic WLD and reward-only USDC are covered. Negative receipt
  proofs reject wrong token/source/recipient, missing transfer and low output.
- The funded scenario returns exactly 11.9 WLD and 10.9 USDC with both vaults
  empty. The basic-plus-reward-only scenario returns exactly 3 WLD. These use
  local test tokens, not production funds.
- Typecheck/lint/build, 10 locale checks, 13 mobile regressions, 66 error cases,
  CJK and CSS checks passed. Existing Chromium 68-layout / 37-state axe suite,
  WebKit 31-layout suite and 10 human journeys passed during the exit revision.
- Actual Android World App: cold link entry, sign-in, owner settings, exit review
  and cancellation checked against production. The account has no deposited
  assets, so the screen correctly shows recipient removal with nothing to
  return. Final empty settings also omit the keep-invested choice. No wallet
  transaction request was sent; no new production full-exit payment is claimed.
- Native iOS host runs `41480214536` (f143119), `41480898273` (4dc2280) and
  `41482006681` (06a17f3) each passed 2 tests, zero failures/skips. Downloaded
  Xcode summaries identify iPhone 16 Pro / iOS 18.5 Simulator. The final
  `2938a05` only adjusts the empty settings presentation; its automatic run
  `41483406437` was queued at this checkpoint. Follow-up: GitHub ended it before
  any steps because no hosted Mac runner acquired the job (capacity constraints).
  No application test ran; this is neither an app failure nor a pass.
  Simulator-host results do not constitute actual iOS World App validation.

Private logs, screenshots, result bundles and production comparisons are under
`../evidence/exit-flow-nov03/`. No real funds, outbound messages, notification,
Portal change or submission were performed. The phone is returned to Home.

## November 3, 2026 — integrated interface completion (submission stopped)

Runtime: `9e6857ad9f46c7e476ed8f569cfec811de6d1e9d`.
Immutable deployment: https://84332757.inheritance.pages.dev.
Production: https://inheritance.pages.dev.

The operator's incoming design/copy changes were retained and completed with
accurate transfer/withdrawal language, neutral mixed-receipt headings and an
error-preserving toast queue. No contract, fee calculation, access-country rule
or transaction authorization behavior was changed. The general transfer guide
now explains the process without the death disclaimer; pre-deposit review and
legal terms retain the material living-owner transfer condition.

Validation for this source:
- CI `41472483108`: success. Pages/backend deployment `41472483240`: success.
- Public HTML and four imported bundle files match the immutable deployment;
  six static files (terms, privacy, yield terms, language script, legal CSS and
  icon) match deployment and local source.
- Typecheck, lint, build, locale placeholders (10), mobile regressions (13),
  error translations (66), registered CJK and CSS checks passed.
- Chromium: 68 layouts; 37 axe-core 4.10.3 accessibility states, zero violations.
  WebKit: 31 layouts including actual SDK iOS transport with a simulated host.
- Ten disposable-chain journeys include all-withdrawal review/cancel, fee-net
  balances, separate USDC investment, liquidity changes, cancelled-but-retained
  funds and a receipt paid as investment tokens. The mixed receipt heading is
  asserted against the actual rendered page.
- Twelve bilingual legal-page checks cover 320px, both engines, language switches
  and storage blocked.
- Actual Android World App: force-stop followed by canonical link entry renders
  the new Home. Home, Assets, Plan, Help, expanded transfer guide, fee answer,
  Terms -> Privacy and dialog close were visually inspected. The general guide
  has no death disclaimer and all actions remain reachable. Returned to Home.
  These were guest checks; no new wallet authentication or production transaction
  was attempted.
- Native iOS run `41472483141`: success, 2 passed / 0 failed / 0 skipped.
  Downloaded `ios-summary.json`, full logs and attachment manifest identify
  iPhone 16 Pro / iOS 18.5 arm64 Simulator. Both
  `testRealSDKLoginAndNativeLifecycle` and
  `testZPendingDepositSurvivesProcessTermination` passed. Keyboard Done,
  orientation/foreground and process-death deposit recovery screenshots were
  exported; the Done placement and recovered amount were visually inspected.

Private evidence: `../evidence/final-ui-nov03/` relative to the repository.
It includes the preserved incoming diff, logs, browser screenshots, production
file comparison and Android pixels. Device captures and local test data were
not committed. Real iPhone World App validation is not claimed by simulator
results. No new funds, notification, outbound message, Portal change or
submission was performed.


The first dated section is the latest verified state. Older dated sections
record historical snapshots and do not override it.

## November 2 21:24 KST — action-based Korean wording, no submission

Runtime `b5842aecae480f1042b7907394610e36d799539a` is deployed at
https://e2f8e217.inheritance.pages.dev (deployment 41443966906, CI 41443966864:
both success). Main revision `ca7d390` changes the Korean wording across entry,
setup, funded/empty Home, assets, owner settings, recipient states, help,
notifications and errors. It aligns the Korean legal wording with the visible
action. `b5842ae` then shortens three first-use strings read on Android.

The main action now says **기한 연장하기**. Setup explains that a 30-day period
starts again from each approved extension; the funded Home displays its actual
deadline date prominently. Recipient copy distinguishes expiry, request, the
seven-day wait and cancellation until actual payment. The setup confirmation
says **이 금액 맡기기**, followed by native wallet approval. Financial, transaction
and eligibility behavior is unchanged. See [COPY_REVIEW.md](COPY_REVIEW.md) for
why the earlier copy review was insufficient and the scope of this follow-up.

Typecheck, lint, build, ten translation checks, 66 known-error checks, 68 Chromium
layouts, 31 WebKit layouts and ten disposable-chain journey checks passed.
Final short-copy build and translation registration passed (786 distinct Korean
strings). The translation validator now compares required parameter names and
verifies repeated day values interpolate; it still rejects missing parameters.
Initial local checks encountered a misnamed checker command, a missing default
Playwright Chromium binary and stale wording expectations. The correct checker,
installed Chrome and updated expectations passed without removing behavior
assertions. No application failure was inferred from those harness issues.

At 12:23:03 UTC, public and immutable HTML, four imported assets and five legal
files matched; Korean text was verified in the served bundle. Actual Android
World App showed the revised Home, Plan introduction and expanded explanation;
after the final deployment, Home and Plan were re-opened and captured again.
The phone was returned to guest Home. No sign-in, real transaction, notification,
external message or submission was performed. Private evidence is outside Git
under `work/evidence/plain-language-nov02/`.

Native simulator runs 41443475080 and 41443966856 were still running at 21:24 KST.
Their results are not counted as passes here. Browser regression and editorial
screen reading are not a recruited comprehension study or actual iOS World App
approval/permission validation.

## November 2 20:21 KST — native iOS results confirmed, no submission

Both previously pending native runs passed on the iPhone 16 Pro / iOS 18.5
arm64 simulator:

- [41431460190](https://github.com/Daviswhistle/Inheritance/actions/runs/41431460190),
  deployed runtime `481b34f`: two tests passed, zero failures or skips.
- [41430777472](https://github.com/Daviswhistle/Inheritance/actions/runs/41430777472),
  whole-app copy revision `b643e0f`: two tests passed, zero failures or skips.

This was verified against complete job logs and both downloaded
`ios-summary.json` / Xcode result artifacts, not just workflow badges.
The tests cover SDK sign-in cancellation/retry, native process restart,
decimal/text keyboards, rotation and foreground recovery, Done touch handling
without activating the field underneath, and restoration of a pending local
deposit after process termination without a second transaction. The latest
keyboard-dismissed and recovered-balance screenshots were also visually checked.
The separate pending/reverted local-transaction step passed in both runs.

The earlier [41424288591](https://github.com/Daviswhistle/Inheritance/actions/runs/41424288591)
was marked failure because its job never acquired a hosted runner. GitHub's
check annotation explicitly says "The job was not acquired by Runner of type
hosted even after multiple attempts", alongside macOS arm64 capacity notices.
The job has no executed steps, no assigned runner and no artifacts. This is an
infrastructure allocation failure before testing, not an application assertion
failure or a 25-minute test timeout. Subsequent runs acquired runners and passed;
no app or workflow change is justified by this incident.

Private logs, summaries, attachments and failure annotations are retained outside
Git under `work/evidence/ios-result-nov02/`. These tests use a native WKWebView
test host with simulated wallet approvals and disposable-chain funds; they do
not establish actual iOS World App permission or approval behavior. The deployed
runtime is unchanged. No submission or real transaction was performed.

## November 2 19:50 KST — whole-app copy, Korean legal reading, no submission

Runtime `481b34ffa283ca185f748cc92cac208363e46315` is deployed at
https://b344271b.inheritance.pages.dev by successful deployment 41431460152.
The whole-app change is `b643e0f`; `481b34f` only clarifies that successful
automation registration is per-plan registration, not a global service-health
guarantee.
The public alias matches its HTML, all four imported runtime assets and all
three legal documents plus their language script and stylesheet. CI 41431460239
passed all jobs. See [COPY_REVIEW.md](COPY_REVIEW.md) for the writing rules,
coverage and examples.

This reviews the whole user journey: 229 existing Korean strings and 57 English
strings changed, plus 46 keys for known failures and crash recovery. Waiting
periods, check-ins, recipient actions, investment tokens, amounts, fees, setup
recovery, alerts and history now explain the action and result in plain terms.
Full Korean translations of Terms, Privacy and Yield Terms retain the English
text and provide a language switch. Financial conditions and transaction logic
are unchanged. Diagnostics remain available in details.

Validation passed: typecheck, lint, production build, CSS registration, Korean
registration (787 distinct strings), ten i18n checks, 66 error-text checks,
68 Chromium layouts, 31 WebKit layouts, ten disposable-chain journey checks,
and twelve bilingual legal checks (both engines, 320px, including blocked
storage). Legal dialog tests preserve the exact draft, consent and focus while
switching documents/languages. Initial WebKit failures were stale expected copy
and an ambiguous link selector after translation; the final run preserves all
behavioral assertions and passes.

Actual Android World App rendered the deployed Home, revised Help/three-step
sequence and Korean Privacy/Terms dialogs, language switching and return to Home.
The final production comparison was recorded at 2026-11-02T10:49:22Z. No sign-in,
real transaction, notification, invitation, external inquiry or submission was
performed. Automatically triggered native simulator runs 41430777472 and
41431460190 were still in progress at 19:51 KST; do not count them as passes.
They are extra native-host regression runs, not actual iOS World App tests.
These checks are not a recruited first-time-user comprehension study.

## November 2 18:55 KST — entry copy revised, submission stopped

Runtime `ecce410` deployed via run 41424288549 at
https://61f9acc8.inheritance.pages.dev. Production HTML and all four directly
imported assets match. Home describes choosing assets/recipient and checking in;
the deadline/request/seven-day/cancellation sequence stays visible. Sign-in no
longer carries a money-movement disclaimer. Its wallet-data notice, legal links
and Agree and sign in button remain; session details remain in the Privacy Policy.
The policy's description of the sign-in screen was reconciled with that change.
The explicit limitation that the app does not verify death, including eligibility
while alive after a missed deadline, is visible in the final deposit review.

Typecheck, lint, build, registered translations and nine i18n checks passed.
Chromium passed 68 layouts; WebKit passed 31 layouts. CI 41424288712 passed.
Actual Android World App pixels show the new home and simplified sign-in area
following a cold launch. No login, production transaction, notification, inquiry
or submission was performed. This is a copy/presentation revision; it does not
change transaction or keyboard behavior. The automatically triggered native
host run is separate from these completed checks; no new native pass is claimed
in this receipt.

## November 2 18:33 KST — cold-start diagnosis corrected, submission stopped

Timed captures on unchanged runtime `55ede20` distinguish native startup/loading
from UIAutomator omitting a visibly rendered WebView. Both the app and static
Terms control render without a second deep link; navigation responds. The
previous persistent-blank diagnosis below is superseded by
[ANDROID_COLD_START.md](ANDROID_COLD_START.md). The capture procedure now records
pixels and actual process termination, treats missing web XML as inconclusive,
and cannot reuse a stale XML dump. No application runtime change or submission
was performed for this correction.

## November 2 — whole-app usability revision, submission stopped

Current Portal state was independently read as **unverified**, **KR only**.
The operator explicitly prohibited submission. No submission is performed for
this revision; the earlier dated receipts below are historical.

[HUMAN_UX_REVIEW.md](HUMAN_UX_REVIEW.md) describes the full journey audit and
reference material. This revision distinguishes inheritance savings, wallet cash
and separate Morpho investments; uses net values with a gross/fee calculation;
provides honest empty and unavailable states; adds amount/destination review;
and makes settings, status feedback and recipient investment receipts clearer.

The task-based local-chain suite passed ten checks, including partial liquidity,
quote changes, cancellation, fee math, retained funds after cancellation and an
actual local investment-only inheritance payout. No production transaction or
outbound notification/message was used. Chromium passed 68 layouts; WebKit passed 21 checks across 31 layouts.
Typecheck, lint, production build, CSS registration, Korean translation checks,
translation tests and mobile regression tests passed. Initial test failures
were stale copy/direct-approval expectations and local fixture RPC/residence
setup; the updated tests retain transaction, validation and cancellation gates.
Runtime `55ede20` deployed at https://254030a6.inheritance.pages.dev (deployment
41411497039), with production HTML and all four directly imported assets matching.
Three legal documents return 200 and the backend health endpoint returns `ok`.
CI 41411497162 and test-source CI 41412039434 passed all three jobs. Actual
Android World App confirmed the empty inheritance state, selected
WLD/USDC scope, separately quoted wallet investment, settings and setup separation,
and Help. On the final build the setup return action is visible immediately after
entry. The phone was returned to Home without entering amounts. No production
transaction approval was opened. Final Portal readback remains `unverified`, KR only.

Native host run 41409617479 passed the keyboard lifecycle and failed recovery
because it still expected `Assets in your plan`. The exported accessibility tree
contains `Your inheritance savings`, the exact restored `1.000001` USDC and the
active check-in. The expectation is updated to the new heading and the actual
empty-state title; amount, deadline, loading and action checks remain intact.
Run 41411497155 then failed to compile because one assertion still referenced
the renamed variable. Test-only `1d4670c` fixes that reference. Final native
[run 41412039522](https://github.com/Daviswhistle/Inheritance/actions/runs/41412039522)
passed both tests with zero failures or skips. Five recorded Done gestures
consumed touchend and generated no follow-on click. Pending-deposit recovery
restored the exact balance and enabled check-in without resubmission. These are
native WKWebView host tests with simulated approvals, not actual iOS World App.

A device-specific entry issue remains recorded: force-stopping World App then
opening a direct Mini App link showed a blank native container; opening the same
link again while World App was running rendered the same production build.
Phone Chrome also rendered it. Launching World App normally restored the app,
and a subsequent direct link rendered the guest screen and successful sign-in.
Both old and canonical links were tested; this
is a cold-start observation, not evidence that the app script caused it. Do not
claim that first observation was fixed or that the release is ready to submit.

## November 2 16:03 KST — first-use revision submitted, Korea only

After the first-use walkthrough, actual Android correction/readback, final
browser checks, native host acceptance and CI, the authorized revision was
submitted. Independent Portal readback at **2026-11-02T07:03:28.119Z /
16:03:28 KST** confirms **awaiting_review**, exactly **KR**, developer allowlisting
true. Only `verification_status` changed from the immediate pre-submit snapshot.
App/metadata IDs are unchanged. Pre-submit main: `cf6f74f`; deployed runtime:
`85b3d2a`; native test source: `74d7667` (run 41402516155, two passes, no failures
or skips). The production alias matches https://89d74460.inheritance.pages.dev.

The improvement-focused submission covers the deadline/request/seven-day
explanation, separate sign-in and deposit approval, optional assets, recipients
outside saved contacts, visible interval rules and automatic reading-position
movement when opening setup. It links the reviewer walkthrough and source/test
evidence. Hero/setup previews and store copy match the revised interface.
The existing immutable-contract and realized-profit fee review request is
included. Native host approvals are described as simulated. This is review
pending, not TFH approval or public launch. No additional real transaction,
notification or external inquiry was sent. Private receipts and device evidence
remain outside Git. The phone was returned to Home without entering amounts.

## November 2 — first-use clarity verified

After submission, the operator requested another walkthrough from a first-time
user's perspective and authorized further fixes. Before this revision was submitted, Portal readback was **unverified**, exactly
**KR**. The new submission receipt above is the current status.

Runtime source `8cf931c` clarifies the check-in trigger rather than death
verification, the recipient's request and seven-day wait, login versus deposit,
optional asset selection and manual recipient entry. The interval explanation
is visible without expanding details. No transaction or inheritance rules changed.
Actual Android inspection found that **Add to my plan** inserted its form below
existing settings without moving the view. `85b3d2a` focuses and reveals the new
setup steps after permitted entry, without focusing an input or opening the
keyboard. Browser coverage checks the visible reading target and keyboard state,
including entry after a location retry. The first draft of that assertion was
mistakenly placed in an explicitly unsupported-country fixture; it was moved to
the supported retry, keeping the unsupported blocking assertions intact.

The isolated first-use walkthrough reaches review with each asset separately,
retains exact amounts on Edit, and records zero transaction requests. It is not
research with recruited users. Final runtime is `85b3d2a6081467f9e3a4be879a3b693047a11407`, immutable
https://89d74460.inheritance.pages.dev. Deployment 41401139077 and CI 41401139045
passed. Production HTML and all six imported assets match; three legal pages
return 200 and the Worker reports a fresh funded/ready cycle. Hero and setup
preview images match the updated UI and Portal upload commits were confirmed.

Native run 41399668170 passed recovery but failed before the recipient Done tap:
twelve alignment drags left the interval label at Y=356–376 while Done's center
was Y=314.3125. The first numeric-input Done gesture passed. This is a failed
fixture arrangement, not a completed failed Done action. Test-only `17d8e89`
changes the arrangement gesture to slow velocity with a final 0.5-second hold;
the exact overlap gate and native event-target/no-extra-click assertions remain.
Final native run
[41402516155](https://github.com/Daviswhistle/Inheritance/actions/runs/41402516155)
(test source `74d7667`) passed both tests, zero failures or skips. All five Done
traces start on the actual button, prevent touchend, emit no extra click, remove
input focus and restore actions. All four exact-overlap arrangements reached the
target in one measured adjustment. Pending-deposit recovery passed after process
termination. CI 41402516259 passed. Production code remains `85b3d2a`. Submission is recorded separately after independent Portal readback.

The first Chromium run failed the expanded-guide clearance gate and could not
capture its failure screenshot. A controlled same-browser probe isolated the
fixture: a relative profile path produced zero animation frames in one second
and no screenshot; an absolute path produced 60 frames and a screenshot, with
the same GPU flag. A separate GPU-flag comparison using absolute paths passed
both cases. The driver now resolves its run/profile directory to an absolute
path. This fixes the test renderer setup, not production app layout. The final
run uses the original browser flags and a relative VERIFY_TMP input to exercise
the path correction; all 68 Chromium layouts pass. Final WebKit checks pass
21 checks / 31 layouts. Actual Android confirms the revised instructions and
setup-opening focus, without opening a keyboard or moving funds. Raw probes remain private outside Git.

## November 2 15:08 KST — revised UI submitted, Korea only

The operator-authorized revised release was submitted after runtime CI, native
lifecycle/recovery, browser, production-readback and actual Android UI checks.
Independent Portal readback at **2026-11-02T06:08:56.622Z / 15:08:56 KST**
confirms **awaiting_review**, exactly **KR**, developer allowlisting true. Only
`verification_status` changed from the immediate pre-submit snapshot. App and
metadata IDs are unchanged. Pre-submit main: `7e13bba`; deployed runtime:
`fd16206`; final native test source: `a89aec9` (run 41396499474).

The submission describes the clearer amount/recipient summary, separate wallet
costs, two fee roles and calculation tables, compact live-rate details, preserved
draft and interrupted-request recovery. The refreshed store preview is committed.
It links the reviewer walkthrough, source/fee evidence and verified test results.
Actual Android and the simulated iOS host are distinguished. Existing immutable
contracts and the realized-profit service fee are requested for code review.
This is **review pending**, not TFH approval or public launch. No new financial
transaction, notification, email or Telegram message was sent during this revision.
Exact changelog, private device evidence and the independent submission receipt
are retained outside Git.

## November 2 — deployed UX revision after operator withdrawal

The operator withdrew the 02:45 KST request and requested clearer mobile UI/UX.
Pre-submit Portal readback confirmed **unverified**, with **KR only** unchanged.
The revised release was verified and resubmitted as recorded above.

The review now leads with exact amounts, recipient and interval. A separate
wallet-debit receipt distinguishes the deposit from an additional WLD network
fee whose quote is shown in World App. Asset-manager and service fees remain
visible before unchecked risk consent. Per-asset calculation tables replace
long prose examples. Setup keeps live rate details available on demand;
recovery leads with completed deposits, remaining work and its next action.
The store setup preview has been regenerated from the revised test screen.

Runtime verification also reproduced a mined-receipt confirmation stall on an
idle Anvil chain: the provider cached the preceding block height and waited for
a future block event. Under the same 250 ms cache, the old block-event wait timed
out at 1,804 ms; direct receipt/confirmation polling confirmed at 309 ms without
mining another block. `529668f` retains canonical-hash, confirmation-count,
receipt-status, expected-event and post-state gates while polling the receipt.
`fd16206` also bounds receipt RPC waits by the request deadline. All 15
confirmation tests pass, including a stalled RPC, delayed confirmations, reverted
and mismatched receipts. No additional real funds or notifications were used.

Production source `fd162062d79b2f2af52bff98ff017af6dfbbb44a` is deployed at
https://inheritance.pages.dev and immutable https://e52ac60c.inheritance.pages.dev.
[Deployment 41395540398](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540398)
and [CI 41395540405](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540405)
passed. Public HTML and all six imported assets match the immutable release;
three legal documents return 200; the Worker is ready, funded and cycling without
a halt or last error. Chromium product checks passed 68 layouts; WebKit passed
21 checks and 31 layouts with zero page errors. The full local-chain flow passed
92 checks on the receipt-polling revision, followed by the final bounded-RPC
unit checks and stable-runtime Chromium/WebKit reruns. Translation (9), mobile
(12), type, lint, CSS usage and production-build checks passed.

Actual Android World App testing on Samsung SM-N986N / Android 13 confirmed
sign-in, Done dismissal, retained amounts, live-rate details, exact WLD/USDC
review amounts, separate conditional network fee, both fee roles and calculation
tables, disabled approval before consent, and Edit preserving both amounts.
The display-only 0.01 WLD and 0.01 USDC inputs were cleared and the app returned
to Home. No transaction approval, new spend or notification occurred. The new
store setup preview was uploaded and the Portal confirmed the metadata commit.

Native run 41395213145 passed the keyboard lifecycle but failed a stale
recovery-title assertion after the intended copy change. Run 41395540414 also
failed that assertion and stopped before a subsequent Done gesture because the
fixture could not align the interval label beneath the button; its first two
Done gestures passed. This run is not counted as acceptance. The exported
accessibility hierarchy from 41395213145 contains the restored “Continue
unfinished setup” region and heading; the test still searched for “Finish your
saved plan”. Test-only `a89aec9` corrects that expectation. Final native run
[41396499474](https://github.com/Daviswhistle/Inheritance/actions/runs/41396499474)
passed both tests with zero failures and skips on iPhone 16 Pro / iOS 18.5
Simulator. All five traced Done gestures started on the actual button, prevented
touchend, emitted no extra click, removed input focus and restored actions.
The intended exact label-overlap gate was reached before the relevant taps.
Pending-deposit recovery survived process death. Source `a89aec9` changes only
the test expectation relative to the deployed runtime. CI 41396499548 and
documentation CI 41397770996 passed. The native host uses simulated approvals
and is not actual iOS World App.

## November 2 02:45 KST — previous Korea-only request (withdrawn)

The operator selected **South Korea (KR) only** on November 2. The 01:52 KST
KR/AR/CO submission was withdrawn for this scope change. Independent Portal
configuration readback confirmed **unverified**, exactly **KR**, with only
availability copy and supported countries changed. After final verification,
the Korea-only request was submitted. Independent readback at **November 2
02:45:23 KST / November 1 17:45:23 UTC** confirms **awaiting_review**, exactly
**KR**, developer allowlisting preserved, and only verification_status changed.

Runtime `afd5bab` limits new plans and deposits to KR residence and KR network
location. Prior AR/CO residence records cannot authorize new requests. Existing
balances, withdrawals, renewals, claims and submitted-transaction recovery remain
accessible outside KR. Local eligibility (11 tests), WebKit (21 checks / 31
layouts), translation, type, lint and build checks passed; independent commit
review found no actionable defect. Production `4a35244` was deployed and independently checked; actual Android
Korea-only acceptance passed. Native policy run 41329500340 passed two tests
with no failures, including all five traced Done gestures without extra clicks.
Two subsequent native fixture failures were diagnosed before the Done action.
Test-only `340fefd` corrects the fixture and query timing; final native run
41331879980 passed both tests, all five Done gesture assertions and pending
recovery. CI and independent review passed. The failure evidence and corrections
remain in KEYBOARD_DISMISSAL.md; the submission receipt is tracked in RELEASE.md.

The keyboard cause and fix remain established by the before/after native trace:
see [KEYBOARD_DISMISSAL.md](KEYBOARD_DISMISSAL.md). The previous three-country
submission receipts below are historical and no longer the active request.

## November 2 02:45 KST — Korea-only resubmission receipt

After final native, CI, independent review, production and Android checks, the
operator-authorized Korea-only request was submitted. Independent readback at
**2026-11-01T17:45:23.343Z / November 2 02:45:23 KST** confirms
**awaiting_review**, exactly **KR**, developer allowlisting true. Only
`verification_status` changed from the verified pre-submit snapshot. App and
metadata IDs are unchanged. Pre-submit main: `713fe00`; deployed source:
`4a35244`; native test source: `340fefd`.

The improvement-focused changelog describes distinct tabs, the corrected Done
interaction, precise amount/fee presentation, live rates and interrupted-request
recovery, actual Android round trips and Korea-only new-request controls. It
links the reviewer walkthrough and source/fee/test evidence. The existing
immutable-contract review request remains explicit. This is a review submission,
not TFH approval or publication. No extra real-money transaction, notification,
email or Telegram message was sent. The exact changelog and readback receipt
are retained privately outside Git.

## November 2 KST — final native fixture verification

Test source `340fefd0cb347256767e4025a32a74458a93e685` passed
[native run 41331879980](https://github.com/Daviswhistle/Inheritance/actions/runs/41331879980):
both lifecycle and pending-deposit recovery tests, zero failures. The raw event
log confirms five Done gestures with prevented touchend, zero extra clicks,
no remaining input focus and visible actions. Alignment logs record measured
pan corrections reaching the unchanged exact-overlap gate before each tap.
Production application source remains identical to deployed `4a35244`; the
follow-up changed only tests and records.

[CI 41331880094](https://github.com/Daviswhistle/Inheritance/actions/runs/41331880094)
and [documentation checkpoint CI 41332134580](https://github.com/Daviswhistle/Inheritance/actions/runs/41332134580)
passed. Independent review of the complete test delta found no remaining
actionable defect after its minimum-step finding was corrected. The two earlier
pre-action failures, raw coordinates and remediation are retained in
[KEYBOARD_DISMISSAL.md](KEYBOARD_DISMISSAL.md). They are not counted as successful
tests or hidden by a retry. No further app deployment or actual-money test was
needed for the test-only correction. The authorized Korea-only request was submitted after these checks; the
independent receipt is recorded above.

## November 2 KST — Korea-only production and device acceptance

The operator explicitly selected Korea-only launch. Runtime `afd5bab` restricts
both trusted network-country classification and per-wallet residence to KR.
Old AR/CO residence confirmations cannot authorize new vaults/deposits; existing
exits, renewals, claims and submitted-request recovery remain available. The
public Terms and English/Korean availability copy match the narrower scope.

Production source: `4a35244cf06fbad0965725446f61f2fe351137b2`.
[Deployment 41329915849](https://github.com/Daviswhistle/Inheritance/actions/runs/41329915849)
and [CI 41329915837](https://github.com/Daviswhistle/Inheritance/actions/runs/41329915837)
passed. Production HTML and all six imported assets match
https://3d748bd1.inheritance.pages.dev; all three legal documents return 200 and
Terms names KR only. Worker `f334c9a8-f718-4593-bc26-577c017ddee9` reports ready,
funded, a fresh cycle, no halt and no last error. The read-only eligibility
endpoint returns KR with no-store; spoofed AR/CO client headers/query do not
change that trusted result.

Local checks: 11 eligibility tests, nine translation tests, typecheck, lint,
build, and WebKit 21 checks / 31 layouts all passed. WebKit explicitly rejects
saved AR/CO residence and preserves receipt recovery from a removed CO location
without a duplicate deposit. Independent native commit review of `afd5bab` found
no actionable defect; it independently ran eligibility, translation, type and
changed-file lint checks. The full WebKit run was performed by the maintainer.

Native policy [run 41329500340](https://github.com/Daviswhistle/Inheritance/actions/runs/41329500340)
passed both tests with zero failures. Event-level inspection confirms five Done
gestures, each with cancelled touchend, zero extra click, no remaining input
focus and restored controls. Pending-deposit process-restart recovery passed.
This is the native WKWebView host with simulated approvals, not actual iOS
World App approval/permission validation.

Actual Samsung SM-N986N / Android 13 / World Money 4.0.4602 passed cold-start
login, existing KR recognition, Help reset, the native KR/Other selector,
Other-country blocking, continued existing Assets/withdrawal access, and
restoration of enabled amount fields after explicit KR confirmation. No funds,
notifications or external messages were sent. See
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md) for the targeted scope.

Portal readback after withdrawal/configuration confirmed unverified, exactly
KR, developer allowlisting preserved, and only description/supported_countries
changed. The previous three-country request is historical. The new submission
receipt will be added after Portal readback.

## Historical November 2 01:52 KST — corrected release, since withdrawn

The authorized corrected request was submitted after deployment, Android
acceptance and final checks. Independent Portal readback at
**2026-11-01 16:52:33.571 UTC / November 2 01:52:33 KST** confirmed
**awaiting_review**, app `app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`. Exactly KR/AR/CO and developer allowlisting
were preserved; only verification_status changed. This is a review request,
not approval or publication.

Main at submission: `e16700fca75123847487a591f21953791266e211`;
[its CI 41328325998](https://github.com/Daviswhistle/Inheritance/actions/runs/41328325998)
passed all three jobs. Deployed source `c7da250` also passed its second native
[iOS run 41327125650](https://github.com/Daviswhistle/Inheritance/actions/runs/41327125650):
two tests, zero failures, all five traced Done touches cancelled touchend and
produced zero extra clicks. The earlier passing `5209fd4` raw summary/screenshots
and this final-source event log were independently inspected by the maintainer.

The submitted changelog leads with distinct tab roles, the reproduced/fixed
keyboard issue, exact amounts and costs, live rates, interrupted-request recovery,
actual Android WLD/USDC full exits and supported-country controls. It links the
rewritten review walkthrough, release evidence and public contract/source/fee
review. The final paragraph requests review of existing immutable contracts and
states the missing pre-deployment source-sharing record without presenting it as
a reason to reject. The private receipt retains the exact submitted text. No
additional email, Telegram message, real-money transaction or notification was
sent during this correction.

## November 2 KST — corrected release deployed and checked

Production source: `c7da2501240cba4adccdb235f8609730762d9afe` (runtime fix
`aef7fe6`, test-only alignment `5209fd4`, reviewer/evidence documentation).
[Deployment 41327125672](https://github.com/Daviswhistle/Inheritance/actions/runs/41327125672)
and [CI 41327125634](https://github.com/Daviswhistle/Inheritance/actions/runs/41327125634)
passed. Production HTML and all six imported JS/CSS assets match
https://1f8e6827.inheritance.pages.dev. All three legal documents return 200;
the notification/automation Worker is ready, funded, fresh and not halted.
Worker version: `c1f273f2-c63d-466d-8c11-51fb3297e073`.

The deployed app and native-test source are identical to validated `5209fd4`;
only documentation changed after its passing native run. Its raw test summary
reports two passed, zero failed and zero skipped on iPhone 16 Pro / iOS 18.5.
The before/failure, label-overlap and restored-action screenshots were inspected.

After a full process restart, actual World Money 4.0.4602 on Samsung SM-N986N /
Android 13 passed numeric Done (0.01 draft only), background-return draft
retention and recipient Done after refocus. The Android host closes its keyboard
on backgrounding while retaining DOM focus; refocusing and Done then leaves no
input focused, closes the keyboard and restores review/navigation. Recipient
and interval remained unchanged. The test draft was discarded by closing the
Mini App and restarting World App. No wallet transaction, notification or external
message was sent. Detailed phone evidence is private; see
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).

The rewritten [reviewer walkthrough](REVIEW_NOTES.md) leads with the design/UX
improvements and concrete checks. Contract/source/fee information and native-host
scope are stated once in their relevant sections. The verified
[keyboard diagnosis](KEYBOARD_DISMISSAL.md) replaces the earlier unexplained-pass
readiness judgment. Portal scope remains KR/AR/CO; the verified submission receipt is recorded above.

## November 2 KST — corrected source validation

Runtime correction: `aef7fe6cf23508985e6ef86a8b1e38799782dd0c`; test arrangement:
`5209fd488cae36eaafbb0f76642e39df472fe2cc`.
[CI 41325955121](https://github.com/Daviswhistle/Inheritance/actions/runs/41325955121)
and [native iOS 41325954954](https://github.com/Daviswhistle/Inheritance/actions/runs/41325954954)
passed. The unchanged-runtime cause-specific reproduction
[41325963205](https://github.com/Daviswhistle/Inheritance/actions/runs/41325963205)
failed on the original period-focus/review-hidden symptom. The fixed run passed
both native tests and all five traced Done gestures cancelled touchend with zero
extra clicks. Typecheck/lint/build, WebKit 19 checks/31 layouts and native
build-for-testing passed. Independent native commit review of `aef7fe6` found no
actionable findings and independently reran WebKit checks. No transaction logic,
contract, country policy or fee changed. Deployment readback follows below when
complete; these source checks alone do not claim a new production version.

## Historical November 2 request — subsequently withdrawn

Runtime: `b7d5a1d8dd383ca2a86349684a7b72a0a833c7fd`.
[CI 41318884336](https://github.com/Daviswhistle/Inheritance/actions/runs/41318884336)
and [deployment 41318884309](https://github.com/Daviswhistle/Inheritance/actions/runs/41318884309)
passed. Production HTML and all six imported JS/CSS files match
https://44791c55.inheritance.pages.dev; three legal documents return 200, and the
Worker is ready, funded, fresh and not halted. `/api/eligibility` returns KR with
`Cache-Control: no-store`; forged client country headers/query do not override it.

Independent reviews of `fcd9627` and `b7d5a1d` found no actionable defect. The
first CI run caught a new message bypassing the common error sanitizer; the
follow-up uses that path and preserves all four availability messages exactly.
The 66 error-message checks and 10 eligibility checks passed.

Actual Android regional-access acceptance passed on Samsung SM-N986N / Android 13
/ World Money 4.0.4602; see [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).
No new funds, notification, support email or Telegram message was used. A Portal
availability-description update was independently read back; only description
changed, with KR/AR/CO and unverified status preserved.

[Runtime iOS 41318884346](https://github.com/Daviswhistle/Inheritance/actions/runs/41318884346)
passed two tests with zero failures/skips on iPhone 16 Pro / iOS 18.5 Simulator.
Raw summary and restored-keyboard/recovered-deposit screenshots were inspected.
The preceding run failed once on foreground/Done, with focus moving to the period
input. Test-host-only `dcec319` added event tracing and three repeated foreground
cycles. [Repeated native run 41320004172](https://github.com/Daviswhistle/Inheritance/actions/runs/41320004172)
and [CI 41320004149](https://github.com/Daviswhistle/Inheritance/actions/runs/41320004149)
passed. Both native tests passed; every traced Done tap reached the real button,
blurred the input, closed the keyboard and restored actions. The prior single
failure did not recur in either subsequent execution. Its cause is unconfirmed;
no runtime keyboard fix is claimed. Retained event tracing and repeated coverage
make any recurrence diagnosable. This is a bounded acceptance judgment, not a
claim of exhaustive reliability or actual World App iOS native-screen coverage.

After preparation, the authorized Portal request was submitted and independently
read back at **2026-11-01 15:23:28 UTC / November 2 00:23:28 KST** as
**awaiting_review**, metadata `meta_9cf3b324ec9a1838a56c5b6d98be8674`, for app
`app_28c40a2a42b7f6c95789c2d5231b1314`. KR/AR/CO and developer allowlisting remained
unchanged; only verification_status changed after submission. The changelog asks
TFH to review the existing immutable contracts and service fee, discloses the
missing pre-deployment sharing record, and requests a separate intake/remediation
route if required. Submission is not approval, publication or TFH acceptance.

## November 1 — territorial new-request controls (local verification)

New vaults and deposits now require a fresh trusted edge-country result and
explicit per-wallet residence confirmation in KR/AR/CO. Unknown/outage cases
block new requests; direct contract calls remain permissionless. Existing
withdrawals, renewals, claims and prior transaction recovery are preserved.
Residence is initially blank, includes an unsupported-country choice, and can be
changed from Help. Location checks time out and cancel on page exit.

Local verification passed: typecheck, lint, production build, Pages Functions
bundle, 10 eligibility tests, 12 mobile units, CSS consistency and 9 locale tests.
The real-SDK/disposable-chain product suite passed 68 Chromium layouts, including
stale-allow creation/top-up blocking, retry, existing withdrawals and check-ins.
WebKit passed 31 layouts and interrupted-deposit recovery from an unsupported
location without a second transaction. Its intentional offline/navigation tests
record the narrowly matched WebKit resource-cancellation diagnostics separately;
all other page errors remain failures. These are local fixtures, not geographic
field tests or real World App iOS approval screens.

No contract code changed. A live World Chain code-hash readback of the two current
income factories and gas-funding contract matched the prior verification. No new
money or notification was used. The user declined another TFH email and instructed
us to finish preparation, then submit with existing-source/fee review requested
through the official Portal. Deployment, current-source native iOS CI, physical
Android eligibility recheck and the submission receipt must be recorded before
claiming those subsequent steps completed.

## November 1 — completed candidate review and verified KR/AR/CO draft

The follow-up assessment added Colombia. The UIAF territorial reporting guidance
and SFC's current service/token interpretations were applied to the Korean
operator, separate owner vaults, external strategy and service fee. This is a
reasoned release decision, not official clearance. The previously unfinished
candidate table now records specific product-to-rule judgments, favorable
arguments and limits in [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md).

Australia's favorable Access precedent and AUSTRAC territorial rule were
considered, but the actual arbitrary-recipient withdrawal functions and core
heir-payment purpose prevent assuming the single-payee/incidental exceptions.
Mauritius's current consolidated Act supplied the previously missing August 2026
solicitation restriction. No country was excluded solely because it has a VASP
regime. No universal regulator-letter prerequisite was added.

A country-only Portal patch added CO to KR/AR; a separate `get_app_config`
readback confirmed KR/AR/CO, **unverified**, and no other returned metadata field
change. Runtime remains `8cf03afa7fea797ff651190bc64a659449b5ba2b`. No runtime
deployment, transaction, external inquiry or resubmission occurred. Territorial
new-deposit controls and the TFH existing-contract route remain separate release
work. The previous KR/AR section below is a historical snapshot.

## November 1 — country review and verified KR/AR draft

The country review selected South Korea and Argentina on the documented
no-control software-service interpretation. It assessed the full fixed Morpho,
realized-gain fee and permissionless funded execution structure, not only wallet
key custody. No official project-specific clearance or global legal opinion is
claimed. The earlier requirement to keep the Korean question open awaiting an
FIU answer is superseded; no inquiry was sent.

Portal `supported_countries` changed from KR/US/CA/AU/JP to KR/AR. A separate
`get_app_config` readback confirmed exactly that list, **unverified** status and
no other metadata field change. No submission occurred. Peru/Panama and the
other reviewed markets have their positive evidence and specific unresolved
boundaries recorded in [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md). The document also
separates framework screening from unassessed countries and corrects reliance
on outdated Costa Rica/Guatemala “no regulation” summaries.

This revision changes documentation and the Portal draft only. Runtime remains
`8cf03afa7fea797ff651190bc64a659449b5ba2b`; no new transaction or outreach was
performed. Store selection is not runtime geoblocking. Territorial onboarding/
new-deposit controls must be verified before claiming a restricted launch,
without blocking existing-holder fund access. The separate TFH existing-contract
review issue remains open. Historical sections below describe older snapshots.

## November 1 — USDC round trip, verified iOS host and launch-scope narrowing

Runtime `8cf03afa7fea797ff651190bc64a659449b5ba2b` changes only English/Korean
wallet-held-share fee wording. These shares can originate outside Inheritance,
so the screen no longer claims its service fee was previously paid. Redemption
charges no Inheritance service fee; a network fee may apply. No transaction,
contract, strategy or fee-rate logic changed. Typecheck, lint and build passed.
[CI 41301624915](https://github.com/Daviswhistle/Inheritance/actions/runs/41301624915)
and [deployment 41301624928](https://github.com/Daviswhistle/Inheritance/actions/runs/41301624928)
passed. Production HTML and all six imported JS/CSS files matched
https://a8cb5626.inheritance.pages.dev; three legal documents returned 200 and
Worker automation was ready, funded, fresh and not halted. Worker version:
`5393bb30-8b32-48ad-8dc2-e4d50715f329`.

The user funded USDC and approved one 0.01 USDC deposit/full-withdrawal with
combined network costs capped at 0.15 WLD. Actual World Money 4.0.4602 on Samsung
SM-S911N / Android 16 completed deposit, close/reopen restoration and All
withdrawal using `ff66905`. Both canonical receipts succeeded. Principal returned
in full; cash, strategy shares, gross/net assets and cost basis are zero and
hasAssets=false. Quote: 0.11 WLD. Actual combined WLD cost:
0.071165159939716087; withdrawal added no WLD cost. Unrelated wallet-held strategy
shares and native ETH balance were unchanged. No heir transaction or message
was made.

[Native iOS run 41299595716](https://github.com/Daviswhistle/Inheritance/actions/runs/41299595716)
for the same `ff66905` logic passed on iPhone 16 Pro / iOS 18.5 Simulator: two
tests, zero failures and skips. Downloaded raw result summary and exported
screenshots were inspected. This is the owned WKWebView/MiniKit test host with
fixture funds and simulated approvals, not the actual World Money iOS app.
The copy-only commit triggered another native host run; its result is tracked
separately and no pass is inferred from the earlier run.

Portal draft readback remains **unverified**. GB and SG were removed from country
selection; KR/US/CA/AU/JP remain unapproved candidates, not legal-clearance
claims. The current Android/iOS evidence replaced stale residual-withdrawal
wording in the draft. No review request was submitted. Existing rejection
feedback concerned UI/UX and tab distinction, not a contract/country rejection.
TFH's October 25 email has no reply in the November 1 readback. The official
post-rejection contact route was identified, but the prepared Telegram message
was not authorized or sent. See [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) for the bounded
country assessment and the remaining Korean operator-activity question.

## November 1 — Android full exit and bounded discovery reads

Runtime source: `ff669056266b6a657f06aab6d9f8c39a9120ab74`, a descendant of
`91944cc`. [Deployment 41299595719](https://github.com/Daviswhistle/Inheritance/actions/runs/41299595719)
and [CI 41299595762](https://github.com/Daviswhistle/Inheritance/actions/runs/41299595762)
passed. Production https://inheritance.pages.dev matched the HTML and all six
imported JS/CSS assets at https://53df9d87.inheritance.pages.dev. Three legal
pages returned 200; the Worker reported ready, funded, fresh and not halted.
Worker version: `63fa351f-f5e6-49c6-b58c-328a87a0d288`.

On Samsung SM-S911N / Android 16 / World Money 4.0.4602, the fixed All action
recovered the prior `2923` wei WLD residual. Canonical receipt/post-state prove
zero idle assets, strategy shares and cost basis, `hasAssets=false`, and zero
owner WLD debit for this withdrawal. The wallet received the full residual.
This financial check ran on `3e67501` before the new read-only lookup changes.
Native notification cancellation/re-grant, keyboard Done, OS background draft
retention, insufficient-USDC-balance blocking and contact cancellation/manual
recovery also passed. No extra test notification or invitation was sent.

The phone exposed a public-RPC throughput error from eager creation metadata
and parallel per-factory recent-event scans. Factory addresses now share one
bounded event query per block chunk. Optional creation metadata is read only
when account details open, scoped to the selected vault and isolated from global
transaction status. A confirmed unsupported factory is excluded; other identity
or read failures still produce an incomplete result. The 90-block chunk and
1800-block lookback remain; registered/remembered plans and shared links still
support older positions.

Typecheck, lint, production build, 12 mobile unit checks and 10 local-chain
browser discovery/metadata scenarios passed. The latter cover a primary indexed
vault, an event-only legacy vault, unsupported factories, partial/all read
outages, retry recovery, lazy metadata and failure isolation. Independent
commit review of the complete `ff66905` found no actionable defect and separately
repeated these focused checks. After deployment, actual Android sign-in restored
the empty WLD position, and Home/Plan/Assets/account details were observed without
the previous raw metadata error or incomplete-search warning.

The user explicitly deferred live USDC transactions; no existing USDC receipt
shares were redeemed. Actual beneficiary claim through final receipt remains
unverified and requires a willing heir account plus the real on-chain deadlines.
The earlier iOS native-host results do not prove the actual World Money iOS app.
TFH procedure/country decisions remain open; no resubmission or new outreach
occurred in this follow-up. Full device scope is in
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).

## October 28 withdrawal and substantive readiness work

The operator withdrew the October 28 review request after the technical release.
A separate Portal readback confirmed `unverified` for app
`app_28c40a2a42b7f6c95789c2d5231b1314`. The earlier `awaiting_review` receipt below
records that submission at the time; it is no longer current. Production remains
on `3e675010e5c0e5641a2b433a01e76f5cfec2e529`; no new contract or funds transaction
was made for this follow-up.

The user explicitly requires resolving the TFH procedure, defensible launch
countries and appropriate iOS validation before resubmission. Merely
reporting unresolved issues in a changelog does not satisfy this project gate.
The public World Money compatibility listing shows iPhone and Apple Vision, with
no Mac entry. This M4 Mac's App Store offered no verified World Money install;
iPhone Mirroring could not connect to an iPhone. Xcode's same-machine iPhone
records matched local simulators. Our native host results remain valid for
those hosts and do not establish actual World App iOS acceptance.

The existing native iOS Simulator results plus actual Android World App evidence
are accepted for this engineering stage; lack of a physical iPhone alone does
not block submission. Real iOS World App approval/permission UI remains an
explicit evidence limit.

A TFH follow-up and Korean classification inquiry were prepared, neither sent
nor submitted. A formal government inquiry is optional and held while current
statutes are mapped to the actual service; it is not a universal preclearance
requirement. Current authority and next steps are in
[MAC_HANDOFF.md](MAC_HANDOFF.md); country evidence is in
[LAUNCH_SCOPE.md](LAUNCH_SCOPE.md).

A bounded history check found contract deployment records from September 26,
the repository URL in a tracked Privacy file by October 2, and a saved Portal
submission receipt on October 5. Neither the searched Git records nor the bounded 2026 project-mail searches
in the two connected Gmail accounts provided direct pre-deployment TFH sharing
evidence.
This is an unverified historical fact, not proof that communication never
occurred. The appropriate existing-contract review path remains a focused TFH
question rather than a claim that a policy breach has been adjudicated.

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
- [iOS native host 40629700598](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700598): passed on iPhone 16 Pro / iOS 18.5 Simulator: two XCTest methods, zero failures or skips; raw summary and portrait/landscape/recovered-deposit captures independently inspected.
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
Portal descriptions/captures were updated and read back. The app was resubmitted
October 28; an independent readback at 04:09 UTC (13:09 KST) confirmed
`awaiting_review` for metadata `meta_9cf3b324ec9a1838a56c5b6d98be8674`. Developer
listing remained enabled; countries and other metadata were unchanged. The
submitted changelog explicitly disclosed the historical source-sharing gap,
unresolved jurisdiction classification, lack of an independent audit and the
physical-iPhone evidence boundary. Review acceptance and legal clearance are
not claimed. See [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md)
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
