# Release verification

Use current evidence, not checked boxes copied from a previous release. Local release results and acceptance criteria are in `docs/RELEASE.md`; deployment receipts are the GitHub Actions runs for the exact release commit. Verify live automation separately through its health cycle.

## Required local checks

- Foundry formatting, contract build and full suite; generated custom error ABI matches.
- Frontend typecheck, lint, build, CSS class mapping and English-only visible copy.
- Actual SDK SIWE signatures: one-use nonce replay rejection, session expiry and foreign origin/wallet rejection.
- Notification APIs: anonymous/foreign-wallet denial, canonical current/legacy vault checks, owner-only unregister, own-wallet-only test, durable rate limits, alert cooldown persistence and terminal retirement.
- Dedicated finalizer: canonical vault/token/chain, pre-seven-day refusal, renewal cancels pending transfer, fixed recipient, concurrent lease protection, atomic budget/transaction staging, interrupted database acknowledgement, pending receipt recovery, funding/fee/daily caps, actual fees and unknown fee fail-closed behavior.
- MiniKit user-operation to canonical receipt resolution; failures and absent refreshed state cannot report success.
- Unified WLD/USDC plan: exact token decimals, explicit yield consent, completed-asset preservation, definitive failure retry and unresolved-operation duplicate prevention. Failed or silently discarded recovery storage must stop before a wallet request. Recovery verifies historical canonical receipts even after later withdrawals, scans from the saved submission block and retains the original trusted factory after rotation. A changed settings-review target list invalidates the prior approval.
- Unified recovery regressions: include every active configured generation in settings review, preserve exact interval seconds, check all remaining balances before creation, retain submitted original vault addresses after slot replacement, and exclude completed assets from new creation. Only proven-unsent setup can be edited; completed amounts are excluded from the new draft.
- Settings requests retain their original targets before submission. Ambiguous requests survive reload and block editing; canonical success or failure resolves only the original request. Daily wallet-policy rejections remain editable. Creation receipt recovery is independent of later heir/period edits. WLD totals include held WLD in USDC positions, and personal management opens the owner's position from a shared link.
- Confirmed deposits receive monitoring even when a later asset fails or the user edits only the remaining setup. A missing original settings route keeps its unresolved journal and blocks new wallet requests instead of deleting progress.
- Send blocks new deposits into a position with unfinished saved setup, including a lost response for an executed deposit. The original receipt must remain uniquely recoverable. A new position funded through ordinary Send after cancelled setup receives monitoring, and a delayed registration response must not block switching assets.
- Shortening an old, funded vault's interval requires disclosed consent and an atomic check-in before the period change. Unselected funds must remain active. A period-only receipt cannot resolve a journal that requires the check-in.
- Use the installed SDK's real command errors in the browser fixture. Unsupported or unavailable commands must remain editable before native handoff. Completed assets' fee queries cannot block remaining deposits; receipt verification proceeds without fresh deposit consent, and new funds stay paused until that consent and live route checks pass.
- Income-only collection preserves principal basis and inheritance timers, charges 10% of realized gains and uses the personal vault's canonical income event. A legacy route with a supporting deployed income API retains that feature; contracts without it keep their original controls.
- Guarded gas funding: fixed operator assets and recipients, actual WLD/USDC route comparison, economical batches, atomic refunds, signer-wide pending recovery, price checks and daily operating budget without a lifetime quota.
- Fresh-chain browser suite: creation, deposit, renewal, management, claim, completion, residue sweep, release/recreate, linked-vault owner/heir separation, delayed dual-factory selection, linked-vault reauthentication, cancellation and chain outage/recovery.
- Responsive inspection at 320px, 390px and desktop; footer controls accessible above the safe area; store images generated from current UI.

- Amount-first creation: “Review plan” sends no wallet request, preserves exact 18/6-decimal amounts and the full resolved heir, and “Edit plan” restores input focus. Final confirmation retains durable recovery and pending-wallet guards.
- Home/Assets/Plan navigation: token selection retains canonical routing, earlier balances remain reachable, a shared balance identifies its owner, and income/principal controls remain separate. Asset switches clear custom income destinations and render one income card.
- Audit both default and expanded disclosures; closed descendants must not be counted as visible controls. Inspect at 320px as well as 390px, including the final approval screen.

## Remote checks

- Factory deployment receipt and runtime bytecode match the reviewed artifact, WLD address and chain480.
- Hosted cron runtime: inspect invocation outcome and CPU time, then confirm advancing successful automation cycles. An HTTP 200 and local executor tests do not clear an `exceededCpu` failure; verify the actual account resource limits before release.
- Current and legacy factory addresses/block numbers agree across frontend, Worker, GitHub variables and portal allowlist.
- Shared D1 migration and shared session secret applied; deployed nonce and replay behavior match local checks.
- Exact pushed commit has successful CI and Pages/Worker deploy runs; public pages and assets resolve.
- Cron actually advances finalizer cycle status, dedicated signer is funded, gas caps are present and no secrets are in the public bundle.
- Portal descriptions/images match actual rules; record actual review-submission status without claiming approval.

## External evidence still needed

Native World App iOS/Android wallet approvals, permission dialogs, contacts and recipient notification delivery must be tested on real devices. A local MiniKit bridge stub cannot verify those surfaces. Store approval is a separate external decision. No independent external contract audit has been performed.
