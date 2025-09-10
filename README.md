# World Inheritance Vault (Mini App)

Non‑custodial inheritance vault for WLD, designed to run inside World App using MiniKit.

## Custody model (non‑custodial)
- Keys live in World App. This app never has access to private keys.
- All state‑changing actions are transaction requests via MiniKit and must be approved in World App.
- Funds live either in the user’s World App wallet or a per‑user vault contract.

## Run locally
1. Copy `.env` in the `app` folder and set the `VITE_*` values.
2. `pnpm i && pnpm dev` (or your preferred package manager).

## Mobile scrolling
This app uses dynamic viewport units (`svh/dvh`) and safe‑area padding to ensure reliable scrolling inside World App’s webview.
