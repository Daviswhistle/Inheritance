# Android native validation

This debug shell loads the actual app and MiniKit SDK in Android WebView. It uses
local test funds and the same disposable chain as the browser harness. It is not
World App and does not implement World App's native wallet approval screen.

## Build and run

Install JDK 17 and the official [Android command-line tools](https://developer.android.com/studio#command-line-tools-only),
then set `JAVA_HOME`, `ANDROID_HOME` and add the SDK's `platform-tools`, `emulator`
and `cmdline-tools/latest/bin` directories to `PATH`. Install the packages and
create one disposable emulator:

```sh
sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' \
  'emulator' 'system-images;android-35;default;x86_64'
avdmanager create avd --name inheritance-api35 \
  --package 'system-images;android-35;default;x86_64' --device pixel_2
emulator -accel-check
emulator -avd inheritance-api35 -port 5554 -no-window -no-audio \
  -no-snapshot -cores 2 -memory 2048 -gpu swiftshader -accel on
```

Wait until `adb -s emulator-5554 shell getprop sys.boot_completed` returns `1`.
A device listed by `adb devices` can still be too early to install an APK.

From the repository root:

```sh
(cd test-hosts/android && ./gradlew --no-daemon --max-workers=2 :app:assembleDebug)
ANDROID_SERIAL=emulator-5554 npm run test:android-ui
```

The verifier starts a fresh local chain on an unused port, installs the debug APK,
sets up `adb reverse`, and launches the validated local URL using `am start -d`.
It drives actual OS touch/keyboard input and reads the WebView through CDP. It
restores the emulator's rotation and font settings and removes its own forwards
and fixture server afterward. It refuses physical-device serials because the
suite intentionally changes OS settings and force-stops the disposable shell.

Optional variables: `ADB_BIN`, `ANDROID_HOST_APK`, `ANDROID_EVIDENCE_DIR`.
Evidence and native screenshots default to `/tmp/inheritance-android-ui`.
No browser viewport or keyboard emulation is used by this suite.

## Current Linux/WSL environment

The 2026-10-23 run installed tools under `/tmp/inheritance-android` without
installing system packages or changing global Java/SDK configuration. Reuse them
while that temporary directory exists:

```sh
. /tmp/inheritance-android/env.sh
(cd test-hosts/android && gradle --offline --no-daemon --max-workers=2 :app:assembleDebug)
ANDROID_SERIAL=emulator-5554 npm run test:android-ui
```

Tool versions: Temurin JDK 17.0.20.1+1, Gradle 8.11.1, Android Gradle Plugin 8.9.2,
Android platform 35 revision 2, build-tools 35.0.0, platform-tools 37.0.1,
command-line tools 23, emulator 37.2.12, AOSP API 35 x86_64 revision 2.
Official archive checksums were verified before extraction (SHA-256 for JDK and
Gradle; the published SDK repository SHA-1 checksums for Android archives).
The AOSP image bundles Android WebView **124.0.6367.219**, not the current World
App WebView. The actual runtime version is also recorded in every evidence file.

KVM was present but the current user's normal groups could not open `/dev/kvm`.
On this WSL machine, a single emulator process was launched as `davis` with the
supplementary `kvm` group through `wsl.exe --user root` and `runuser`. KVM API 12
and VM creation were verified. No persistent group membership, device permission,
or host virtualization settings were changed. This is a machine-specific launch
method; on a normal Linux setup follow the official
[emulator acceleration guide](https://developer.android.com/studio/run/emulator-acceleration).

To restart that same emulator on this machine, run the following in a separate
terminal. The final emulator process runs as `davis`, with temporary KVM access:

```sh
/mnt/c/Windows/System32/wsl.exe -d Ubuntu -u root --exec \
  /usr/sbin/runuser -u davis -g davis -G kvm -- /usr/bin/env \
  ANDROID_HOME=/tmp/inheritance-android/sdk \
  ANDROID_USER_HOME=/tmp/inheritance-android/user \
  ANDROID_AVD_HOME=/tmp/inheritance-android/user/avd \
  /tmp/inheritance-android/sdk/emulator/emulator -avd inheritance-api35 \
  -port 5554 -no-window -no-audio -no-boot-anim -no-snapshot \
  -cores 2 -memory 2048 -gpu swiftshader -accel on -feature -Vulkan
```

To stop it when finished: `adb -s emulator-5554 emu kill`.

The native test display was configured to 780 × 1688 physical pixels at 320 dpi.
The measured page viewport was 390 × 693 CSS pixels at device pixel ratio 2,
including space reserved for the explicit test-host toolbar and OS navigation.

## Native behavior

The shell keeps its WebView through OS rotation/resizing and invalidates the view
on configuration changes, following Android's
[WebView state guidance](https://developer.android.com/develop/adaptive-apps/cookbook/webview-state).
Before this fix, rotating Android recreated the Activity and lost the signed-in
page and unsubmitted draft. The URL bar also no longer acquires keyboard focus
when the host is launched. The page's real inputs still open the Android IME.

Force-stop/process death creates a new WebView. Sign-in is explicit again, and
confirmed plans are rediscovered from the chain. This does not promise that an
unconfirmed operation journal survives process death. World App approval,
bundler/paymaster policy, real funds, OEM keyboards and physical hardware remain
separate integration boundaries.

## Verified result (2026-10-23 KST)

`npm run test:android-ui` passed **17 native layouts and 7 scenario groups**, with
zero JavaScript runtime exceptions. The debug APK build also passed (33 tasks).
The run verified:

- Native numeric IME input of `12.345678` USDC, viewport 693 → 411 CSS pixels,
  keyboard-visible action clearance, and OS Back dismissal without losing input.
- Actual OS landscape/portrait rotation retaining the same page, sign-in, amount
  and recipient; actual Home/foreground transitions emitted `hidden` then `visible`.
- Exact 10 WLD + 12.345678 USDC review, initially unchecked consent, rapid repeated
  submit producing one pending approval, rejection leaving both factory mappings
  empty, and explicit **Resume remaining setup** creating the two correct plans.
- System Back during an unapproved check-in left the test host for the launcher.
  It did not approve or send that transaction; both `lastPing` values stayed unchanged.
  This shell behavior is recorded separately from World App's approval-screen policy.
- Actual force-stop/relaunch followed by explicit sign-in rediscovered both
  confirmed plans with unchanged principal and no automatic transaction.
- Owner screens in all four tabs under Android font scale 1.3, with no horizontal
  overflow. The native shell's Open button also now expands to fit its label.

The verifier uses read-only DOM/CDP observations plus actual `adb input` touch and
keyboard events; configuration changes are made through Android OS settings.
Published evidence: `/tmp/inheritance-android-ui/evidence.json`, together with
`keyboard.png`, `landscape.png`, `review.png`, `owner.png` and `font-1.3.png`.
The Linux KVM emulator and bundled Android WebView are real runtimes; the wallet
approval response and local chain assets remain explicit test fixtures.
