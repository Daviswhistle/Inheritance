# Reviewer Notes

This mini app runs inside World App using World App MiniKit.

## Custody model
- Non‑custodial: The app never holds user assets or keys.
- Transactions are initiated via `@worldcoin/minikit-js` (MiniKit) and must be approved by the user in World App.
- Funds live either in the user’s World App wallet or their per‑user vault contract deployed by the factory. No pooled or server custody.

Relevant implementation points
- Login: uses `MiniKit.commandsAsync.walletAuth` exclusively for login/session. No verification flow is used as a login gate.
- Optional verification (post‑login only): if `VITE_REQUIRE_VERIFY=true`, the app requests `MiniKit.commandsAsync.verify` AFTER a successful wallet login. Users can also trigger verification explicitly via the CTA once connected.
- No auto‑connect on load; wallet auth is triggered by a user tap.
- User identity surfaces the World App username (if available) instead of showing the full wallet address; full addresses are available behind an “Advanced details” toggle.
- Transaction confirmation: every MiniKit `sendTransaction` path sets a pending state and waits for on‑chain confirmation via `provider.waitForTransaction(...)` or a state/event poll (`waitForTxOrEvent`) before marking the action complete.
- Sends: `MiniKit.commandsAsync.sendTransaction` is used for all state‑changing calls (create vault, deposit, extend timer, withdraw, claim).
- Optional desktop/dev signer paths exist for local testing only; in production the app expects World App + MiniKit.

## Scrolling fixes (World App WebView)
- Replaced `min-h-screen` wrapper with `.app-shell` that uses dynamic viewport units (`svh`/`dvh`) to avoid iOS/Android UI chrome height bugs.
- Added `html { height: -webkit-fill-available }` and `body { -webkit-overflow-scrolling: touch; overflow-y: auto; margin: 0 }` to ensure reliable scrolling.
- Ensured fixed toasts do not intercept gestures (`pointer-events: none`).
- Added bottom safe‑area padding utility (`.safe-pb`) and applied it to the main container.

Tested scenarios (manual)
- iOS Safari and in‑app webview: content scrolls with sticky header; no scroll lock.
- Android Chrome/WebView: no overscroll blocking; dynamic viewport respected.

Additional review items
- Remote font loads removed; only system fonts are used.
- In‑app links to Privacy Policy, Terms, and Support are present.
