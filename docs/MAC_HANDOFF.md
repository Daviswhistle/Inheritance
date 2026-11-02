# Mac continuation — 2026-11-02

## Objective and authority

Complete World App guideline remediation, actual-device validation, necessary
fixes/deployment and resubmission when ready. The user withdrew the earlier
submission and authorized these actions. Push and deployment are authorized.
They explicitly resumed work October 28 after the October 27 pause. After the
subsequent submission, the user rejected treating disclosed gaps as readiness,
withdrew the request, and instructed us to resolve TFH review procedure, a
defensible country scope and iOS validation before resubmitting. The engineering
assessment accepts the existing native iOS Simulator plus actual Android World
App evidence; absence of a physical iPhone alone is not a submission blocker.

ADB inspection/tap/input on the connected Android phone is authorized. Stop
captures during secret entry. The user subsequently authorized the agent to
handle authentication/confirmation steps; human input is still required for
biometrics or an unavailable device PIN. This does not expand spending authority.
One 0.01 WLD deposit/withdrawal test and its necessary costs were approved; this
is not permission to spend unrelated funds.
November 1 authority covers autonomous Android verification; only additional
funding transactions need an amount approval. The user initially deferred USDC, then approved 0.01 USDC and at most 0.15 WLD
combined network costs. The completed round trip cost 0.071165159939716087 WLD;
that approval is for this completed test, not unrelated future spending. The previous residual was recovered without an owner network fee.
Exactly one approved self-notification has already been used. Do not send another
notification, contact message, invitation or external inquiry without authority.

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

## Current verified checkpoint

- Runtime source: `fd162062d79b2f2af52bff98ff017af6dfbbb44a`, descendant of requested baseline `91944cc`.
  Main is the continuation branch. See [RELEASE.md](RELEASE.md) for current CI,
  deployment, native-test and independent-review receipts.
- Production: https://inheritance.pages.dev ; immutable: https://e52ac60c.inheritance.pages.dev.
  Deployment [41395540398](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540398): passed for this runtime; Pages and notification Worker deployed successfully.
  CI [41395540405](https://github.com/Daviswhistle/Inheritance/actions/runs/41395540405): passed, all three jobs successful.
  Readback: November 2 KST readback passed: production HTML and all six imported JS/CSS files match the immutable deployment; three legal documents return 200; the Worker reports ready, funded and a fresh cycle with no halt or last error.
- Financial UI separates dated lending/reward rates, live strategy fee, service
  fee and conditional WLD network costs. Review shows per-token deposit amounts
  plus the conditional fee as total-debit components; the SDK does not expose an
  exact preapproval network quote to this mini app. Quote and settled debit differ.
- Earlier validation: November 1 discovery/metadata browser scenarios passed 10 checks; typecheck/lint/build and 12 mobile units passed. Independent commit review of `ff66905` found no actionable defect. The preceding runtime consolidated factory event scans and deferred optional metadata until details open; actual Android Home/Plan/Assets/details reopened without the earlier RPC warnings.
  Earlier full-withdrawal validation: the complete local-chain browser suite passed 92 checks, including refreshed/full/partial withdrawal, identity outage recovery, idle USDC plus WLD exit, and WLD arriving during approval. Separate automated code review: completed against the complete final commit with no actionable findings; its focused checks covered seven withdrawal scenarios and keyboard closing/recovery.
  Logic-source iOS (`ff66905`): [41299595716](https://github.com/Daviswhistle/Inheritance/actions/runs/41299595716) — passed on iPhone 16 Pro / iOS 18.5 Simulator: two tests, zero failures and skips; exported screenshots and raw summary independently inspected.
- Physical Android: Samsung SM-S911N / Android 16 / World Money 4.0.4602 on November 1 (4.0.4401 for October tests).
  Login cancel/retry/success, keyboard Done, legal title, contact cancellation,
  manual recovery/selection, notification status, one received self-notification,
  deposit cancellation, real deposit, close/reopen and principal withdrawal passed
  for the specifically recorded versions. See [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).
- Real-money test used `e4be10c`. Deposit principal 0.01 WLD; quoted network fee
  0.098 WLD. Actual net network fee 0.063726535762749712 WLD; actual deposit debit
  0.073726535762749712 WLD after the unused reserve was refunded. Withdrawal
  returned 0.010000000000056801 WLD with zero owner WLD network fee.
- The original live All action left 2923 token wei after a quote-refresh race.
  On November 1 the fixed All action recovered the remaining 2923 wei. The
  canonical receipt and post-state confirm zero idle/shares/assets/cost basis,
  hasAssets=false, and zero owner WLD fee. Close/reopen restored the empty
  position. No unrelated wallet-held USDC shares were used.
- November 1 also exercised native notification re-grant: cancel/off, retry,
  activate/on. No additional notification was sent. Keyboard Done, background
  draft retention, insufficient-USDC-balance blocking and contact-cancel manual
  recovery passed on the updated World Money host.
- Subsequent live USDC test: 0.01 USDC deposited, restored after close/reopen and
  fully withdrawn; canonical zero cash/shares/assets/cost basis, hasAssets=false.
  Quote 0.11 WLD; actual combined network cost 0.071165159939716087 WLD, with no
  extra withdrawal debit. Existing wallet shares and native ETH were unchanged.
  Actual beneficiary claim to receipt still needs a willing heir and real deadlines.
  Do not label Android as exhaustive.
- `8cf03af` only corrects English/Korean wallet-share fee wording: the screen also
  shows externally obtained shares, so it cannot claim a prior inheritance fee was
  paid. Typecheck/lint/build and CI passed; transaction logic is unchanged.
- Private phone/transaction/contact evidence stays outside Git. Do not publish
  tester-linked addresses, transaction linkage or screenshots in public docs.

## Historical November 2 submission — subsequently withdrawn

Regional controls are deployed and production readback passed. The actual
Samsung SM-N986N / Android 13 / World Money 4.0.4602 passed residence blank,
unsupported-country choice, explicit KR confirmation, Help reset, close/reopen
persistence and blocked/unblocked top-up controls; no new money or notification
was used. The Portal description now explains the controls; an independent
readback confirmed only description changed and KR/AR/CO remains unverified.

Runtime iOS run [41318884346](https://github.com/Daviswhistle/Inheritance/actions/runs/41318884346)
passed two tests with zero failures/skips; raw summary and screenshots were read.
The preceding run failed once after foreground/Done moved focus to the period
field. Test-host-only `dcec319` added event tracing and three repeated foreground/
dismissal cycles. Native run 41320004172 and CI 41320004149 passed. All traced Done
taps reached the button and restored controls. The original failure did not recur
in two subsequent executions; its cause remains unconfirmed, and no runtime
keyboard fix is claimed. That earlier readiness judgment was rejected; the cause-specific reproduction
and correction above supersede it. See RELEASE.md for the exact evidence boundaries.

The authorized resubmission is complete. Independent Portal readback at
2026-11-01 15:23:28 UTC / November 2 00:23:28 KST confirmed **awaiting_review**,
metadata `meta_9cf3b324ec9a1838a56c5b6d98be8674`, KR/AR/CO unchanged and developer
allowlisting preserved. Only verification_status changed after submission.
The submitted changelog requests review of existing contracts and the service fee,
reports the pre-deployment sharing gap and asks for a separate intake if required.
Do not resubmit again or send an inquiry automatically; the next step is the
actual review outcome. No additional money, notification or email was used.

## External decisions still open

Portal app `app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, is now configured for **KR only**.
Earlier KR/AR/CO requests were withdrawn. Use the current release section and
[RELEASE.md](RELEASE.md) for the latest verified submission status.

The operator is an individual in Korea and explicitly selected Korea-only launch
on November 2, superseding the earlier maximum-country instruction.
There is no historical pre-deployment TFH source-sharing or legal-review record.
One approved source-review/remediation inquiry was sent to TFH October 25 at
15:33 KST. The sent thread was rechecked November 1 with no reply or decision. Earlier
related-inbox checks also found no decision. The Korean classification inquiry remains unsent. Do not duplicate
messages or treat a sent email as TFH acceptance. [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md)
records the Korea-only decision and the previous candidate assessment, including specific
reasons other markets were not added. The Korean no-reporting software-service
interpretation is now the operational basis; an FIU reply is not a prerequisite.
Do not invent a universal paid legal report, incorporation, audit or device-certificate rule. A disclosed review request does
not establish legal clearance or TFH acceptance of the historical sharing gap.

## Readiness criteria applied to this resubmission

This is the user's project-specific readiness requirement, not a claim that the
Portal imposes a universal legal certificate or physical-device attachment.
Do not resubmit merely by listing these gaps in a changelog. The original review
rejection concerned UI/UX and tab distinction, not contracts or countries; do not
conflate it with our separate compliance findings. The official Portal is the
submission route; @MateoSauton is an official post-rejection contact, not a newly
invented mandatory preapproval. A prepared Telegram message remains unsent after
the user corrected the rejection premise instead of authorizing it.

1. The latest November 1 instruction is to finish preparation and then submit,
   requesting review of the existing public source and fees through the official
   Portal. The user explicitly declined another support email. Include the
   unverified pre-deployment sharing history and ask for any required separate
   intake/remediation step. This authorizes requesting review; it does not
   establish TFH acceptance or retroactively satisfy source sharing.
2. KR only is the authorized initial scope. The official UI checks trusted KR
   edge country and explicit KR residence confirmation before new vaults and
   deposits, including retries and top-ups. Unknown/outage cases fail closed.
   Preserve withdrawals, renewals, settings, existing claims and receipt recovery.
   Verify runtime deployment/readback and device results before submitting.
3. Retain the verified iOS evidence and its scope: the actual WebKit/MiniKit
   native-host tests passed on local iOS 27.0 and final-source CI iOS 18.5; actual
   Android World App testing covered native flows and the principal round trip.
   The simulator host models approval callbacks; it does not establish the real
   World App iOS approval/permission screens. Physical iPhone testing is useful
   additional evidence, not an invented universal prerequisite. The user has no
   available iPhone; do not block only on that fact or repeatedly request one.

A TFH follow-up and Korean classification inquiry were prepared but not sent.
The government inquiry is optional and currently held, not a required launch
process. First apply current legal definitions to the actual service and narrow
any remaining decision-changing question. A separate outbound approval is still
needed before sending a new email, contact message or government inquiry; the original TFH
permission covered one send. No new funds transaction or paid service was used.

Read [RELEASE.md](RELEASE.md), [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md),
[GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md), [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) and
[REVIEW_NOTES.md](REVIEW_NOTES.md). Recheck current state before acting. Resubmission
is authorized only after the substantive readiness work is complete.

This Mac has Xcode 27.1; select it per command with DEVELOPER_DIR rather than
changing the global developer directory. Local native hosts use real MiniKit
transport, fixture funds and simulated approvals. Keep that evidence separate
from actual World App iOS testing.
