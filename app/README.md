# World Inheritance Vault (Mini App)

Non‑custodial inheritance vault for WLD, designed to run inside World App using MiniKit.

## Custody model (non‑custodial)
- Keys live in World App. This app never has access to private keys.
- All state‑changing actions are transaction requests via MiniKit and must be approved in World App.
- Funds live either in the user’s World App wallet or a per‑user vault contract.

## Run locally
1. `cp .env.example .env` and fill in the `VITE_*` values.
   At minimum `VITE_FACTORY_ADDRESS` and `VITE_WLD_ADDRESS` are required —
   without them the app renders a setup screen explaining what is missing
   rather than failing silently.
2. `pnpm i && pnpm dev` (or your preferred package manager).

`VITE_FACTORY_DEPLOY_BLOCK` should be the factory's deployment block. It is used
as the `fromBlock` for `VaultCreated` log queries, so a wrong value silently
hides vaults from the heir search.

## World App notifications
- Set `VITE_NOTIFY_BACKEND_URL` in `app/.env` to enable notification registration UI.
  - local example: `http://localhost:8787`
  - deployed example: `https://world-inheritance-notify.<subdomain>.workers.dev`
- The backend endpoint is optional for core vault logic, but required for push notification delivery.
- Notification backend is implemented as Cloudflare Workers + D1 + Cron (see `backend/README.md`).
- Heirs must open the mini app at least once and enable notifications on their wallet to receive push alerts.

## Mobile scrolling
This app uses dynamic viewport units (`svh/dvh`) and safe‑area padding to ensure reliable scrolling inside World App’s webview. The outer `.app-shell` is the scroll container with `overflow-y: auto; -webkit-overflow-scrolling: touch;` to avoid host WebView quirks on iOS/Android.

Note: `src/index.css` is a hand‑written utility set, **not** Tailwind. An undefined
class fails silently instead of erroring, so when you add a `className` check that
the selector actually exists. `.app-shell` repeats `min-height`, so declaration
order decides the winner (static `100vh` fallback first, then `svh`, then `dvh`).

## Auth & verification
- Login uses Wallet Auth (`MiniKit.commandsAsync.walletAuth`) only.
- Login always starts from a user tap. The mount effect only initialises the
  MiniKit bridge; it never calls `walletAuth` on its own.
- A previously saved address is restored from `localStorage` for display. This
  involves no signature and is not an auth gate.
- Verification, if required by policy, is requested only after the user is connected (never as a login gate).
- Being an heir in someone else's vault does not block creating your own vault.
