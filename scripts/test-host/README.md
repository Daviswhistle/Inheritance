# Inheritance test host

Run the **real installed MiniKit SDK** and the unmodified miniapp against a small World App host implementation. The host implements the commands this app uses: sign-in, atomic transactions, permissions, contact selection and recorded-only chat. The SDK is not aliased to `minikit-stub.ts`.

## Start

Requirements: Node **22.13+** (the local auth handler uses `node:sqlite`) and dependencies installed in `app` (`pnpm --dir app install --frozen-lockfile`). If Foundry `forge` and `anvil` are not already on `PATH`, run the explicit setup once:

```sh
npm run test-host:setup
```

Setup installs official `@foundry-rs/forge` and `@foundry-rs/anvil` **1.7.1** into ignored `scripts/test-host/.tools`. It reuses npm's cache, changes no global tools or app lockfiles, and the launcher uses these binaries automatically. Existing `PATH` installations take precedence. Android Studio and Xcode are separate prerequisites only for native device shells.

```sh
npm run test-host
# or directly:
node scripts/test-host/start.mjs
```

The launcher compiles contracts, starts its own Anvil process on an unused loopback port, deploys the real WLD/USDC inheritance factories with mock tokens and Morpho strategies, and serves the app at **http://localhost:7777/**. Owner and heir start with 500 test WLD and 500 test USDC. Every launch creates a fresh chain. Ctrl+C stops only this launch's server and chain; no existing Anvil/Vite processes are killed and no `.env` files are changed.

```sh
node scripts/test-host/start.mjs --port=7777 --skip-build # reuse current contract artifacts
node scripts/test-host/start.mjs --lan                # allow phones on your trusted LAN
```

`--skip-build` assumes the existing `out` artifacts match the current contracts. LAN mode exposes disposable signing and time controls to the local network; keep this host off public tunnels. Anvil stays bound to loopback; phones only talk to the host's same-origin endpoints. Remote RPC URLs and existing production environment settings are not accepted.

## Browser, Android and iOS

The test entry installs the host before the app loads. Browser mode supports both bridge transports:

- `/?platform=android&account=owner`
- `/?platform=ios&account=heir`
- Add `&approval=auto` for automation. Default approval mode asks each time.

Use the native shells in [`test-hosts`](../../test-hosts/README.md) for actual Android WebView / iOS WKWebView rendering and native message transport. Android USB/emulator uses `adb reverse tcp:7777 tcp:7777` and `http://localhost:7777/`. iOS Simulator can use localhost. A physical iPhone uses the LAN URL printed by `--lan`, with Mac/phone on the same reachable network. WSL users may need Windows forwarding/firewall configuration before a phone can reach the printed address. Native shells select their platform automatically; the query parameter only chooses browser simulation.

## Operator controls

Tap the yellow **TEST** control to open the separate test operator panel.

1. Sign in as **Owner**. Approve the SDK's actual wallet-auth request in the panel; the backend signs it and the existing app auth handler verifies the signature and nonce.
2. Create a plan with both WLD and USDC and choose the displayed **Heir** address or `test_heir`. Approve the submitted transaction. The atomic delegated test wallet executes the batch in one real local transaction.
3. Inject **Reject next transaction**, **Reject next sign-in**, **Delay next transaction 10s**, or **Fail next transaction** before taking the corresponding app action. Inspect recent bridge commands and response state in the panel.
4. **Mock yield +10%** increases both mock strategy exchange rates. Reserve mock liquidity lets the actual contracts exercise income withdrawal. This is a deterministic scenario, not a predicted return.
5. **Time +31 days** crosses the default 30-day check-in period. Switch to **Heir**, sign in and request inheritance through the app. **Time +7 days** crosses the claim wait. Reload after a chain control change; the app reads actual changed chain state.
6. Switch back to Owner to test check-in/claim cancellation before transfer. Account switching clears the test sign-in session (preserving per-account recovery records) and reloads; copy the vault link first if testing recipient discovery by shared link.

Both devices share one local chain. Permission state and bridge fault injections belong to the current page. Notifications are simulated registrations; chat is recorded locally only. There is no automatic keeper, actual push notification delivery, real World Chat delivery or World ID implementation. External API fetches are blocked or explicitly simulated. Merkl APR/reward responses are empty, while mock strategy balances and yield are calculated on-chain.

## Automation interface

- `GET /__host/config`: fixture addresses (`owner`, `heir`, `wld`, `usdc`, `plain`, `wldFactory`, `usdcFactory`, `wldStrategy`, `usdcStrategy`, `batchWallet`), local chain ID and timestamp. No signing keys or RPC endpoint are returned.
- `POST /__host/control`: `{ "action": "time", "days": 1|7|31|91|181 }` or `{ "action": "yield" }`.
- `window.__INHERITANCE_TEST_HOST__`: `history`, `pending`, `approve(id)`, `reject(id)`, `rejectNext(command)`, `failNext(command)`, `delayNext(ms, command)`, `setApproval('manual'|'auto')`.
- `window.__INHERITANCE_TEST_CONFIG__`: the same fixture config.
- `npm run test-host:check`: browser/SDK/chain smoke verification (requires Foundry and Chrome; set `CHROME_BIN` to a Chrome-compatible executable if needed).
- `npm run test-host:unit`: SDK transport, native callback preservation and failure/abort checks.
- `npm run test:android-ui`: actual Android emulator WebView, native keyboard,
  rotation, background/resume, approval rejection and confirmed-plan recovery.
  Requires the debug APK and a running disposable emulator; see
  [Android setup and results](../../test-hosts/android/README.md).

`/__host/rpc` proxies only app read methods. Actual transactions are submitted by the test executor, with a distinct synthetic user-operation hash resolved to the canonical local receipt. Requests from other browser origins are rejected. This development configuration rejects production builds; `npm --prefix app run build` still uses `vite.config.ts`, so test bootstrap/controls/signing keys are not part of the production entry.

Passing here establishes our app/SDK/bridge contract and real local contract behavior. It does not establish compatibility with every actual World App version, bundler/paymaster policy, real Morpho market liquidity, or app-store distribution. Verify those integrations separately in World App.

## Verified on 2026-10-22

Six bridge tests and ten browser/chain integration checks passed on Linux with MiniKit 2.0.3 and Foundry 1.7.1. Integration covers actual app creation of both assets, real SIWE nonce verification/replay rejection, manual approval, rejection/delay, atomic rollback, income withdrawal preserving principal accounting, and both assets' claim/settlement after time travel. App typecheck, lint and production build passed; test-host markers and test signing keys were absent from the production bundle.

The smoke command's browser iOS transport mode uses Chromium. A separate
`npm run test:webkit-ui` suite now executes Linux WebKit with the real SDK's iOS
transport, including rotation-sized viewports, offline/reconnect and interrupted
approvals. See the [verification guide](../verify/README.md) for setup and evidence.
Linux WebKit is a second rendering engine, not an iPhone WKWebView execution.
See the [native host guide](../../test-hosts/README.md) for Android/iOS build and
execution requirements and their separately recorded validation status.

On 2026-10-23 KST, the Android 15 emulator run passed 17 native layouts and seven
scenario groups, with no JavaScript exceptions. The actual Android keyboard,
system Back, rotation, Home/foreground transitions, force-stop/relaunch and font
scale 1.3 were exercised. The test shell's rotation state loss, initial URL-field
keyboard activation and enlarged Open-button truncation were reproduced and fixed.
These results use AOSP WebView 124.0.6367.219, not World App's native approval UI.
