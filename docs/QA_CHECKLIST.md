# Release verification

Use current evidence, not checked boxes copied from a previous release. Local release results and acceptance criteria are in `docs/RELEASE.md`; deployment receipts are the GitHub Actions runs for the exact release commit. Verify live automation separately through its health cycle.

## Required local checks

- Foundry formatting, contract build and full suite; generated custom error ABI matches.
- Frontend typecheck, lint, build, CSS class mapping and English-only visible copy.
- Actual SDK SIWE signatures: one-use nonce replay rejection, session expiry and foreign origin/wallet rejection.
- Notification APIs: anonymous/foreign-wallet denial, canonical current/legacy vault checks, owner-only unregister, own-wallet-only test, durable rate limits, alert cooldown persistence and terminal retirement.
- Dedicated finalizer: canonical vault/token/chain, pre-seven-day refusal, renewal cancels pending transfer, fixed recipient, concurrent lease protection, atomic budget/transaction staging, interrupted database acknowledgement, pending receipt recovery, funding/fee/daily caps, actual fees and unknown fee fail-closed behavior.
- MiniKit user-operation to canonical receipt resolution; failures and absent refreshed state cannot report success.
- Fresh-chain browser suite: creation, deposit, renewal, management, claim, completion, residue sweep, release/recreate, linked-vault owner/heir separation, delayed dual-factory selection, linked-vault reauthentication, cancellation and chain outage/recovery.
- Responsive inspection at 320px, 390px and desktop; footer controls accessible above the safe area; store images generated from current UI.

## Remote checks

- Factory deployment receipt and runtime bytecode match the reviewed artifact, WLD address and chain480.
- Current and legacy factory addresses/block numbers agree across frontend, Worker, GitHub variables and portal allowlist.
- Shared D1 migration and shared session secret applied; deployed nonce and replay behavior match local checks.
- Exact pushed commit has successful CI and Pages/Worker deploy runs; public pages and assets resolve.
- Cron actually advances finalizer cycle status, dedicated signer is funded, gas caps are present and no secrets are in the public bundle.
- Portal descriptions/images match actual rules; record actual review-submission status without claiming approval.

## External evidence still needed

Native World App iOS/Android wallet approvals, permission dialogs, contacts and recipient notification delivery must be tested on real devices. A local MiniKit bridge stub cannot verify those surfaces. Store approval is a separate external decision. No independent external contract audit has been performed.
