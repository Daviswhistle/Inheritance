# Mac continuation — 2026-10-28

## Objective and authority

Complete World App guideline remediation, actual-device validation, necessary
fixes/deployment and resubmission when ready. The user withdrew the earlier
submission and authorized these actions. Push and deployment are authorized.
They explicitly resumed work October 28 after the October 27 pause.

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
  iOS: [40629700598](https://github.com/Daviswhistle/Inheritance/actions/runs/40629700598) — in progress; final-source native results are not yet established.
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
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, was read back as `unverified` October 28 before resubmission.
Earlier `awaiting_review` receipts are historical. Hero/showcase captures and
review descriptions were updated and independently read back; allowlists,
notification restrictions and KR/US/GB/CA/AU/JP/SG were preserved.

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

## Next action

Read [RELEASE.md](RELEASE.md), [WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md),
[GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md), [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md) and
[REVIEW_NOTES.md](REVIEW_NOTES.md). Recheck live state before changing it. Submit the verified app with the
historical source-sharing gap and unresolved jurisdiction classification clearly
disclosed, then confirm Portal state. A TFH reply or universal legal certificate
is not an invented prerequisite to requesting review. Resubmission is already
authorized; no repeat approval is needed within this scope.

This Mac now has Xcode 27.1; select it per command with DEVELOPER_DIR rather than
changing the global developer directory. iOS 27.0 supports the standard iPhone
models; the installed 27.1 runtime is Duo-only. Native test hosts use real MiniKit
transport and fixture funds with simulated approvals. They do not establish
physical iPhone World App acceptance. Earlier PC/emulator installation failures
are historical; use the connected Android phone for actual-host work.
