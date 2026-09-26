# Reviewer Notes

This mini app runs inside World App using World App MiniKit.

## Custody model
- Non‑custodial: The app never holds user assets or keys.
- Transactions are initiated via `@worldcoin/minikit-js` (MiniKit) and must be approved by the user in World App.
- Funds live either in the user’s World App wallet or their per‑user vault contract deployed by the factory. No pooled or server custody.

Relevant implementation points
- Login: uses `MiniKit.commandsAsync.walletAuth` exclusively for login/session. No verification flow is used as a login gate.
- Optional verification (post‑login only): if `VITE_REQUIRE_VERIFY=true`, the app requests `MiniKit.commandsAsync.verify` AFTER a successful wallet login. Users can also trigger verification explicitly via the CTA once connected.
- No auto‑connect on load; wallet auth is triggered by a user tap. The mount effect only initialises the MiniKit bridge. A previously saved address is restored from `localStorage` for display, which involves no signature and is not an auth gate.
- Being an heir in someone else's vault does not prevent creating your own vault. Heir vaults are only surfaced through the explicit “Find vaults where I am heir” action.
- User identity surfaces the World App username (if available) instead of showing the full wallet address; full addresses are available behind an “Advanced details” toggle.
- Transaction confirmation: every MiniKit `sendTransaction` path sets a pending state, waits for the on‑chain receipt via `provider.waitForTransaction(...)`, and then polls a state predicate (`waitForTxOrEvent`) before marking the action complete. A missing provider raises an error rather than skipping the wait.
- Sends: `MiniKit.commandsAsync.sendTransaction` is used for all state‑changing calls (create vault, deposit, extend timer, withdraw, claim).
- There is no desktop/dev signer path in the frontend; all writes go through World App + MiniKit. Reading uses a plain read‑only JSON‑RPC provider.
- Environment variables are validated at startup (`app/src/config.ts`). A missing or malformed address renders an in‑app setup screen instead of failing silently; an unexpected runtime error is caught by an error boundary.
- Fonts: system fonts only, no remote font loads.

## Scrolling fixes (World App WebView)
- Replaced `min-h-screen` wrapper with `.app-shell` that uses dynamic viewport units (`svh`/`dvh`) to avoid iOS/Android UI chrome height bugs.
- Added `html { height: -webkit-fill-available }` and `body { -webkit-overflow-scrolling: touch; overflow-y: auto; margin: 0 }` to ensure reliable scrolling.
- Ensured fixed toasts do not intercept gestures (`pointer-events: none`).
- Added bottom safe‑area padding utility (`.safe-pb`) and applied it to the main container.

Tested scenarios (manual)
- iOS Safari and in‑app webview: content scrolls with sticky header; no scroll lock.
- Android Chrome/WebView: no overscroll blocking; dynamic viewport respected.

CSS notes
- `app/src/index.css` is a hand‑written utility set, not Tailwind. An undefined class fails silently, so every `className` in the JSX was cross‑checked against the selectors in that file.
- `.app-shell` declares `100vh` → `100svh` → `100dvh`. Order matters because it is the same property repeated; the static fallback must come first or it wins and re‑introduces the iOS URL‑bar height bug.
- Responsive variants must live inside their breakpoint. `sm:inline` was previously top‑level, where it tied with `.hidden` on specificity and won on order, so it never hid anything.

Additional review items
- Remote font loads removed; only system fonts are used.
- In‑app links to Privacy Policy, Terms, and Support are present.
- The status line and toasts are `aria-live` regions; the details disclosure reports `aria-expanded`; the release modal is a labelled `aria-modal` dialog.
- 5 unused npm dependencies and 2 dead template files were removed.
