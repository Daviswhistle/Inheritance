# Mini App QA Checklist (World App)

This checklist is tailored for World App (iOS/Android) review.

## Build/Deploy
- [ ] App loads over HTTPS and sets `<meta name="minikit:app-id" content="...">`.
- [ ] Version used: `@worldcoin/minikit-js` ^1.9.6.
- [ ] `app/.env` exists; `VITE_FACTORY_ADDRESS` and `VITE_WLD_ADDRESS` match the deployed contracts.
- [ ] `VITE_FACTORY_DEPLOY_BLOCK` equals `receipt.blockNumber` in `broadcast/<ChainId>/<Block>/run-latest.json`.
- [ ] Fresh-clone check: `rm app/.env && pnpm --dir app build` renders the in-app "Configuration required" screen instead of a blank page.

## Authentication
- [ ] In‑World App only: state‑changing actions require `MiniKit.isInstalled()===true`. Outside World App the UI shows a gate and all action buttons are disabled.
- [ ] Login uses Wallet Auth only.
- [ ] **Login starts from a user tap.** Opening the app does not trigger `walletAuth` on its own — the mount effect must only initialise the bridge.
- [ ] Inside World App, Wallet Auth runs and the app shows the user handle (e.g. `@alice`) and loads balances.
- [ ] If `VITE_REQUIRE_VERIFY=true`: verification opens only *after* wallet login, and never gates any action button.
- [ ] Being an heir in another vault does **not** disable "Create vault".

## Scrolling (iOS & Android)
- [ ] Header is sticky; content scrolls underneath smoothly.
- [ ] Long pages scroll to the bottom; no scroll‑lock when returning from MiniKit sheets.
- [ ] iOS (WebView & Safari): momentum scrolling works; no rubber‑band lockups.
- [ ] Android (WebView & Chrome): no nested scroll traps; dynamic viewport respected.
- [ ] Cards are not flush against the sticky header and have spacing between them (`.py-4` / `.gap-4` must resolve).
- [ ] The Privacy/Terms/Support card clears the home indicator.

## Core Flows
- [ ] Create Vault: enter heir + period; confirm transaction in World App; app shows "Pending…" and marks complete only after on-chain confirmation; vault address appears; balances update.
- [ ] Deposit: enter amount, send transaction via MiniKit; app shows "Pending…" until the vault balance increases.
- [ ] Timer Controls: “Reset timer” sends transaction; app waits for `lastPing` to change, then marks success.
- [ ] Heir Claim: when `Claimable`, tapping Claim triggers transaction; app waits for vault WLD balance to reach 0.
- [ ] Owner Emergency Withdraw: withdraw before expiry; app waits for vault WLD balance to decrease.
- [ ] “Cancel (set heir to me)” is disabled after expiry (the contract rejects it with `Expired`).

## Edge Cases
- [ ] Invalid addresses show inline errors; buttons are disabled accordingly.
- [ ] A zero-address heir is rejected before sending a transaction.
- [ ] Insufficient wallet balance blocks deposit with friendly message.
- [ ] Release Slot: only offered once the factory reports support, and the contract requires the vault to be settled *and* empty (WLD, allowed tokens, and ETH all zero).
- [ ] If a release fails, the confirmation dialog stays open so the error is still readable.
- [ ] A wrongly-sent non-WLD ERC20 can still be recovered after expiry via `ownerRescueUnknownERC20`.

## Accessibility & UX
- [ ] Buttons have focus styles; labels are concise.
- [ ] Toasts display feedback and do not intercept gestures (pointer‑events: none).
- [ ] Status line and toasts announce updates to screen readers (`aria-live`).
- [ ] The details disclosure reports `aria-expanded`; the release modal is a labelled `aria-modal` dialog.
- [ ] User identity is shown as a World App username; raw addresses are hidden behind an “Advanced details” toggle.

## Contract Behaviour (covered by `forge test`)
- [ ] After expiry, `ping` / `updateHeir` / `updateHeartbeat` / `cancelInheritance` / `ownerWithdrawWLD` all revert with `Expired`.
- [ ] `claim` can execute only once; deposits made afterwards are not sweepable.
- [ ] A malicious ERC20 cannot re-enter the vault (`nonReentrant`).
- [ ] Non-standard tokens that return no data still transfer correctly.
- [ ] `receive` rejects plain ETH transfers.

## Devices
- [ ] Test on: iPhone (latest iOS) and Pixel/Samsung (Android 13+), inside World App.

## Submission Tips (iOS/Android)
- [ ] No third‑party font loads (Google Fonts); system fonts only.
- [ ] Visible links to Privacy Policy, Terms, and Support in‑app.
- [ ] Login is not gated behind verification.
