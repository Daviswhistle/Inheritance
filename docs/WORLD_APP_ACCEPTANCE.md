# Actual World App acceptance

Status: awaiting operator test results. Do not check a step from a simulated
bridge, Linux browser, native test host, or on-chain fork result.

Open [Inheritance in World App](https://world.org/mini-app?app_id=app_28c40a2a42b7f6c95789c2d5231b1314).
Record the device model, OS version, World App version, date and UI language.
The current runtime is `a56335f8a978db1dda9b154b3a606b5de74382ae`.

## Available installation environment

The original AOSP test host remains at `emulator-5554`. The Google Play WSL
AVD `inheritance-worldapp-play` was stopped after poor interactive performance.
A separate Windows-native AVD, `inheritance-windows-play`, runs Android 15
Google Play revision 9 with Windows WHPX and NVIDIA host GPU acceleration.
It advertises `x86_64,arm64-v8a` and `libndk_translation.so`. The operator completed
Google Play login. Store installation was rejected; see the dated attempt below.
This is an emulator, not a physical Android device.

Do not record emulator results in the physical-device fields. Do not capture
screenshots, UI text or logs while the operator enters Google credentials.

## No-transfer checks

1. Browse Home / Assets / Plan / Help before signing in. No wallet request should
   appear from navigation. Open and close Privacy/Terms from the sign-in area.
2. Start sign-in and cancel the wallet request. Retry and approve sign-in. The
   user identity should appear without a permanent spinner or lost navigation.
3. In Plan enter an amount, rotate if convenient, then tap Done above the keyboard.
   The full input and Done must be tappable and the entered value must remain.
4. Tap Choose contact and cancel; then select a contact. Check that the selected
   username/address appears. Do not send an invitation or approve a deposit.
5. Help → notification settings → Enable reminders. Record the permission result.
   Permission acceptance alone does not demonstrate notification delivery.

## Wallet transaction checks

Do these only with a willing tester's disposable funds and a known recipient.
There is no automatic test deposit. Record token, amount and public transaction
hash, never a private key, seed phrase, session token or sign-in signature.

1. Review a small plan, check recipient, exact amount, fees and risk disclosures.
   Open the World App deposit approval and cancel. Confirm no success/deposit is
   shown and that the plan remains editable. Verify no confirmed deposit on-chain.
2. If proceeding with a real deposit, explicitly approve the chosen amount once.
   Verify the successful chain receipt, exact asset increase and monitored plan.
3. Close/reopen the app. Confirm it recovers that plan without another approval.
4. Withdraw the test position and verify the receipt and updated balance. Lending
   fees, market movement and liquidity can affect redemption; this is not a
   guaranteed round trip of an identical amount.

## Optional notification delivery check

The tester may explicitly request their own test notification via Help →
notification settings → diagnostics → test notification. Record app acceptance
and actual phone receipt separately. Respect the two-per-day notification cap.
No message to an heir or other person is needed for this check.

## Record

| Field | Result |
| --- | --- |
| Device / OS / World App version / date | Pending |
| Guest navigation and legal links | Pending |
| Sign-in cancel → retry → success | Pending |
| Keyboard input and Done | Pending |
| Contact cancel / selection | Pending |
| Notification permission | Pending |
| Deposit cancel / no receipt | Pending |
| Approved deposit / receipt | Pending |
| Reopen without duplicate approval | Pending |
| Withdrawal / receipt | Pending |
| Self-test notification delivery (if performed) | Pending |

Record failures with the action and visible error. A user report is operator-
reported evidence; do not relabel it as an automated or independently observed test.

## Windows emulator installation attempt — 2026-10-24

After the operator completed Google Play sign-in, the Windows-native AVD
`inheritance-windows-play` (Android 15, Google Play API 35 image, advertised ABIs
`x86_64,arm64-v8a`) opened the official `com.worldcoin` store listing. The listing
was titled “World Money — Digital Wallet”, publisher TFH. UI automation observed
“Your device isn't compatible with this version.” No install button was available;
`pm list packages com.worldcoin` returned no installed package.

Windows WHPX and NVIDIA host rendering worked and Android boot completed. This
resolves the nested-virtualization setup issue, but does not establish World App
compatibility. ARM translation did not make this AVD eligible for store installation.
The store message does not identify the specific exclusion rule. World support
also documents discontinued x86 support; this alone does not prove the exact cause
of this store rejection. No actual World App acceptance checks were completed.

Source: https://support.world.org/hc/en-us/articles/16088035260691-What-devices-operating-systems-are-supported-by-World-Money

## Signed direct-install experiment — 2026-10-24

To test beyond the store compatibility filter, APKPure's ARM64 bundle for
`com.worldcoin` 4.0.4100 (versionCode 4004100, min SDK 32) was downloaded.
Each of its three APKs passed `apksigner verify` with v2/v3 integrity validation
and the app signer matched the certificate independently obtained over HTTPS
from https://world.org/.well-known/assetlinks.json:
`9D:2A:D7:12:7F:09:91:92:97:14:C0:19:5B:43:47:84:34:53:1C:D8:B7:F1:81:36:5C:2B:D5:CD:85:E3:46:EF`.
Google's source-stamp signer was distinguished from the app signer.

`adb install-multiple` succeeded on the Windows AVD. Starting
`com.worldcoin/.app.main.MainActivity` returned successfully, but the app then
terminated. The crash buffer identified `com.worldcoin` and an obfuscated
`FATAL EXCEPTION: Thread-2`; it did not establish the underlying cause.
No authentication, wallet, or Mini App acceptance was achieved. This older
version is a compatibility experiment, not current-release acceptance.
No binary patch, identity spoof, or attestation bypass was performed.

A separate BlueStacks installer from the vendor's official download page was
obtained and its Windows Authenticode signature validated (`Now.gg, INC`).
Installation completed; see the 2026-10-25 attempt below.

## BlueStacks retry — 2026-10-25

The operator approved Windows UAC. BlueStacks 5.22.285.1013 Pie64 (Android 9)
was running. Its configuration was backed up before enabling local ADB;
remote ADB remained disabled. Live ABIs included `armeabi-v7a` and `arm64-v8a`.
The APKPure 4.0.4401 ARM32 bundle's APK signatures and v2/v3 integrity had been
verified against the same official World certificate above. Installing the base,
ARM32, Korean and density splits with `adb install-multiple` returned `Success`.

The first launch failed with `FATAL EXCEPTION: Thread-2` in `com.worldcoin` at
13:28:35 device time. A force-stop and relaunch reproduced the same class of
obfuscated exception at 13:29:21. UI inspection returned to BlueStacks Gamecenter;
no World App login or Mini App screen was reached. These observations establish
failure on this tested BlueStacks instance, not failure of every possible PC
configuration. The exception does not identify its cause in readable form.
Actual World App acceptance remains incomplete. No resubmission was performed.
