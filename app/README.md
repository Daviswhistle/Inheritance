# World Inheritance Vault (Mini App)

Non‑custodial inheritance vault for WLD, designed to run inside World App using MiniKit.

## Custody model (non‑custodial)
- Keys live in World App. This app never has access to private keys.
- All state‑changing actions are transaction requests via MiniKit and must be approved in World App.
- Funds live either in the user’s World App wallet or a per‑user vault contract.

## Run locally
1. Copy `.env` in the `app` folder and set the `VITE_*` values.
2. `pnpm i && pnpm dev` (or your preferred package manager).

## World App notifications
- Set `VITE_NOTIFY_BACKEND_URL` in `app/.env` to enable notification registration UI.
  - local example: `http://localhost:8787`
  - deployed example: `https://world-inheritance-notify.<subdomain>.workers.dev`
- The backend endpoint is optional for core vault logic, but required for push notification delivery.
- Notification backend is implemented as Cloudflare Workers + D1 + Cron (see `backend/README.md`).
- Heirs must open the mini app at least once and enable notifications on their wallet to receive push alerts.

## Mobile scrolling
This app uses dynamic viewport units (`svh/dvh`) and safe‑area padding to ensure reliable scrolling inside World App’s webview. The outer `.app-shell` is the scroll container with `overflow-y: auto; -webkit-overflow-scrolling: touch;` to avoid host WebView quirks on iOS/Android.

## Auth & verification
- Login uses Wallet Auth (`MiniKit.commandsAsync.walletAuth`) only.
- Verification, if required by policy, is requested only after the user is connected (never as a login gate).
