# Inheritance device test hosts

These small debug apps run the **real MiniKit SDK** inside Android WebView and iOS
WKWebView. They implement only the native message transport. The shared test page
and local server provide test identities, command responses, and the local chain.
No wallet keys belong in these native projects.

Start the local environment using the [test harness](../scripts/test-host/README.md).
The default app URL is `http://localhost:7777/`. Both shells have an editable URL
bar, an Open button, and Reload; the last URL is saved on the device. A permanent
`TEST HOST` label distinguishes them from World App.

## Android Studio / Android device

Prerequisites: Android Studio, Android SDK 35, JDK 17, and a connected device with
USB debugging or an Android emulator. The checked-in Gradle wrapper uses Gradle
8.11.1 and Android Gradle Plugin 8.9.2. The wrapper distribution has a pinned
SHA-256 checksum. First sync downloads standard Android build dependencies.

1. Open `test-hosts/android` in Android Studio and allow Gradle sync.
2. Start the test harness on the same computer as `adb`.
3. Forward the device's localhost port to the computer:

   ```sh
   adb reverse tcp:7777 tcp:7777
   ```

4. Select the **app** debug run configuration and your device, then Run.
5. Leave the URL at `http://localhost:7777/` and tap Open.

If multiple devices are connected, use `adb -s DEVICE_SERIAL reverse ...`.
Using reverse forwarding keeps the page on a localhost secure context, including
on a physical phone. The reverse mapping may need to be reapplied after disconnect.
Android Emulator can also reach the host via `http://10.0.2.2:7777/` when the server
is bound appropriately, but localhost with `adb reverse` is preferred.

Command-line equivalent, after configuring `ANDROID_HOME` or local `sdk.dir`:

```sh
cd test-hosts/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n org.inheritance.testhost/.MainActivity
```

Windows uses `gradlew.bat`. When the harness runs inside WSL and Android Studio /
`adb` run on Windows, first confirm Windows can open `http://localhost:7777/`;
`adb reverse` forwards to the machine running `adb`. Do not expose the Anvil RPC
port to work around a host networking issue: the harness proxies chain traffic.

Inspect WebView with desktop Chrome's `chrome://inspect/#devices`. Test keyboard,
system Back, rotation, app background/resume, and reload after pending commands.

## iOS / iPhone

Building and running the iOS host requires **macOS and Xcode**. A local Mac is
not required: `.github/workflows/ios-host.yml` runs the host on a standard GitHub
macOS runner, using an iPhone simulator and XCTest. From Linux/Windows:

```sh
gh workflow run ios-host.yml
gh run list --workflow ios-host.yml --limit 1
# Use the returned run ID to watch or download its evidence:
gh run watch RUN_ID --exit-status
gh run download RUN_ID --name ios-native-evidence
```

The workflow installs the app's locked MiniKit dependency, starts a fresh local
Anvil chain and the existing shared host, generates the debug Xcode project, and
runs native UI automation. It preserves the `.xcresult` (including screenshots),
host log and available simulator list for seven days. Test failures fail the job.
No Apple signing account, production credentials or real funds are used.
Linux/Windows alone can run the shared harness and browser checks, but cannot
build Apple's WKWebView app.
A connected iPhone needs an Apple development team and Developer Mode. A simulator
does not need a paid developer account.

The project is described by `ios/project.yml`; generate it using
[XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen
cd test-hosts/ios
xcodegen generate
open InheritanceTestHost.xcodeproj
```

Select the **InheritanceTestHost** scheme and a simulator, then Run. A harness
running on the same Mac is reachable at `http://localhost:7777/`.

For a physical iPhone:

1. Start the harness with `node scripts/test-host/start.mjs --lan` on the host
   computer. Put the computer and iPhone on the same trusted local network.
2. In Xcode, choose your development team under Signing & Capabilities and select
   your iPhone. If the bundle identifier is already taken, change it locally.
3. Run the app. Enter the private LAN URL printed by the harness, such as
   `http://192.168.1.20:7777/`, and allow local-network access when prompted.

LAN HTTP is not a browser secure context. The MiniKit commands exercised here do
not currently depend on browser APIs restricted to secure contexts, and the bridge
does not install a general compatibility polyfill. This does **not** test production
secure-context behavior. HTTPS can be used if the device trusts the development certificate;
the host never bypasses TLS errors. Public tunnel domains are deliberately refused.
App features such as clipboard copying still require a secure context and can fail
on LAN HTTP; validate those with trusted HTTPS and in actual World App.

To compile for Simulator without signing after project generation:

```sh
xcodebuild -project InheritanceTestHost.xcodeproj -scheme InheritanceTestHost \
  -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

Enable Safari Web Inspector on the phone, then inspect from Safari's Develop menu
on the Mac (WKWebView inspection is enabled on iOS 16.4+). Test the actual iPhone
keyboard, viewport/safe area, background/resume, rotation, and persisted state.

## Shared transport contract

The test page installs `window.__INHERITANCE_TEST_HOST_RECEIVE__` before booting
the app. MiniKit still uses its original transport:

| Platform | SDK sends | Native host returns to shared emulator |
| --- | --- | --- |
| Android | `window.Android.postMessage(JSON.stringify(payload))` | `window.__INHERITANCE_TEST_HOST_RECEIVE__(payload)` |
| iOS | `window.webkit.messageHandlers.minikit.postMessage(payload)` | `window.__INHERITANCE_TEST_HOST_RECEIVE__(payload)` |

iOS injects `window.__INHERITANCE_TEST_NATIVE_HOST__ = { platform: 'ios' }` at
document start. Android exposes the synchronous `Android.getPlatform()` returning
`'android'`; the shared test page uses it to establish the marker before app boot.
Both transports parse/serialize JSON rather than executing received strings.
The shared emulator emits the official SDK response events after fixture handling.

Only localhost, loopback, and private IPv4 ranges (10/8, 172.16/12, 192.168/16)
may be opened. Native navigation stays on the selected origin. Android also blocks
cross-origin resource loads because JavaScript interfaces are visible to frames;
the harness proxies required APIs and RPC on one origin. iOS accepts bridge messages
only from the main frame on the selected origin. Cleartext access is enabled only
to support this local environment. Android has no release build variant; iOS has
only a Debug configuration and a compile-time release guard.

## What this does and does not verify

This tests our app, the installed real SDK's request/response wiring, and the OS
WebView behavior. It enables repeatable local-chain flows without real funds.
Approval/rejection responses are test-host responses. It does not reproduce World
App's native approval UI, account-abstraction bundler/paymaster, transaction policy,
World ID proof generation, real contacts/chat delivery, or APNs/FCM notification
delivery. Keep a small real World App acceptance run for those integrations.

The Android shell has now been compiled and exercised in an actual Android 15
emulator on Linux/WSL with KVM. See [Android validation](android/README.md) for the
reusable command, exact runtime versions, native lifecycle checks and evidence.
The iOS project has also been compiled and run with Xcode 16.4 on a GitHub macOS
15 runner. The verified native run used iPhone 16 Pro / iOS 18.5:
[run 39941107575](https://github.com/Daviswhistle/Inheritance/actions/runs/39941107575).
It exercised all four guest tabs, real MiniKit wallet authentication through
WKScriptMessageHandler, the decimal keyboard with exact `12.345678` USDC input,
recipient typing, portrait/landscape input visibility above the actual keyboard
and accessory toolbar, Home/foreground input preservation, and restoration of
review actions after dismissing the keyboard. Screenshot
review of the preceding run exposed a fixed action covering recipient input while
the keyboard was open; the app now hides plan actions while editing with the
keyboard visible. The linked native regression asserts that the action is hidden;
Android and Linux WebKit regression checks also passed after that fix. The app
retains scroll clearance when the keyboard obscures the layout viewport and fits
focused fields into short landscape viewports. The iOS shell uses UIKit's
`keyboardLayoutGuide` to resize its embedded WKWebView above the keyboard and
accessory toolbar. This is the test host's viewport policy; it does not establish
World App's private host implementation. Simulator tests verify
native iOS behavior, but do not establish physical-iPhone or actual World App parity.

Build references: [AGP 8.9 compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes),
[Apple WKScriptMessage](https://developer.apple.com/documentation/webkit/wkscriptmessage),
[Gradle wrapper verification](https://docs.gradle.org/current/userguide/gradle_wrapper.html#sec:verification).


### Pending transaction and crash recovery

`npm run test-host:pending` verifies real Anvil pending/success/revert states.
The host supports controlled mining (`action: "mining", enabled: false`, then
`action: "mine"`) so a native app can receive an operation ID before confirmation.
`test:android-ui` now force-stops the app in that interval, signs in again, mines
the original transaction and verifies exact WLD/USDC deposits with no resubmission.
Recovery uses strict IndexedDB commits; localStorage is only a compatibility
mirror. This test reproduced loss of recent localStorage writes on process death
before the durable journal fix. Clearing app/site data still removes recovery
records and is not equivalent to process termination.

The iOS workflow now also triggers on app and contract changes. Each disposable
real-SDK host uses its own Vite optimizer cache so stubbed E2E modules cannot leak
into native tests. The cache is removed with that host's temporary fixture.

The current native run above passed both XCTest methods (zero failures). It also
covers manual sign-in rejection, termination while approval waits, explicit
re-authentication, and an unmined `1.000001` USDC deposit across process termination.
After mining, Resume verifies the original deposit with unchanged account nonce;
no second deposit is submitted. The initial EIP-7702 authorization nonce is
accounted for by comparing recovery against the mined baseline. The test-host
approval buttons preserve their DOM nodes across unrelated bridge events and
accept stationary trusted touches; drag/cancellation never approves, and a short
modal shield prevents compatibility clicks from reaching the app underneath.
