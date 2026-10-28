# Mac continuation — 2026-10-28

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
Exactly one approved self-notification has already been used. Do not send another
notification, contact message, invitation or external inquiry without authority.

## Current verified checkpoint

- Runtime source: `3e675010e5c0e5641a2b433a01e76f5cfec2e529`, descendant of requested baseline `91944cc`.
  Main is the continuation branch. See [RELEASE.md](RELEASE.md) for current CI,
  deployment, native-test and independent-review receipts.
- Production: https://inheritance.pages.dev ; immutable: https://6fff670a.inheritance.pages.dev.
  Deployment [40629700530](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700530): passed for this runtime; Pages and notification Worker deployed successfully.
  CI [40629700573](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700573): passed, all three jobs successful.
  Readback: October 28 readback passed: production HTML and all six imported JS/CSS files match the immutable deployment; three legal documents return 200; the Worker reports ready, funded and a fresh cycle with no halt or last error.
- Financial UI separates dated lending/reward rates, live strategy fee, service
  fee and conditional WLD network costs. Review shows per-token deposit amounts
  plus the conditional fee as total-debit components; the SDK does not expose an
  exact preapproval network quote to this mini app. Quote and settled debit differ.
- Current validation: the complete local-chain browser suite passed 92 checks, including refreshed/full/partial withdrawal, identity outage recovery, idle USDC plus WLD exit, and WLD arriving during approval. Separate automated code review: completed against the complete final commit with no actionable findings; its focused checks covered seven withdrawal scenarios and keyboard closing/recovery.
  iOS: [40629700598](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700598) — passed on iPhone 16 Pro / iOS 18.5 Simulator: two tests, zero failures and skips; exported screenshots and raw summary independently inspected.
- Physical Android: Samsung SM-S911N / Android 16 / World Money 4.0.4401.
  Login cancel/retry/success, keyboard Done, legal title, contact cancellation,
  manual recovery/selection, notification status, one received self-notification,
  deposit cancellation, real deposit, close/reopen and principal withdrawal passed
  for the specifically recorded versions. See [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).
- Real-money test used `e4be10c`. Deposit principal 0.01 WLD; quoted network fee
  0.098 WLD. Actual net network fee 0.063726535762749712 WLD; actual deposit debit
  0.073726535762749712 WLD after the unused reserve was refunded. Withdrawal
  returned 0.010000000000056801 WLD with zero owner WLD network fee.
- The original live All action left 2923 token wei after a quote-refresh race.
  The follow-up fix preserves explicit All intent, reads fresh output protection,
  and retains manually entered partial withdrawals. Fixture evidence is separate
  from the real receipt. Do not claim the live vault was emptied unless a later
  canonical receipt establishes it. No unrelated wallet-held USDC shares were used.
- Private phone/transaction/contact evidence stays outside Git. Do not publish
  tester-linked addresses, transaction linkage or screenshots in public docs.

## External decisions still open

Portal app `app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, is **unverified after the user withdrew
the October 28 submission**. This was independently read back from the Portal.
The earlier 04:09 UTC / 13:09 KST `awaiting_review` receipt is historical, not the
current state. Countries remain KR/US/GB/CA/AU/JP/SG as draft settings, not a
cleared launch scope. Production runtime and existing-holder access are unchanged.

The operator is an individual in Korea and wants maximum lawful availability.
There is no historical pre-deployment TFH source-sharing or legal-review record.
One approved source-review/remediation inquiry was sent to TFH October 25 at
15:33 KST. The sent thread was rechecked October 28 with no reply or decision. Earlier
related-inbox checks also found no decision. The Korean classification inquiry remains unsent. Do not duplicate
messages or treat a sent email as TFH acceptance. [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md)
records specific lending/fee/relay and financial-promotion questions. Do not invent
a universal paid legal report, incorporation, audit or device-certificate rule;
do not declare all seven countries cleared. A disclosed review request does
not establish legal clearance or TFH acceptance of the historical sharing gap.

## Required before another submission

This is the user's project-specific readiness requirement, not a claim that the
Portal imposes a universal legal certificate or physical-device attachment.
Do not resubmit merely by listing these gaps in a changelog.

1. Obtain the actual TFH review/remediation route for the existing immutable
   contracts and satisfy the case-specific steps. Public source and the sent
   October 25 inquiry do not retroactively prove pre-deployment sharing.
2. Justify a concrete launch scope against the actual Morpho/fee/relay activity.
   Start with the concrete Korean transfer-business question about the
   operator-funded permissionless relay; do not equate lack of an official
   opinion with illegality. The current UK promotion route is not established. Changing store countries alone does not restrict the public
   site, and any required controls must preserve existing holders' fund access.
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
needed before sending a new message or government inquiry; the original TFH
permission covered one send. No new funds transaction or paid service was used.

Read [RELEASE.md](RELEASE.md), [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md),
[GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md), [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) and
[REVIEW_NOTES.md](REVIEW_NOTES.md). Recheck current state before acting. Resubmission
is authorized only after the substantive readiness work is complete.

This Mac has Xcode 27.1; select it per command with DEVELOPER_DIR rather than
changing the global developer directory. Local native hosts use real MiniKit
transport, fixture funds and simulated approvals. Keep that evidence separate
from actual World App iOS testing.
