# Keyboard dismissal correction — November 2, 2026

Status: cause reproduced and correction verified on native iOS. Deployment and
actual Android readback are tracked in [RELEASE.md](RELEASE.md).

## Failure and cause

In native iOS host run [41318558852](https://github.com/Daviswhistle/Inheritance/actions/runs/41318558852),
Done did not restore the review action after rotation and background return.
The recipient draft remained intact, but focus moved to `period-input` and its
numeric keyboard stayed open. The preceding screenshot placed the floating Done
button over the check-in interval label. That run had no event-target trace.

The instrumented follow-up
[41323291147](https://github.com/Daviswhistle/Inheritance/actions/runs/41323291147)
established a click-retargeting defect even though both high-level tests passed.
In two recorded gestures, pointer-down and pointer-up reached Done correctly.
Pointer-up blurred `heir-input`, native keyboard dismissal moved or hid the
fixed button, and WebKit then dispatched a click to the content behind it:

| Trace time (ms) | Event | Target / result |
| --- | --- | --- |
| 107399 | pointerdown | Done, `(346,314)` |
| 107461 | pointerup | Done |
| 107462 | focusout | Recipient loses focus |
| 107598 | click | Underlying `.field-row`, `(346,338)`; Done has moved down |
| 173877 | pointerup | Done |
| 173879 | focusout | Recipient loses focus |
| 174085 | click | Underlying plan content; Done is hidden |

A cause-specific replay on the unchanged runtime then reproduced the original
failure in [41325963205](https://github.com/Daviswhistle/Inheritance/actions/runs/41325963205)
(source `2f185f6`). After native rotation and background return, the test confirmed
that Done's center overlapped the interval label before tapping it. The trace was:

| Trace time (ms) | Event | Target / result |
| --- | --- | --- |
| 76479 | pointerdown | Done, `(346,314)` |
| 76539 | pointerup | Done |
| 76542 | focusout, touchend | Recipient loses focus; touch still targets Done |
| 76597 | click | Check-in interval label after keyboard reflow |
| 76598 | click | Label forwards activation to `period-input` |
| 76602 | focusin | `period-input`; keyboard remains open and review stays hidden |

The same “Dismissal restores review action” assertion failed. The separate
pending-deposit recovery test passed. This establishes the original failure
mechanism and explains why ordinary repetitions sometimes appeared successful:
the consequence depended on which element received the escaped click.

Preventing `pointerdown` does not suppress click activation. The
[W3C Pointer Events specification](https://www.w3.org/TR/pointerevents/#attributes-and-default-actions)
distinguishes those events. WebKit documents cancelling `touchend` to prevent
the subsequent click in its [touch-handling guidance](https://webkit.org/blog/5610/more-responsive-tapping-on-ios/).

## Correction and regression

Commit `aef7fe6` consumes Done's `touchend` default action. Pointer-up still
performs keyboard dismissal; `onClick` remains available for non-touch
activation. The change is limited to this non-transactional button.

The WebKit regression sends a real browser touch and checks that the release
reaches Done, `touchend` is cancelled, no extra click is generated, the draft is
preserved and navigation returns after closing. The new check failed on the
unchanged runtime and passed with the fix. The complete suite passed 19 checks
and 31 layouts. Typecheck, lint and production build passed. Independent commit
review found no actionable defect and independently reran the WebKit suite.

The native regression additionally checks software-keyboard disappearance,
event targets and cancellation after rotation/foreground return. It arranges a
real label overlap and verifies the DOM coordinates before tapping. The first
arrangement attempt failed because UIKit consumed a short drag as pan-recognition
distance; test-only `5209fd4` corrects that setup movement without relaxing the
overlap assertion.

The final native run
[41325954954](https://github.com/Daviswhistle/Inheritance/actions/runs/41325954954)
(source `5209fd4`) passed both tests with zero failures or skips. Five traced
Done gestures—decimal input plus the initial and three repeated
rotation/foreground/label-overlap cases—each reached Done, cancelled `touchend`,
generated zero clicks and restored controls with no input focused. The pending
deposit also recovered after process termination. The unchanged-runtime replay
above failed on the original symptom, so acceptance rests on a before/after
causal regression, not on a later unexplained successful repetition.

These tests ran on iPhone 16 Pro / iOS 18.5 Simulator with a native WKWebView,
real MiniKit transport and disposable local assets. They establish native
keyboard and lifecycle behavior; the host simulates approval responses and is
not a physical-iPhone World App approval test.

## Korea-only follow-up: native fixture failures

Policy run [41329500340](https://github.com/Daviswhistle/Inheritance/actions/runs/41329500340)
passed two tests with no failures/skips and five verified Done gestures. Two
subsequent executions stopped **before** the next Done action:

- [41329874448](https://github.com/Daviswhistle/Inheritance/actions/runs/41329874448):
  fixture overlap failed. Done's center was y=315 while the interval label covered
  y=320–340; the last gesture targeted main content. Two earlier Done gestures
  passed. The fixed 12pt pan allowance did not reliably produce enough movement.
- [41329915903](https://github.com/Daviswhistle/Inheritance/actions/runs/41329915903):
  the 20-second visible-control wait expired during slow XCTest accessibility
  queries. DOM geometry was stable with an unobscured recipient, Done at
  [314,292,64,46], and the interval at [45,303,312,20]. The failure screenshot
  shows Done, and the native hierarchy exposes it at [314,424,64,47], inside the
  WebView. No Done touch occurred at that failure. Pending-deposit recovery
  passed in both runs. This evidence distinguishes a pre-action timeout from
  the original post-touch click-retargeting failure.

Test-only `17a9f69` measures DOM geometry and actual pan movement, waits for
settling, and adapts the allowance. Independent review identified a new 44pt
minimum-step oscillation; `340fefd` removes that floor and allows fine correction.
It also gives the Done accessibility query 60 seconds while retaining the same
visible size, bounds, three stable observations and 0.8-second stability gate.
Per-observation frame logs now expose any further wait failure. All exact overlap,
native gesture, prevented touchend, zero-click and keyboard-close assertions
remain required. Application code is unchanged. The complete test-only delta
passed independent review and CI. Final native [41331879980](https://github.com/Daviswhistle/Inheritance/actions/runs/41331879980)
passed both tests with zero failures: all five Done gestures cancelled touchend,
generated no extra click, cleared input focus and restored controls. The measured
pans reached the exact label-overlap condition before each applicable tap; the
process-termination deposit-recovery test also passed. See [RELEASE.md](RELEASE.md). The superseded intermediate run was cancelled when the
review correction was committed; it is not counted as acceptance.


## November 2 UX revision regression check

The revised setup/review runtime is `fd16206`. Native run 41395213145 passed the
keyboard lifecycle but failed a stale recovery heading expectation. Its exported
hierarchy contains the new restored “Continue unfinished setup” heading.
Test-only `a89aec9` corrects the expectation without changing production code.

Run 41395540414 had a separate pre-action fixture failure. Two Done gestures
passed; the next overlap setup exhausted its pan attempts. Its failure trace
shows the last pointer-down on `main-content`, the Done center at Y=314.3125
and the interval label at Y=339–359. The intended overlap had not been arranged,
so this was not a failed Done tap. The screenshot confirms the still-open input
and label below Done. This run remains a failed run, not accepted evidence.

Final [run 41396499474](https://github.com/Daviswhistle/Inheritance/actions/runs/41396499474)
passed both lifecycle and process-termination recovery tests, zero failures or
skips. The unchanged strict overlap gate passed before each applicable tap.
All five native Done traces show a button-targeted pointer-down, prevented
touchend, no extra click, no remaining focused input and restored actions.
The earlier fixture alignment remains timing-sensitive; the acceptance evidence
is the completed gestures and recovery in this final run, not an assertion that
the fixture never flakes. The production click-retargeting fix is unchanged.


## First-use revision fixture geometry

Run 41399668170 passed process-termination recovery and the numeric-input Done
but failed while arranging the recipient-field overlap, before tapping Done.
The trace has input top 118, interval-label top 356 (238px apart) and Done center
315. The application's input-clearance floor is 80px in this viewport, so the
label cannot settle above 318px while that unresolved-recipient error row is
present. Merely retrying the same drag cannot establish the requested overlap.

The host config supplies `test_heir`, but the lifecycle test typed nonexistent
`@sam`. The revised fixture uses `@test_heir` and explicitly waits for its resolved
label before rotation/overlap checks. This removes the unrelated lookup error
from the lifecycle scenario. A slow drag with a final hold also avoids a fling
while arranging the target. The exact overlap gate, native keyboard, rotation,
background return, button-targeted gesture, prevented touchend, no extra click,
restored controls and process-recovery assertions remain unchanged. No production
keyboard or scroll-protection behavior was weakened. Final evidence follows in
[RELEASE.md](RELEASE.md).
