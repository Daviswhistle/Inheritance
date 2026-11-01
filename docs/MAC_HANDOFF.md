# Mac continuation — 2026-11-01

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

## Current verified checkpoint

- Runtime source: `8cf03afa7fea797ff651190bc64a659449b5ba2b`, descendant of requested baseline `91944cc`.
  Main is the continuation branch. See [RELEASE.md](RELEASE.md) for current CI,
  deployment, native-test and independent-review receipts.
- Production: https://inheritance.pages.dev ; immutable: https://a8cb5626.inheritance.pages.dev.
  Deployment [41301624928](https://github.com/Daviswhistle/Inheritance/actions/runs/41301624928): passed for this runtime; Pages and notification Worker deployed successfully.
  CI [41301624915](https://github.com/Daviswhistle/Inheritance/actions/runs/41301624915): passed, all three jobs successful.
  Readback: November 1 readback passed: production HTML and all six imported JS/CSS files match the immutable deployment; three legal documents return 200; the Worker reports ready, funded and a fresh cycle with no halt or last error.
- Financial UI separates dated lending/reward rates, live strategy fee, service
  fee and conditional WLD network costs. Review shows per-token deposit amounts
  plus the conditional fee as total-debit components; the SDK does not expose an
  exact preapproval network quote to this mini app. Quote and settled debit differ.
- Current validation: November 1 discovery/metadata browser scenarios passed 10 checks; typecheck/lint/build and 12 mobile units passed. Independent commit review of `ff66905` found no actionable defect. The preceding runtime consolidated factory event scans and deferred optional metadata until details open; actual Android Home/Plan/Assets/details reopened without the earlier RPC warnings.
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

## External decisions still open

Portal app `app_28c40a2a42b7f6c95789c2d5231b1314`, metadata
`meta_9cf3b324ec9a1838a56c5b6d98be8674`, was independently read back on
November 1 as **unverified after the user withdrew that submission**. GB/SG were
removed from the draft and device evidence was updated; no resubmission occurred.
The earlier 04:09 UTC / 13:09 KST `awaiting_review` receipt is historical, not the
current state. The later November 1 country review changed the draft to **KR/AR/CO**
and independently verified that only supported countries changed. These are the
reasoned intended launch markets, not regulator approvals or publication.
Production runtime and existing-holder access are unchanged.

The operator is an individual in Korea and wants maximum lawful availability.
There is no historical pre-deployment TFH source-sharing or legal-review record.
One approved source-review/remediation inquiry was sent to TFH October 25 at
15:33 KST. The sent thread was rechecked November 1 with no reply or decision. Earlier
related-inbox checks also found no decision. The Korean classification inquiry remains unsent. Do not duplicate
messages or treat a sent email as TFH acceptance. [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md)
records the KR/AR/CO decision and the completed candidate release assessment, including specific
reasons other markets were not added. The Korean no-reporting software-service
interpretation is now the operational basis; an FIU reply is not a prerequisite.
Do not invent a universal paid legal report, incorporation, audit or device-certificate rule. A disclosed review request does
not establish legal clearance or TFH acceptance of the historical sharing gap.

## Required before another submission

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
2. KR/AR/CO remains the reasoned country scope. The official UI now checks trusted
   edge country and explicit local residence confirmation before new vaults and
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
