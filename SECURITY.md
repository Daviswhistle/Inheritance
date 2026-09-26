# Security & Custody

This mini app is designed to operate fully non‑custodially within World App.

- Keys are held only by the user in World App. The app never has access to seed phrases or private keys.
- All state‑changing actions are submitted as transaction requests via World App MiniKit; users must approve in World App for anything to execute.
- Deposits move WLD from the user’s wallet to a per‑user vault smart contract. Before the expiry timer, only the owner can withdraw; after expiry, the designated heir can claim. The app backend (if any) cannot move funds.
- Reads use a public RPC for chain data. No server‑side signing or delegated custody is implemented.

Threat model highlights
- No server‑side hot wallets.
- No off‑chain balances; only on‑chain balances in the user wallet or the user’s vault.
- No batched custody; each user owns an isolated vault contract address.

Responsible disclosure: please open a security‑labelled GitHub issue or email the maintainer if you find a vulnerability.

