# A plan with WLD and USDC

New plans ask for an heir, a check-in interval, and separate WLD and USDC
amounts. The configured primary Morpho routes are the default. The user reviews
the 10% positive-gain service fee and the lending/liquidity risks before any
deposit. The app creates missing asset contracts and manages them internally;
it does not convert between WLD and USDC.

Progress is saved per authenticated wallet in the tab. A completed asset is
never deposited again during resume. An interrupted request without a verified
result stays unresolved. Receipt logs must match the token, asset amount and
original personal contract before completion is shown. Yield vaults must remain
registered by their original trusted factory, even if their slot was released.
Submitted targets are never repointed at a replacement vault. Completed assets
are excluded from creation and deposit preflight; current balances may differ
after later owner withdrawals or settlement. Creation is proved by its original
receipt and immutable ownership, even when the owner later changes settings.

All active configured generations, including basic WLD vaults, participate in
the settings review. The approval records the exact target addresses, heir and
interval in seconds; changed targets require a fresh review. Exact contract
seconds are also retained when verifying the combined check-in. Settings requests
are saved before wallet submission with their original targets and block boundary.
The review discloses that an interval change also checks in to that vault.
Both execute atomically, starting the new interval from that check-in instead
of immediately expiring old funds. The journal records this requirement and
needs the matching Ping and interval events in the same canonical receipt.
An ambiguous response blocks editing and new requests until the original receipt
is verified. A confirmed revert or structured rejection before submission keeps
the remaining setup editable, including World App's daily transaction limit.
Removing an original settings route from configuration preserves its unresolved
journal and blocks new requests; it does not erase the recovery record.
The installed SDK's unavailable-command error also proves that no native request
was submitted, including outside World App. Setup remains editable after recovery.

Fresh balances are checked before any new wallet request. An oversized new
draft stays editable. A saved setup can be edited only when its creation and
unfinished deposits are proven unsent; completed deposits stay in place and
their amounts are not copied into a new draft. Ambiguous requests must first
be verified and cannot be cleared through this edit control.
Send also pauses additional deposits into a position with unfinished saved setup.
Resume the original request first, or edit a proven-unsent setup in Inherit. This
keeps another matching deposit from making the original receipt ambiguous.
Only new, ready deposits require fresh fee queries and consent. Completed assets
do not gate the remaining setup. Earlier receipts can be verified without consent
to a new deposit; any remaining new funds stay paused until consent is given and
that asset's live route terms are verified.

Each confirmed deposit receives monitoring independently of later assets.
Editing the remaining setup does not abandon already funded positions. The
registration uses the current canonical contract and heir; settled, cancelled
or replaced historical slots do not transfer monitoring to a replacement.
An unavailable monitoring backend times out and shows a Help reminder without
repeating funds or reverting the confirmed deposit.
If the user cancels a proven-unsent setup and later funds its new position through
ordinary Send, that confirmed deposit also requests monitoring. Registration runs
independently so a delayed backend response does not block switching assets.

The overview totals assets in their own units, includes held WLD rewards and gifts
inside USDC positions in the WLD total, and offers a combined check-in. Its asset
management action opens the owner's position even when a shared heir link was
previously selected.
Asset management contains income collection and a separate principal withdrawal.
Income is quoted by the contract, retains principal/loss accounting and the
inheritance timer, and uses a 99.5% minimum of the available net quote. Existing
contracts without this API show that limitation and retain their withdrawal
controls. Legacy Morpho generations remain discoverable through configured
legacy routes. New plans use the primary factories; saved plans resume their
original trusted routes. Income availability is probed independently of the
factory generation, so a rotated income-capable vault retains that control.

Run `node scripts/verify/unified-plan.mjs` and
`node scripts/test-legacy-yield-routes.mjs` for focused local checks. Run
`node scripts/verify/unified-plan-browser.mjs` with supplied income-capable
Foundry artifacts for the browser flow. The latter uses actual local Anvil
contracts, real SIWE handlers, local monitoring HTTP fixtures, and an EIP-7702 test account to emulate atomic
MiniKit batch receipts. It does not assert that World App uses EIP-7702 or prove
World App sponsorship, Portal allowlisting, real Merkl entitlement or production
deployment. Its screenshots and receipts are saved under `/tmp/wld-unified-plan`.
