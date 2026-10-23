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
- Reduce the editing viewport and simulate a smaller visual viewport with the layout height retained: the focused input remains visible while fixed setup actions and navigation hide during keyboard editing; both return after editing, and tab changes restore normal layout. A failed token-balance read retains the draft, explains retry and blocks deposit approval; a successful retry enables review. At maximum review scroll, the full Terms and Privacy Policy links must be visible and tappable above the action bar. Distinguish these browser geometry checks from the real-device keyboard check below.
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
| Native keyboard and lifecycle behavior | `test:android-ui`: 17 Android 15 layouts and eight scenario groups; actual IME, Back, rotation, Home/foreground, force-stop/relogin while an actual submitted transaction remains unmined, recovery with zero new transaction requests, and font scale 1.3 |
| Native iOS keyboard and lifecycle | Xcode 16.4 / iPhone 16 Pro simulator / iOS 18.5: actual WKWebView, four guest tabs, real SDK sign-in, exact decimal input, native keyboard, full input visibility in portrait/landscape, Home/foreground preservation and review-action restoration after keyboard dismissal; manual sign-in rejection/restart and pending USDC process-death recovery (two XCTest methods, zero failures); [native run](https://github.com/Daviswhistle/Inheritance/actions/runs/39953168957) |
| Durable setup and financial regression | `unified-plan-browser.mjs`: 84 checks, including strict-write failure before wallet handoff, delayed Edit/Resume locking, partial setup, canonical/ID-less receipt recovery, strategy-fee changes and principal/income accounting |
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
is open. Android (17 layouts / eight groups) and WebKit (29 layouts) passed again,
and the iOS regression explicitly checks that the fixed action is hidden and the
entire input stays above the native keyboard/accessory toolbar. The native host
resizes WKWebView using `keyboardLayoutGuide`, the keyboard notification frame,
and the actual responder accessory-view frame in the same view coordinates.
This measured clearance avoids assuming a fixed toolbar height. The app preserves
a maximum viewport-height baseline for each width across rotation with the keyboard
open, and rechecks clearance after layout scrolling and foreground visibility changes.
The WebKit regression covers portrait 844 → keyboard 362 → landscape 70 → portrait
362 without blurring the field, including hidden actions/navigation and retained input.
The strengthened native regression additionally checks nine DOM hit-test points
inside the input, hidden actions/navigation, full native and DOM input geometry,
and stable samples before and after screenshots. Run `39953168957` at `93472b8`
passed both XCTest methods; portrait, landscape, foreground and recovered-balance
screenshots were independently inspected. Earlier green runs do not replace this
stronger evidence.
Artifacts (screenshots, test summary, `.xcresult`, host log) are attached to
the linked GitHub run for seven days and can be regenerated using `ios-host.yml`.
The Android run uses the AOSP image's WebView 124.0.6367.219; Linux WebKit is not
an iPhone. Android process-death recovery now also covers an unconfirmed request:
mining is paused, the actual SDK operation ID is saved, the app is force-stopped
immediately, and explicit sign-in restores the same request. After mining, Resume
verifies the original receipt; WLD/USDC amounts remain exact and no new transaction
request is made. LocalStorage readback alone failed this test by restoring an older
ready record. Setup journals now await strict IndexedDB transaction completion
before handing off to the wallet. Legacy local/session records migrate on first
read; durable tombstones prevent stale mirrors from reviving completed requests.
The iOS run also confirms an unmined `1.000001` USDC deposit survives actual
terminate/launch and re-authentication. After mining and Resume, `costBasis` is
exactly `1000001` and the mined account nonce is unchanged by recovery. The other
native test rejects sign-in, terminates a second pending approval, then explicitly
signs in and runs the keyboard/lifecycle checks. The host handles stationary
trusted touches as well as clicks; dragged/cancelled gestures do not approve, and
the modal stays briefly in place to prevent click-through. Native event tracing
exposed a touch-up without a synthesized click in the host's shadow dialog.
These are host controls, not the actual World App approval UI.

Ten storage tests cover delayed/failed commits, migration and deletion. A browser
without strict IndexedDB support blocks setup instead of pretending persistence.

Final screenshot review also caught Home briefly claiming no active plan while
its positions were still loading. Home now prioritizes loading (including an
account mismatch) over empty-state copy and balances. A WebKit regression holds
the actual position RPC, verifies checking placeholders without the false empty
state, then releases it and checks the exact funded balances and recipient.
The iOS recovery test now also waits for the rendered `1.000001` USDC balance and
enabled check-in before capturing its final screenshot.

Independent agent review also found same-tab legal links losing unsubmitted
forms and ambiguous principal wording. Terms/privacy now open in an in-app modal;
WebKit checks document return links, iframe Escape, focus return and preservation
of exact amounts/consent. Withdrawal inputs identify pre-fee amounts, and income
copy explicitly acknowledges investment losses. Agent review does not substitute
for a human comprehension study.

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
