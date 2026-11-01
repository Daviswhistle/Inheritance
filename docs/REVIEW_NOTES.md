# Reviewer notes

App ID: `app_28c40a2a42b7f6c95789c2d5231b1314`
URL: https://inheritance.pages.dev/
Languages: English and Korean. Mini App for World App.

## Improvements since the design review

The October 21 review asked for clearer UX and distinct tabs. Each tab now has
one primary purpose, with the same navigation before and after sign-in:

| Tab | Main task |
| --- | --- |
| Home | See the next check-in and renew the plan. |
| Assets | View balances, add funds, withdraw and collect income. |
| Plan | Set the recipient and interval, invite the heir and manage received plans. |
| Help | Read the rules, fees, risks, reminders and support information. |

Before sign-in, the tabs explain their purpose without displaying example
balances. Browsing, opening legal documents and changing tabs do not request a
wallet signature. **Agree and sign in** starts the explicit sign-in flow.

Setup now separates entry, review and wallet approval. **Review plan** shows the
exact token amounts, full recipient address, check-in interval, current rates,
fees and total-debit components. **Open approval screen** then opens World App's
native transaction review. Risk consent starts unchecked.

Keyboard handling keeps the active field visible through rotation and return
from the background. The compact **Done** action restores navigation and review
controls. It now consumes the touch-generated extra click that could activate
the interval field behind it while the keyboard was closing. The same native
reproduction failed before the fix and passed after it; all five traced Done
gestures in the final run dismissed the keyboard without an extra click. See
[the before/after evidence](KEYBOARD_DISMISSAL.md).

Interrupted setup restores the original request and checks its receipt before
allowing another deposit. The repaired **All** withdrawal reads the complete
position at execution; actual Android WLD and USDC round trips finished with
zero remaining shares, assets and cost basis.

## Suggested review walkthrough

1. Browse Home, Assets, Plan and Help before signing in. Open Terms and Privacy;
   closing them returns to the app without requesting approval.
2. Sign in from Plan. Enter a supported residence when prompted, select WLD or
   USDC, enter an amount, choose a World App contact or type a username/address,
   and select a 1–365-day check-in interval.
3. Open the keyboard, rotate the device, return from the background and tap
   Done. Confirm that the draft remains and the review action returns.
4. Select **Review plan**. Check exact amounts, recipient, fees and risk consent.
   Edit the plan or open and close a legal document; the draft is preserved.
5. Open the approval screen and reject it. The app offers an explicit retry.
   If a transaction is approved, close/reopen the app to inspect receipt-based
   recovery before attempting another deposit.
6. Compare Home's check-in action, Assets' withdrawal controls and Plan's
   recipient/interval settings. Help keeps fees, risks and support accessible.

## Rates, costs and fund controls

The app queries dated lending rates, general WLD reward campaigns and the
configured Re7 strategy's performance fee. An unavailable or stale response is
shown as unavailable, rather than replaced with a fixed return. Verified-human
boosts are excluded from the displayed general rate.

The strategy's fee and Inheritance's service fee are shown separately.
Inheritance charges 10% of realized positive net gains after underlying costs and
loss recovery; deposited principal is excluded. The review includes a per-token
example using the current strategy fee. A changed strategy fee requires fresh
review and consent. Rates can vary and invested principal can lose value.

Network costs are additional to the entered deposit. Creation, added funds and
withdrawal can each require a WLD fee when sponsorship is unavailable. Review
shows deposit amounts plus this conditional WLD fee as separate total-debit
components; World App provides the exact quote on its approval screen. The
MiniKit interface does not provide that exact quote earlier to this app.

User keys remain in World App. Basic WLD is held in the user's vault; invested
WLD or USDC uses its fixed strategy and the vault holds receipt shares. The app
manages the separate WLD and USDC vaults together. Existing owners can withdraw
principal, collect available income or manage their plan. Redeeming shares
already received into a wallet does not charge a second Inheritance service fee.

## Inheritance rules

An explicit check-in renews the deadline. After it expires, the named heir can
file a claim, which starts a fixed seven-day review period. Funds remain in the
vault or strategy during that period. The owner can renew and cancel the claim
until the transfer actually executes; transaction ordering determines which
action wins.

For registered supported vaults, the service can submit the eligible transfer
after the review period. Its infrastructure signer pays gas but cannot change
the recipient, file the heir's claim or withdraw an active owner's funds.
Manual completion remains available. Automation depends on registration, service
and network availability, gas funding and spending caps. A timer is not death
verification or a legal will. Current contracts support one heir.

## Availability

New plans and deposits require both a supported current network location and
explicit residence confirmation for South Korea, Argentina or Colombia. A fresh
location check runs before each new wallet request. Help allows residence
changes. Unknown location and lookup failures block new requests while keeping
sign-in, existing withdrawals, renewals, claims and submitted-request recovery
accessible.

Reviewers outside this scope can browse the app and manage existing assets.
The isolated hosts in `scripts/test-host` provide disposable funds and explicit
country fixtures for testing; production has no reviewer bypass. The country
assessment and interface boundaries are in [LAUNCH_SCOPE.md](LAUNCH_SCOPE.md).

## Verification and contract review

Actual Android World App checks include sign-in cancellation/retry/success,
contact cancellation and selection, keyboard dismissal, notification permission,
one received self-notification, WLD and USDC deposit/full-withdrawal round trips,
reopening recovery and regional controls.

Native iOS WKWebView tests exercise the real MiniKit transport with disposable
local contracts, the software keyboard, rotation, background return and recovery
after process termination. Approvals in that host are simulated; these results
do not represent physical-iPhone World App approval or notification tests.
Current build IDs, test results and the keyboard before/after evidence are in
[RELEASE.md](RELEASE.md). Device-specific coverage is in
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md).

Please include the existing immutable contracts and the 10% service fee on
realized positive net gains in this code review. The contracts are already
deployed; we have no pre-deployment TFH source-sharing record. Public source,
deployed addresses, control boundaries, fee calculations and test coverage are
provided in [GUIDELINE_REVIEW.md](GUIDELINE_REVIEW.md). The interface discloses the
absence of an independent security audit before deposits.
