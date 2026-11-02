# Ending inheritance and returning assets

The previous stop action only changed the heir to the owner. Funds remained
invested and the user had to discover a separate withdrawal flow. That did not
complete the user's expected task.

The main action now ends inheritance **and returns all supported assets in the
current mapped plans to the owner's World App wallet**. The review identifies
WLD, USDC, separately held WLD rewards, service fees, destination and the possible
additional network fee. Removing only the recipient is a separate, secondary
choice explicitly described as keeping assets invested. Previously removed
recipients with retained assets get a recovery action directly on Home.

Implementation uses the existing factory entrypoints in one SDK batch:
`pingMyVault`, `updateMyHeir(owner)` when needed, and
`withdrawAllFromMyVault(owner, reviewedMinimum)` for funded yield plans.
The ping cancels pending claims before the other calls; the review states that
consequence. Basic plans use their existing exact-amount withdrawal method.
No contract or fee policy is changed. Archived/settled recovery and separate
wallet-held investments retain their existing paths.

Checks before requesting approval:
- Read every mapped plan, verify owner and trusted route, and re-read immediately
  before submission. Changes to identity, shares, claim or protected amount
  require another review.
- Simulate the exact strategy redemption with `eth_call`, without transferring
  assets. A `maxRedeem` quote alone can underestimate full redemption due to
  round-down conversion, reproduced by a repeat deposit at an appreciated rate.
- Preserve the reviewed minimum output rather than silently using a lower fresh
  quote. Insufficient liquidity/valuation gives an explanation and asset-detail
  route; it does not remove the recipient first.
- Already empty plans with no recipient do not send redundant transactions.

A durable, account-scoped recovery record is saved before requesting approval.
After process/tab loss, recovery checks the original operation or locates a
unique matching receipt. Ping events also anchor exits whose recipient was
already removed. Confirmation verifies canonical receipt, route identity,
settings events and token transfers from the correct vault to the owner. All
supported token/share balances are checked at the receipt block. Unexpected
remaining assets are shown as remaining, not silently declared recovered.
Rejection clears a definitely unsubmitted record; a confirmed revert clears a
failed record. An uncertain request remains available for result checking and
is not resubmitted automatically. Existing asset-withdrawal paths remain usable.

## Reproducible local validation

Run `node scripts/verify/plan-exit.mjs` with `CHROME_BIN` and
`PLAYWRIGHT_MODULE` configured as described in `scripts/verify/README.md`.
`EXIT_UX_OUT` selects the private evidence directory. The test host creates its
own disposable local chain and uses the installed MiniKit SDK and atomic wallet.

Twelve scenario groups cover net amount/fees/destination and small-screen review,
review dismissal, wallet rejection, insufficient liquidity, quote failure,
changed quote, a second-asset revert rolling back all earlier calls, process
loss after approval, missing operation identifier, cancelled-recipient recovery,
empty-plan semantics, redundant-transaction prevention and negative receipt
proofs. The principal-plus-yield scenario returns 11.9 WLD (including 1 WLD from
the USDC plan) and 10.9 USDC; both vaults become empty and both heirs are the
owner. All funds are test tokens. This is not a production-money transaction or
actual iOS World App validation.

Deployment and device evidence are recorded separately in RELEASE.md.
Submission remains stopped.
