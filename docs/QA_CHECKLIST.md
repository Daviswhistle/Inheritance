# Mini App QA Checklist (World App)

This checklist is tailored for World App (iOS/Android) review.

## Build/Deploy
- App loads over HTTPS and sets `<meta name="minikit:app-id" content="...">`.
- Version used: `@worldcoin/minikit-js` ^1.9.6.

-## Authentication
- In‑World App only: state‑changing actions require `MiniKit.isInstalled()===true`. Outside World App the UI shows a gate and all action buttons are disabled.
- Login uses Wallet Auth only:
  - Inside World App, Wallet Auth runs and the app shows the user handle (e.g., `@alice`) and loads balances.
- If `VITE_REQUIRE_VERIFY=true` (optional policy gate):
  - After login, tapping “Verify in World App” opens verification.
  - Verification never appears before wallet login.

## Scrolling (iOS & Android)
- Header is sticky; content scrolls underneath smoothly.
- Long pages scroll to the bottom; no scroll‑lock when returning from MiniKit sheets.
- iOS (WebView & Safari): momentum scrolling works; no rubber‑band lockups.
- Android (WebView & Chrome): no nested scroll traps; dynamic viewport respected.

## Core Flows
- Create Vault: enter heir + period; confirm transaction in World App; app shows "Pending…" and marks complete only after on-chain confirmation; vault address appears; balances update.
- Deposit: enter amount, send transaction via MiniKit; app shows "Pending…" until the vault balance increases.
- Timer Controls: “Reset timer” sends transaction; app waits for `lastPing` to change, then marks success.
- Heir Claim: when `Claimable`, tapping Claim triggers transaction; app waits for vault WLD balance to decrease to 0 (or by the expected amount).
- Owner Emergency Withdraw: withdraw before expiry; app waits for vault WLD balance to decrease.

## Edge Cases
- Invalid addresses show inline errors; buttons are disabled accordingly.
- Insufficient wallet balance blocks deposit with friendly message.
- Release Slot (if supported by factory): only enabled after expiry and when vault balance is 0.

## Accessibility & UX
- Buttons have focus styles; labels are concise.
- Toasts display feedback and do not intercept gestures (pointer‑events: none).
- User identity is shown as a World App username; raw addresses are hidden behind an “Advanced details” toggle.

## Devices
- Test on: iPhone (latest iOS) and Pixel/Samsung (Android 13+), inside World App.

## Submission Tips (iOS/Android)
- Remove third‑party font loads (Google Fonts); use system fonts.
- Provide visible links to Privacy Policy, Terms, and Support in‑app.
- Do not gate login behind verification; verify only after wallet login if needed.
