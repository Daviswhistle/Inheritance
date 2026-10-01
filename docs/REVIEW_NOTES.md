# Reviewer notes

App ID: `app_28c40a2a42b7f6c95789c2d5231b1314`
URL: https://inheritance.pages.dev/
Language: English. Platform: World App iOS and Android.

## Sign-in and custody

Tap **Continue with World App** to sign in; opening the app initializes the bridge without requesting a signature. World ID verification is not required. Pages verifies the MiniKit SIWE signature, origin, statement, chain and address, consumes a one-use random nonce in D1, and issues a one-hour session. The notification Worker independently verifies this session and current vault permissions. Expired sessions return to the sign-in screen.

User keys never reach our servers. Deposited WLD lives in a user's vault contract. User transactions go through the allowlisted WLD token and current or legacy factory, with World App approval. A dedicated infrastructure signer pays gas for eligible automated transfers; it cannot choose the recipient, file an heir's claim or withdraw an active owner's funds.

## The inheritance flow

1. Choose an heir from contacts, a username or an address and set a 1–365-day timer. Creating the vault deposits no WLD.
2. Use **Send** to deposit. Use **Vault** to renew, manage the heir or withdraw. **Tell your heir** offers World Chat and a shareable vault link. Notification permission is separate and is required on each recipient's World App.
3. After expiry the named heir files a claim. WLD stays in the vault for the fixed seven-day review window.
4. For registered new vaults, the service can execute the eligible transfer after the review window. Only the named heir receives the funds. Manual completion remains available. Legacy vaults require manual completion.
5. The owner can renew to cancel the claim until the actual transfer executes, including after the seven days. Transaction ordering determines which action wins.

Automation depends on registration, network/service availability, gas funding and spending caps. The interface shows service availability and keeps manual completion available. It does not promise execution at an exact time. A timer is not death verification, a legal will or an investment product.

## Interface and verification

The public landing explains the plan and opens World App; authenticated users have a four-tab mobile interface. Empty Vault/Send tabs stay hidden until a vault exists. Linked heir vaults remain distinct from the user's own vault. Discovery checks the authenticated monitoring index and bounded recent chain history; older unregistered vaults can be opened directly from a shared link. Current heir identity and canonical factory membership are checked before listing results.

MiniKit user-operation hashes are resolved through the official transaction-status API before waiting for the canonical transaction receipt. Success requires a successful receipt and observed contract outcome; cancellation, failed operations, timeout and unavailable refreshed state remain explicit. Duplicate action taps are blocked. Switching vaults immediately invalidates the prior roles and transaction route; new actions wait for canonical verification. Reauthentication restores a preserved shared-vault selection. System fonts, safe-area spacing, focus styles, labelled inputs, live status regions and a keyboard-accessible release dialog are provided.

Local verification uses real Anvil transactions, contract state, browser automation, actual Pages SIWE verification and SQLite-backed notification/automation paths. These tests do not certify native World App permission dialogs or real device behavior. Real iPhone/Android World App wallet approval and notification delivery remain external verification items. There is no independent third-party security audit; the app and store do not claim one.

Privacy and terms disclose session data, monitoring records, automatic transfer rules, risks and support. Source and contract information are linked from Help.
