# Actual World App acceptance

Status: awaiting operator test results. Do not check a step from a simulated
bridge, Linux browser, native test host, or on-chain fork result.

Open [Inheritance in World App](https://world.org/mini-app?app_id=app_28c40a2a42b7f6c95789c2d5231b1314).
Record the device model, OS version, World App version, date and UI language.
The current runtime is `a56335f8a978db1dda9b154b3a606b5de74382ae`.

## Available installation environment

The original AOSP test host remains at `emulator-5554`. A separate official
Android Emulator device, `inheritance-worldapp-play` (`emulator-5556`), now runs
Android 15 Google Play revision 9. Live properties confirm `x86_64,arm64-v8a`,
`libndk_translation.so` and build type `user`. Play Store is installed and its
sign-in screen is visible in a desktop window. Google account login is pending.
This corrects the earlier assumption that the x86 host alone ruled out local
World App execution: the Google Play image has ARM translation that the original
AOSP image lacked. World App installation, device checks and login still need
to succeed before this environment can supply actual SDK-host evidence.

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
