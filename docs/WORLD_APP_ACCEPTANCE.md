# Actual World App acceptance

Status: physical Android checks observed on October 25 and 27, 2026, including
one successful user-approved WLD deposit, close/reopen recovery and principal
withdrawal. This is acceptance of the observed flows, not proof of every asset,
claim path or physical iPhone behavior. Native test hosts simulate the wallet
host; their results are recorded separately.

Open [Inheritance in World App](https://world.org/mini-app?app_id=app_28c40a2a42b7f6c95789c2d5231b1314).
Record the device model, OS version, World App version, date and UI language.
The October 27 real-money test used runtime
`e4be10c5225cd05504c3cb3f02082f16b1b4a623`. Current deployed source and exact
CI/native-test results are in [RELEASE.md](RELEASE.md).

## Physical device — October 25 and 27, 2026

The user connected a Samsung SM-S911N running Android 16, with World Money
(`com.worldcoin`) 4.0.4401 / versionCode 4004401. The Mini App used English and
the native World App used Korean. The user explicitly authorized ADB screen
inspection and tap/input. The user entered credentials directly; captures and
mirroring stopped during credential entry. Financial/contact screenshots remain
private and are not committed.

The official app-ID deep link opened the actual Inheritance Mini App. Home,
Assets, Plan and Help were distinct before authentication and did not open a
wallet request from navigation. Terms and Privacy bodies loaded in-app. Closing
wallet sign-in returned to the guest interface with “You cancelled sign-in”;
retry opened the native request, and user-completed authentication rendered the
username and live wallet data. A draft `0.01 WLD` remained after the app's Done
button dismissed the native numeric keyboard. This entered amount did not send
a transaction.

The previous runtime left “Opening…” after contact X or Android Back cancellation,
and titled Privacy as Terms after the canonical redirect. After deployment of
`37df75d`, the actual phone showed the correct Privacy Policy modal title.
Cancelling native contacts returned to a recoverable waiting state; explicit
Cancel selection and enter manually focused the input. Typed input was preserved
and the app rejected the owner's own username as a recipient. The terminal button
no longer claimed Opening. Close/reopen reset unsubmitted details and restored
native contacts. The user selected a contact, and its username and resolved
address appeared correctly. No invitation or message was sent.

After explicit user authorization, exactly one self-test notification was
requested at 14:48 KST. The app reported delivery, and the physical phone's
notification shade separately displayed the Inheritance test message. No heir
or other contact was messaged. The native menu offered Mute notifications; no
new permission-grant dialog was observed. The old runtime still displayed a
misleading version error on Enable reminders and an indefinite monitoring-status
message when no plan was open. The deployed fix now reports Notifications are on for this wallet. Repeating
Enable reminders returned the same success without the misleading version error.
No additional self-test was sent and no fresh permission-grant dialog was needed.

On October 25 the native approval for `0.01 WLD` quoted `0.094 WLD` in
network fees and was cancelled before authorization. The saved plan remained
editable; a read-only factory query returned no owner vault. This is a
historical cancellation result, not the outcome of the later approved deposit.

On October 27 the user authorized the necessary test transaction and personally
completed the native wallet approval for `0.01 WLD` plus a quoted `0.098 WLD`
network fee. The privately retained successful canonical receipt confirms the
full `0.01 WLD` principal reached the newly created vault. The WLD fee reserve
was partly refunded: the actual net network charge was
`0.063726535762749712 WLD`, and the deposit transaction's total wallet debit was
`0.073726535762749712 WLD`. The `0.108 WLD` quote sum was an estimate, not the
settled debit. Private receipts identify the single owner UserOperation and its
fee/refund transfers; tester-linked addresses, transaction hashes and screenshots
are deliberately excluded from this public record.

Closing and reopening the actual Mini App required sign-in but restored the
funded 30-day plan and `0.01 WLD` position without another deposit approval.
The user then personally approved withdrawal to their own wallet. The privately retained canonical
receipt confirms `0.010000000000056801 WLD` returned; this
transaction charged the owner no WLD network fee. The round-trip network cost
was therefore `0.063726535762749712 WLD`.

The withdrawal recovered the original principal and a small positive return,
but left `2923` token wei (`0.000000000000002923 WLD`) in the vault. A balance
refresh after tapping All changed the gross quote and caused the existing UI to
choose a partial withdrawal. The follow-up fix and fixture regression are recorded
in [RELEASE.md](RELEASE.md); no additional live transaction is claimed to clear
that residual. Do not describe the real test as a zero-share full exit.

Only this test WLD position was used. Unrelated existing wallet-held USDC receipt
shares were not redeemed. No new invitation or notification was sent. The initial
zero-extra-cost restriction was superseded for the approved test; it is not an
unlimited spending permission. Future financial actions still require scoped
amount/cost authorization. The user later authorized agent-handled confirmation
and authentication steps; unavailable PIN or biometric input still needs the human.

Mac environment inspection is complete. Use this connected phone; no emulator
retry is needed. Earlier Windows installation experiments below are historical.

## Mac actual-host installation check — October 28, 2026

The M4 MacBook Air runs macOS 27.0.1 and Xcode 27.1. Native host tests on this
Mac and CI establish the recorded WebKit/MiniKit transport behavior, not the
World Money App Store binary. The official
[World Money listing](https://apps.apple.com/kr/app/world-money-digital-wallet/id1560859847)
was opened and its compatibility section expanded: iPhone iOS 16.4+ and Apple
Vision visionOS 1.0+ were listed, with no Mac entry. The Mac App Store was also
searched under Mac apps and iPhone/iPad apps; no verified World Money install
action was offered in the observed results.

iPhone Mirroring reported that it could not connect to an eligible nearby
iPhone. Xcode's three same-machine iPhone records matched local simulator IDs;
no USB/network physical iPhone was found. No account, security setting or
application binary was modified to bypass these limits. No public official
World Money simulator build was found; that does not establish that TFH cannot
provide a developer build. An official simulator/Mac-enabled beta or a reachable
physical iPhone is the next supported route to additional actual iOS host testing.
The existing native iOS Simulator and actual Android evidence remains valid;
lack of a physical iPhone alone is not treated as a submission blocker.

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
There is no automatic test deposit. Record token, amount and canonical receipt privately. Do not publish tester-linked
transaction details without permission; never record a private key, seed phrase,
session token or sign-in signature.

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
| Device / OS / World App version / date | SM-S911N / Android 16 / World Money 4.0.4401 / October 25 and 27, 2026 |
| Guest navigation and legal links | Guest navigation observed; deployed Privacy modal title and close passed |
| Sign-in cancel → retry → success | Observed native cancel/retry; user completed login, authenticated UI independently observed |
| Keyboard input and Done | Observed: draft 0.01 WLD retained, keyboard dismissed, no transaction |
| Contact cancel / selection | Deployed manual recovery, own-recipient rejection and native selected username/address passed |
| Notification permission | Existing permission, deployed status and Enable reminders retry passed; no new grant dialog |
| Deposit cancel / no receipt | Native 0.01 WLD request cancelled; 0.094 WLD network quote; editable saved plan and zero factory vault confirmed |
| Approved deposit / receipt | October 27: canonical success; full 0.01 WLD principal in new vault; actual network fee 0.063726535762749712 WLD |
| Reopen without duplicate approval | Actual close/reopen and sign-in restored funded 30-day plan; no second deposit request |
| Withdrawal / receipt | Canonical success; 0.010000000000056801 WLD returned, no owner WLD network fee; 2923 wei residual remains, so not a zero-share full exit |
| Self-test notification delivery (if performed) | One authorized test: app acceptance and actual phone receipt observed separately, 14:48 KST |

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
As of this October 25 BlueStacks experiment, actual World App acceptance was
incomplete and no resubmission had been performed. The later physical Android
results above supersede that device-testing gap only for their observed flows.
