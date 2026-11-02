# Android cold-start investigation — November 2, 2026

## Conclusion

The prior claim of a persistent blank screen after force-stop was not supported
by synchronized visual evidence. On the unchanged production build `55ede20`,
timed captures show World App startup/loading followed by a rendered Inheritance
page. UIAutomator still reports only the native header and a WebView with no
web descendants, even while the pixels show the complete page. Reopening the
link creates another WebView and makes the XML tree visible; that alone does
not establish that reopening repaired a product failure.

This corrects the earlier diagnosis. It is not a claim that application code was
patched to fix a demonstrated startup exception. No production runtime change,
World App reinstall, data reset, device setting change or submission was made.

## Evidence

Device: Samsung Android 13; World Money/World App 4.0.4602; Android WebView
156.0.8078.47. The Play Store offered Open, not Update. Production remained the
already deployed `55ede20` build throughout this comparison.

- Canonical root deep link: at 3 seconds the native World splash was visible;
  by 8 seconds the complete guest page was visible, and remained at 15 seconds.
- Repeated controlled root test: the process was absent after force-stop and a
  new PID appeared on launch. At 5 seconds the native loading panel was visible;
  at 15 and 30 seconds the app was rendered without a second link or touch.
- Static `/terms.html`, which has no React/MiniKit initialization, also rendered
  by 15 seconds and remained visible at 30 seconds. Its XML likewise omitted
  web descendants. This disproves using that XML absence as evidence of a
  React/MiniKit failure.
- A real Chrome tap on the production page's Open in World App link, with
  World App force-stopped beforehand, also displayed the guest page at the
  15-second capture without a second link.
- Tapping the visible Terms return link opened Inheritance; tapping Help then
  displayed its content. This checks response, not just a frozen screenshot.

These times are sampling points, not measured time-to-interactive or a startup
performance guarantee. Native startup and network latency vary. The earlier
white screenshot was real but was not paired with a later untouched screenshot;
subsequent empty XML snapshots did not prove that the pixels stayed blank.
No native crash or app JavaScript exception was established. The host-internal
reason for the missing accessibility descendants is not proven, and this test
is not a TalkBack accessibility assessment.

## Corrected capture procedure

`scripts/verify/android-cold-start.mjs` requires an explicit authorized device
and an output directory outside this repository:

```sh
ADB_BIN=/absolute/path/to/adb \
ANDROID_SERIAL=your_authorized_device \
ANDROID_COLD_OUT=/absolute/private/evidence/directory \
node scripts/verify/android-cold-start.mjs
```

It checks actual process termination, preserves remote URL quoting, captures
pixels at 5/15/30 seconds for the app and static control, and only then collects
XML. A failed XML dump cannot reuse an old file. Its result is deliberately
`REQUIRES_VISUAL_REVIEW`: missing XML descendants are inconclusive. Inspect the
screenshots, then verify a visible non-financial navigation action. Do not use
an XML-only failure or success as a device verdict. Stop captures during secret
entry; this script itself never taps login or approval controls.

Phone screenshots, process IDs, logs and XML remain in the private local
`work/evidence/cold-start-nov02` directory, outside Git. No wallet transaction,
notification, external inquiry or store submission was performed.

The official [phone testing instructions](https://github.com/worldcoin/developer-docs/blob/main/mini-apps/quick-start/testing.mdx)
were consulted, including their `worldcoin.org/mini-app?app_id=...` QR target.
Both that link and the app's `world.org` link were inspected. They do not provide
an assurance about UIAutomator's accessibility tree.
