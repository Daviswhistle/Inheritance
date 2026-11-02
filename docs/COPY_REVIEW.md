# Whole-app copy review — November 2, 2026

## November 3 — integrate the revised design and verify the whole flow

The operator supplied additional Gemini edits after rejecting the earlier copy.
The blue/white visual system, larger review amounts, section hierarchy, fixed
primary actions, legal-page style and fee/help headings are retained.

Changes made while reviewing the actual rendered flows:
- General transfer guide: explain renewal, recipient claim and the seven-day
  wait. Remove the defensive death disclaimer from this guide. Keep the
  consequence of a missed deadline while alive on the deposit review and in
  the legal terms.
- Avoid promising automatic payment exactly seven days later, unconditional
  withdrawal, real-time data or safe custody. Keep the practical action and
  the actual condition where each decision is made.
- Receipt and pending states: mixed asset states use a neutral inheritance
  heading and asset-specific receipt status. A completed deposit is described
  as retained, without a safety guarantee.
- Transient feedback: preserve errors through success bursts, deduplicate and
  retain the two-message bound. A regression test covers the competing events.

The final source is `9e6857a`. Browser/mobile-host test receipts are recorded in
RELEASE.md. They verify layout and behavior, not first-time human comprehension.
No submission is authorized by this review.


Submission remains stopped at the operator's request. This is a product copy and
presentation review, not a recruited usability study or a claim of perfection.

## Follow-up after the operator rejected the copy

The first pass below did not explain the main action well enough. In particular,
“정한 주기마다 정기 확인” repeated an internal feature name without explaining
its purpose. Passing layout and translation tests did not validate that wording.

The Korean interface now calls the action **기한 연장하기**. Its explanation is
consistent across first use, setup, Home, owner settings, recipient states,
notifications, errors and legal reading:

- Choose the recipient, amount and period. With 30 days selected, extend within
  30 days; each approved extension starts a fresh 30 days from approval, rather
  than adding 30 days to the old deadline.
- The funded Home leads with the actual month/day and retains the precise local
  date, time and zone underneath. The button names the action's result.
- If the deadline passes, the recipient may request the assets. Payment is
  eligible only after seven days from that request. The owner can cancel the
  request by extending **until actual payment**, including after the wait ends.
- Setup review says **이 금액 맡기기**, with the next wallet approval explained
  beside it. The initial empty amount prompt asks for an amount instead of
  describing a numeric validation constraint before the user starts typing.
- Empty savings, separate wallet investments, withdrawal, owner settings,
  recipient dates and status messages describe their specific state or action.
  Financial amounts, fees, risks and transaction behavior are unchanged.

The Korean terms define this visible action as the contract's check-in. English
labels and canonical SDK/contract messages remain compatible. The interpolation
test compares required parameter names, allowing a translation to repeat a
number, and checks that all occurrences in the period example are substituted.

Screenshots were read for guest Home, expanded guide, setup period, deposit
conditions, funded Home, empty assets, withdrawal review and recipient receipt.
This is an editorial walkthrough and regression verification, not evidence of
comprehension by an unfamiliar human. The latest receipts are in RELEASE.md.

## Writing rules

- Explain the user's action, its result and the next step in that order.
- Use “맡긴 자산 / 받을 사람 / 기한 연장” in the main journey. “플랜” means the
  amount, recipient and check-in settings; explain it when starting a first plan.
- Do not call the seven-day wait a review or imply a human approves inheritance.
  The trigger is a missed check-in plus a recipient request, not verified death.
- Show money in the selected currency. Explain investment tokens before asking
  someone to move them; a token count is not an amount of WLD or USDC.
- Keep service fees, the asset manager's fee and network costs distinct. Preserve
  principal-loss, withdrawal-delay, no-audit and death-verification limitations at
  the decision where they matter. Plain wording must not hide material terms.
- A read failure is not zero funds; an unconfirmed transaction is not a failure
  that can safely be submitted again. Explain how to check the result first.
- Put protocol diagnostics behind details, with an understandable message first.

## Surfaces reviewed

Both locale dictionaries, their component usage, fixed authentication/transaction
failures, the render-error fallback, and all three public legal documents were
reviewed. Existing legal substance and numeric constraints are retained.

| Journey | Revision |
| --- | --- |
| First visit and login | Define what a plan sets; describe the user's next step; retain explicit sign-in agreement. |
| Empty or funded Home | Distinguish saved settings from assets; explain renewal by its new date rather than a timer reset. |
| Asset balances | Show estimated balance after service fee; shorten calculation labels; distinguish wallet cash and separate investments. |
| Add funds / withdraw / collect earnings | Distinguish principal withdrawal, earnings and investment-token transfer; retain actual amounts, fees and minimum receipt. |
| Setup and recovery | Use actionable field errors; say which completed work remains and which unfinished work can continue. |
| Owner settings | Explain recipient changes, stopping inheritance, and renewed deadlines in terms of their effects. |
| Recipient flow | Use request → seven-day wait → receipt; explain cancellation before payout and investment-only receipt. |
| Rewards and automation | Replace unexplained monitoring and settlement terms; do not promise notification delivery or exact-time execution. |
| History | Show received amounts and incomplete-history status first; retain block verification in details. |
| Help | Questions match actual user decisions; explain investment tokens and fees without assuming protocol knowledge. |
| Errors | Translate known contract/sign-in/confirmation failures; unresolved requests ask users to check results before sending again. |
| Legal reading | Full Korean translations of Terms, Privacy and Yield Terms; English remains available with a language switch. |

Examples:

| Before | After |
| --- | --- |
| 신청일부터 7일간 검토합니다 | 신청 후 7일이 지나야 받을 수 있습니다 |
| 모든 예치 지분을 내 지갑으로 옮기기 | 투자 자산을 내 지갑으로 옮기기 — explains that this moves investment tokens, not WLD/USDC cash |
| 금고 모니터링 켜기 | 자동 지급·알림 켜기 |
| 피상속인의 다음 확인 기한 | 맡긴 사람의 다음 정기 확인 기한 |
| 직접 입력한 수령인을 유지하고 연락처 응답은 무시했습니다 | 직접 입력한 사람을 받을 사람으로 사용합니다 |
| 확정된 수익 이벤트를 확인하는 중 | 수익을 받은 내역을 불러오고 있습니다 |
| English-only crash screen with raw error first | Korean/English recovery action first; error details collapsed |

The table above records the first pass. Its check-in wording is superseded by
the follow-up at the top of this document.

## Validation boundary

The disposable-chain suites exercise real app code with simulated wallet approvals
and local tokens. They check exact amounts, cancellation, no-liquidity payout,
changing quotes, recovery, Korean/English layouts and legal navigation. They do
not prove how an unfamiliar person understands the app, nor are they actual iOS
World App tests. Final run receipts and deployment/device readback are recorded
in RELEASE.md. No production transaction, invitation, notification or submission
is part of this revision.
