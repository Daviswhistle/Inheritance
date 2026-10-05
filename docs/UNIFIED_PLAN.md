# A plan with WLD and USDC

New plans ask for WLD and USDC amounts first, then an heir and a check-in
interval. Users do not choose or create individual vaults. The configured primary
Morpho routes are the default. The user reviews
the 10% positive-gain service fee, the separately verified Morpho strategy fee
and the lending/liquidity risks before any deposit. Strategy fees are already
reflected in Morpho share value before the service fee; the two percentages
are not added as a flat fee. A changed verified strategy fee invalidates
the prior review. Fresh reads before each new wallet request are compared with
the exact reviewed or explicitly consented rates; a mismatch clears consent and
blocks the next request. Home and Assets
label yield value before the service fee. “Review plan” is a local step with exact token amounts and the full
resolved recipient address; it sends no wallet request. “Confirm and deposit”
then starts the durable transaction flow. Inputs contain only amounts, recipient
and interval; fee/risk consent appears once in this final review and starts
unchecked. Editing values or verified fees invalidates the review.
Missing asset contracts, exact approvals and selected deposits execute atomically
in one World App wallet request. A new two-asset plan contains six calls in one
chain transaction; if any call reverts, neither asset is created or deposited.
Balance, terms and quote reads happen before handoff. A failed read leaves the
draft editable without recording an unresolved wallet request.
The app manages the separate asset contracts internally;
it does not convert between WLD and USDC.

Progress is saved per authenticated wallet in the tab. A completed asset is
never deposited again during resume. An interrupted request without a verified
result stays unresolved. New setup journals keep every original creation and
deposit target as one request. All targets must match the same successful canonical
receipt before any included asset is marked complete. Identified and ID-less
receipts are recoverable without another wallet request; legacy journals with
separately completed assets remain supported. Receipt logs must match the token,
asset amount and original personal contract before completion is shown. Yield vaults must remain
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
Assets also pauses additional deposits into a position with unfinished saved setup.
Resume the original request first, or edit a proven-unsent setup in Plan. This
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
ordinary Assets deposits, that confirmed deposit also requests monitoring.
Registration runs
independently so a delayed backend response does not block switching assets.

Home shows the combined plan and the earliest next check-in, with an overdue
state that does not imply an automatic payout. Assets leads with available income,
then deposits, with principal withdrawals and contract details in disclosures.
Plan contains one shared recipient/check-in editor for all unsettled asset positions.
Changing settings does not depend on which asset was selected in Assets. Settings
reviews and receipts include every current target; period changes include an atomic
check-in. Interrupted settings requests have their own durable journal and never
resend on recovery. Until resolved, another plan mutation is blocked; withdrawals,
income collection and wallet-share redemption stay available.
The settings boundary is read fresh before wallet submission, rather than from
a provider's cached head. Basic settings recovery verifies the original registration at the saved
pre-submission block and the matching successful canonical receipt, so a later
slot release cannot strand another asset's check-in. Recovery stays reachable
even after every current slot has been removed. The editor remains available
for remaining unsettled assets when the selected currency has already paid out.
During a partial
registry outage, Assets offers an explicitly labelled check-in of the verified
selected asset only. A pending claim requires confirmation before cancelling it.
Token buttons in Assets choose WLD or USDC; earlier balances remain reachable under “Other … balances” without
moving funds. A shared balance identifies its owner before hidden account details.

The overview totals assets in their own units, includes held WLD rewards and gifts
inside USDC positions in the WLD total, and offers a combined check-in. Its asset
management action opens the owner's position even when a shared heir link was
previously selected. Ordinary check-in from Home or Plan goes directly to wallet approval. If a
claim is pending, the app first explains that checking in cancels it and requires
explicit confirmation. A fresh claim/recipient/interval/target change invalidates
that confirmation before any wallet request. Optional notification permission
appears on the funded Home overview and in Help, after initial setup.
Asset management contains income collection and a separate principal withdrawal.
Switching assets shows exactly one income card and resets the optional receiving
wallet to the signed-in wallet. The default destination is stated before collection;
a different destination stays available under “Change receiving wallet”. Empty,
over-balance and excessive-precision deposit amounts cannot submit. Disclosure
controls remain reachable at the bottom of the page, including after expansion.
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

## Receiving, invitation and completed history

Plan groups the authenticated heir's verified positions by owner, with human
usernames when available, currency amounts, the current phase and the next action.
Eligible assets from one owner can be claimed or completed in one wallet approval;
the receipt must contain matching events for every submitted position. The heir
view does not show a duplicate owner setup form.
Every verified currency has an action to open its asset details, including
discovered inheritances without a shared link and completed positions with late
rewards. Home's update action selects the signed-in owner's plan after a shared
heir link has been viewed. Creating a personal plan and
adding assets are explicit secondary actions. Editing a proven-unsent remaining
setup restores that form and does not copy completed deposits into it.

After setup, Home presents an invitation immediately. One shared link opens all
current positions belonging to that owner and naming the signed-in heir. Plan
also shows the invitation and the heir's last authenticated visit/last reported
notification permission. Readiness is an observation, not proof of future delivery.
Opening a verified active heir view records that observation without sending
notifications or transactions. Changing the heir invalidates stale readiness.

Completed yield positions remain visible to their immutable inheritance recipient
in the authenticated monitoring index. Browser storage holds public candidate
addresses only; canonical contract identity and the receipt are checked again.
The UI separates cash, invested receipt shares and WLD rewards, links the actual
transaction, and distinguishes provisional from finalized receipts. Wallet-share
redemption is separate and charges no second service fee. New finalized yield
completion notices use the immutable recipient, durable delivery attempts and a
one-day failure retry. Pending finality stays on one-minute observations. Basic
contracts lack that immutable getter, so cached heir data never authorizes a
completion push or API access after settlement. Their actual event receipt can
still be opened while the original factory slot remains registered. Older records
with neither a retained recipient nor a local/link candidate are not promised
complete discovery after a fresh sign-in.

Run `node scripts/verify/plan-experience-browser.mjs` for shared settings, recipient
changes, stale review, storage failure, rejection/response loss, two-asset claim,
cash/share receipts, fresh-profile history, redemption and 320px EN/KO layouts.
Auth and wallet bridge/public rate fixtures run locally; the contracts and
transaction receipts are real on the isolated Anvil chain.

## Number of heirs

The current immutable contracts pay one heir per asset. This release treats WLD
and USDC as one plan for the same person, including shared updates and check-ins.
Showing several contacts would not give each one a contract-enforced right to
receive money. Splitting currencies between people would not implement a
percentage inheritance and would reintroduce separate plan management.

The next contract design should allow the owner to add recipients with percentages
totaling 100%, with the same split applying to both currencies and a shared timer.
One recipient may start the seven-day review; each must then receive their own
share without requiring all recipients to be online. Cash, invested shares and
late WLD rewards must follow the same immutable split, after one fee calculation.
Rounding dust must have a deterministic recipient. Removing a recipient must
revoke API access and future claim rights. One recipient remains the simple default.

The product recommendation is one recipient by default with an initial target of
up to ten. This leaves room for a spouse, children, parents and siblings without
turning the usual one-person setup into a complex form. Percentages and the
remaining percentage should be visible together; additional recipients stay
optional. Ten is a proposed product limit, not a verified chain limit. Before
adopting it, measure wallet payload limits and gas for 1, 2, 5 and 10 recipients,
including share fallback, independent claims and late rewards. A new
distribution contract, migration, World Portal allowlisting and a separately
reviewed contract release are required. No contract was redeployed for this UI
and notification change.
