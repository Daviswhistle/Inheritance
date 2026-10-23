# Release verification

Use current evidence, not checked boxes copied from a previous release. Local release results and acceptance criteria are in `docs/RELEASE.md`; deployment receipts are the GitHub Actions runs for the exact release commit. Verify live automation separately through its health cycle.

## Required local checks

- Foundry formatting, contract build and full suite; generated custom error ABI matches.
- Frontend typecheck, lint, build, CSS class mapping, English/Korean copy and language persistence.
- First entry opens Home and all four tabs without a landing page. Guest balances are unavailable, not zero. Navigation and Help do not request wallet sign-in or transactions. Sign-in is explicit; shared vault links open Plan and survive the World App fallback. Check the entry CTA above the bottom tabs at 320×640 as well as 390×844. Empty and failed-lookup states provide an accurate next action.
- Actual SDK SIWE signatures: one-use nonce replay rejection, session expiry and foreign origin/wallet rejection.
- Notification APIs: anonymous/foreign-wallet denial, canonical current/legacy vault checks, owner-only unregister, own-wallet-only test, durable rate limits, alert cooldown persistence and terminal retirement.
- Dedicated finalizer: canonical vault/token/chain, pre-seven-day refusal, renewal cancels pending transfer, fixed recipient, concurrent lease protection, atomic budget/transaction staging, interrupted database acknowledgement, pending receipt recovery, funding/fee/daily caps, actual fees and unknown fee fail-closed behavior.
- MiniKit user-operation to canonical receipt resolution; failures and absent refreshed state cannot report success.
- Fresh WLD + USDC setup uses one atomic wallet request and one successful receipt for all six calls. Cancellation sends no funds; a final-call revert rolls back both creations and deposits. ID-less/identified setup recovery sends no additional request. Ordinary check-in opens wallet approval directly; pending claims require cancellation confirmation and changed claims invalidate it.
- Initial inputs ask only for amounts, recipient and interval. The final review retains exact amounts, full recipient, both fees, lending/liquidity risks and unchecked consent. Optional reminders belong after funding. A quote/read failure before handoff leaves an editable draft.
- Unified WLD/USDC plan: exact token decimals, explicit yield consent, completed-asset preservation, definitive failure retry and unresolved-operation duplicate prevention. Failed or silently discarded recovery storage must stop before a wallet request. Recovery verifies historical canonical receipts even after later withdrawals, scans from the saved submission block and retains the original trusted factory after rotation. A changed settings-review target list invalidates the prior approval.
- Unified recovery regressions: include every active configured generation in settings review, preserve exact interval seconds, check all remaining balances before creation, retain submitted original vault addresses after slot replacement, and exclude completed assets from new creation. Only proven-unsent setup can be edited; completed amounts are excluded from the new draft.
- Settings requests retain their original targets before submission. Ambiguous requests survive reload and block editing; canonical success or failure resolves only the original request. Daily wallet-policy rejections remain editable. Creation receipt recovery is independent of later heir/period edits. WLD totals include held WLD in USDC positions, and personal management opens the owner's position from a shared link.
- Confirmed deposits receive monitoring even when a later asset fails or the user edits only the remaining setup. A missing original settings route keeps its unresolved journal and blocks new wallet requests instead of deleting progress.
- Send blocks new deposits into a position with unfinished saved setup, including a lost response for an executed deposit. The original receipt must remain uniquely recoverable. A new position funded through ordinary Send after cancelled setup receives monitoring, and a delayed registration response must not block switching assets.
- Shortening an old, funded vault's interval requires disclosed consent and an atomic check-in before the period change. Unselected funds must remain active. A period-only receipt cannot resolve a journal that requires the check-in.
- Use the installed SDK's real command errors in the browser fixture. Unsupported or unavailable commands must remain editable before native handoff. Completed assets' fee queries cannot block remaining deposits; receipt verification proceeds without fresh deposit consent, and new funds stay paused until that consent and live route checks pass.
- Income-only collection preserves principal basis and inheritance timers, charges 10% of realized gains and uses the personal vault's canonical income event. A legacy route with a supporting deployed income API retains that feature; contracts without it keep their original controls.
- Guarded gas funding: fixed operator assets and recipients, actual WLD/USDC route comparison, economical batches, atomic refunds, signer-wide pending recovery, price checks and daily operating budget without a lifetime quota.
- Fresh-chain browser suite: creation, deposit, renewal, management, claim, completion, residue sweep, release/recreate, linked-vault owner/heir separation, delayed dual-factory selection, linked-vault reauthentication, cancellation and chain outage/recovery.
- Responsive inspection at 320px, 390px and desktop; footer controls accessible above the safe area; store images generated from current UI.

- Amount-first creation: “Review plan” sends no wallet request, preserves exact 18/6-decimal amounts and the full resolved heir, and “Edit plan” restores input focus. Final confirmation retains durable recovery and pending-wallet guards.
- Home/Assets/Plan navigation: token selection retains canonical routing, earlier balances remain reachable, a shared balance identifies its owner, and income/principal controls remain separate. Asset switches clear custom income destinations and render one income card.
- Audit both default and expanded disclosures; closed descendants must not be counted as visible controls. Inspect at 320px as well as 390px, including the final approval screen.
- At 320×640 and 390×844, check-in and an eligible recipient claim are visible and tappable before scrolling. Settings appear before the collapsed invitation; opening it preserves all sharing controls without sending anything. Setup/review actions remain above navigation, and full recipient, fees and mandatory risk consent can be reached by scrolling.
- For a recipient with plans from multiple owners, each shared link puts its selected owner's plan and eligible claim action first at both mobile sizes. Opening either link sends no wallet request.
- A no-wallet-request assertion must use a functioning recorder: a deliberately rejected request increases its count, and a successful multi-call batch counts as one request. Recheck setup, navigation and receipt recovery with this recorder.
- Reduce the editing viewport and simulate a smaller visual viewport with the layout height retained: the focused input and setup action remain visible, navigation returns after editing, and tab changes restore normal layout. A failed token-balance read retains the draft, explains retry and blocks deposit approval; a successful retry enables review. At maximum review scroll, the full Terms and Privacy Policy links must be visible and tappable above the action bar. Distinguish these browser geometry checks from the real-device keyboard check below.
- A stalled USDC read must preserve healthy WLD-only setup; a failed selected WLD read must preserve healthy USDC-only setup. Publish each successful balance independently, verify its token precision and invalidate only failed/timed-out tokens. Expired responses cannot clear their unavailable state; fresh retry retains the amounts. Background errors and changing action hints must not cover a focused input while the keyboard remains open.

## UI evidence recorded on 2026-10-23 KST

This records the local UI work; it does not mark the remote release checks below
as complete. The reference patterns are the official
[World design guidelines](https://docs.world.org/mini-apps/guidelines/design-guidelines)
and [app guidelines](https://docs.world.org/mini-apps/guidelines/app-guidelines).

| Requirement | Current evidence |
| --- | --- |
| Distinct Home, Assets, Plan and Help tasks with consistent navigation; unauthenticated browsing | `test:product-ui`: 68 layouts including EN/KO guest/owner, 320/390px and desktop; no wallet request from guest browsing |
| Accessible controls, expanded content and modal focus | 37 axe states with zero reported violations; 44px controls, action hit tests, native dialog containment, Escape/Cancel focus return |
| Exact amounts, explicit consent and clear principal/income separation | Actual SDK setup and exact USDC withdrawal; review checks full recipient and initially unchecked consent; balance appears before income |
| Native keyboard and lifecycle behavior | `test:android-ui`: 17 Android 15 layouts and seven scenario groups; actual IME, Back, rotation, Home/foreground, force-stop/relogin and font scale 1.3 |
| Native iOS keyboard and lifecycle | Xcode 16.4 / iPhone 16 Pro simulator / iOS 18.5: actual WKWebView, four guest tabs, real SDK sign-in, exact decimal input, native keyboard, full input visibility in portrait/landscape, Home/foreground preservation and review-action restoration after keyboard dismissal; [native run](https://github.com/Daviswhistle/Inheritance/actions/runs/39907972022) |
| Second engine and interruption recovery | `test:webkit-ui`: 29 Linux WebKit layouts; offline/reconnect, rejection, pending-approval reload, history return, and a committed deposit recovered after losing its SDK callback without another transaction |
| Current storefront artwork | `store-host-shots.mjs` captures actual current UI using local contracts; `make-store-images.mjs` produces the checked-in images with illustrative-value disclosures; dimensions and <=500KB limits verified |
| Build and separation from test tools | Frontend typecheck, lint and production build pass; test-host command markers and fixture signing keys absent from generated JS; Android debug APK compiled successfully |

Reproduction commands are in [the verification guide](../scripts/verify/README.md)
and [the Android guide](../test-hosts/android/README.md). Raw evidence is in
`/tmp/wld-verify/shots/product-ui-evidence.json`,
`/tmp/inheritance-webkit-ui/evidence.json` and
`/tmp/inheritance-android-ui/evidence.json` on the current workstation.
These temporary files are regenerated by the corresponding commands.

Still unverified: physical-iPhone behavior, actual World App approval and
notification services, and first-use understanding by an unfamiliar person.
Native iOS simulator checks are now available through `ios-host.yml`; a local Mac
is not required. Screenshot inspection found an iOS keyboard/action overlap that
automated value assertions alone missed. Plan actions now hide while the keyboard
is open. Android (17 layouts / seven groups) and WebKit (29 layouts) passed again,
and the iOS regression explicitly checks that the fixed action is hidden and the
entire input stays above the native keyboard/accessory toolbar. The native host
now resizes WKWebView with `keyboardLayoutGuide`; the app preserves scroll
clearance and handles very short editing viewports. The final native screenshots
were inspected, including the fully visible recipient input in landscape.
Artifacts (five screenshots, test summary, `.xcresult`, host log) are attached to
the linked GitHub run for seven days and can be regenerated using `ios-host.yml`.
The Android run uses the AOSP image's WebView 124.0.6367.219; Linux WebKit is not
an iPhone. Process-death recovery was verified for confirmed plans after explicit
sign-in, not for preservation of an unconfirmed session-storage journal.

## Remote checks

- Factory deployment receipt and runtime bytecode match the reviewed artifact, WLD address and chain480.
- Hosted cron runtime: verify the SQLite-backed `FINALIZER_EXECUTOR` binding and exported class, `executionRuntime: "durable_object"`, invocation outcomes/CPU and advancing successful cycles. A missing binding must fail closed; public HTTP requests must never start payouts. An HTTP 200 and local executor tests do not clear an `exceededCpu` failure. Inspect both the calling Worker and Durable Object traces and shared account quotas.
- Current and legacy factory addresses/block numbers agree across frontend, Worker, GitHub variables and portal allowlist.
- Shared D1 migration and shared session secret applied; deployed nonce and replay behavior match local checks.
- Exact pushed commit has successful CI and Pages/Worker deploy runs; public pages and assets resolve.
- Cron actually advances finalizer cycle status, dedicated signer is funded, gas caps are present and no secrets are in the public bundle.
- Portal descriptions/images match actual rules; record actual review-submission status without claiming approval.

## External evidence still needed

Actual World App iOS/Android wallet approvals, permission dialogs, contacts and recipient notification delivery still require World App integration evidence. The native hosts use the real installed SDK, but their approvals and delivery responses are simulated; passing those hosts does not verify the World App service or native approval UI. Store approval is a separate external decision. No independent external contract audit has been performed.

For first-use acceptance on a real device, ask someone unfamiliar with the app to explain who can receive funds and when, prepare a draft without assistance, find the fees and risks, locate check-in, and open a received plan. Verify they understand that login is not check-in and that missing the deadline alone does not send funds. Try amount/recipient input with the native keyboard and return from wallet cancellation. Record actual observations before claiming ease of use or user preference; automated success is not evidence that people like the app.

### First-use observation procedure

Use a fresh disposable test host, not a production wallet. A desktop browser run
can establish wording/navigation comprehension, but must be labelled as desktop
evidence rather than native-device acceptance. The moderator handles test-host
controls; participants should not need to understand the development tools.

Give the participant these tasks without explaining the navigation first:

1. From the first screen, explain what the app does and what happens if the owner
   misses a check-in. Record the person's own words before giving any correction.
2. Prepare a draft for 10 WLD and 12.345678 USDC, the supplied test recipient, and
   a 30-day interval. Stop at the review before final approval. Record wrong turns,
   requests for help, and whether the participant checks the exact recipient.
3. Find the service and strategy fees and describe what can happen to principal
   and withdrawals. Ask which amount would be received; do not suggest the answer.
4. On a pre-funded test plan, find the next check-in and explain whether opening
   the app alone renews it. Find how to collect income separately from principal.
5. Open the supplied recipient link and explain the next available step and
   waiting period. Record any interpretation of a deadline as an automatic payout.

For each task, record completed/assisted/not completed, the actual words/actions,
and the point of confusion. Any misunderstanding of recipient, fees, loss risk,
check-in or transfer timing is a finding to fix and retest, even if the person
reaches the right button. Record device/browser/language and whether the person
has used the app before. Leave outcomes blank until a real participant performs
the tasks; an agent walkthrough is not a substitute for this evidence.
