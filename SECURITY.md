# Security & Custody

This mini app is designed to operate fully non‑custodially within World App.

- User keys stay in World App. The app never collects a user's seed phrase or private key.
- Wallet setup, deposits, owner management and heir claims require World App approval. After the named heir files a claim and the fixed seven-day review passes, a registered new vault is eligible for a permissionless transfer to that heir. The owner can renew until the transfer executes. Legacy vaults require manual completion.
- Deposits move WLD to an isolated per-user vault contract. Our dedicated gas-only service signer can execute an eligible new-vault transfer, but cannot initiate the heir's claim, redirect funds or withdraw an active owner's balance.
- Reads use public World Chain RPC. Automation has bounded gas and spending caps, durable transaction recovery and canonical finalized-receipt checks. Funding, queues and network or service failures can delay execution; the manual heir path remains available.

Threat model highlights
- No server-held user keys or pooled WLD custody. The infrastructure wallet holds only execution gas.
- No off‑chain balances; only on‑chain balances in the user wallet or the user’s vault.
- No batched custody; each user owns an isolated vault contract address.

Responsible disclosure: please open a security‑labelled GitHub issue or email the maintainer if you find a vulnerability.
No independent third-party security audit has been performed. Contract tests and internal review are release evidence, not an audit claim.

Notification access is authenticated separately from blockchain transactions. Pages
verifies World App SIWE signatures, the exact application origin, sign-in statement,
chain and wallet address. A random nonce is stored as a hash in D1, expires after ten
minutes and is consumed atomically once, only after verification. The resulting HMAC
session is wallet-bound, has the fixed frontend origin as its audience and expires
after one hour. Pages and the notification Worker must share the same `SIWE_SECRET`
and D1 database; missing configuration fails closed.
Anonymous nonce issuance is capped per trusted Cloudflare connection address using
short-lived HMAC rate keys; raw connection addresses are not stored by the app.

Every notification API requires that session. Vault access is checked against the
current onchain owner or heir, the configured WLD token, an explicitly trusted current
or legacy factory, and that factory's `vaultOf(owner)` mapping. Only the owner can
disable a watcher. Test messages use fixed text and can reach only the signed-in wallet.
Persistent request limits, per-wallet test/manual-check cooldowns, vault leases and
delivery-attempt records restrict abuse and repeated delivery across Worker instances.
Notification credentials are stored in tab-scoped `sessionStorage`, cleared on logout
or authentication rejection, and cannot authorize a blockchain transfer.
Completed claims are proved by the required onchain `claimedAt` read. Completed vaults
grant access only to their owner while their canonical factory mapping remains valid.
Their watchers are deactivated and preserve delivery history. A released factory slot
continues to deny API access and retires the stale watcher; RPC failures grant no new
access and do not establish settlement or release.
