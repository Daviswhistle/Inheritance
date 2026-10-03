# Owner income withdrawal

New WLD and USDC factory deployments expose `withdrawIncomeFromMyVault(to, minNetAssets)`.
The corresponding personal contract exposes `incomePosition()` and `ownerWithdrawIncome()`.
Existing immutable deployments keep their original withdrawal behavior; deployment and
World Developer Portal registration are required before the new API is offered in World App.

Income is the value of tracked Morpho shares above the remaining deposited capital plus
previously realized losses. WLD additionally includes canonical received Merkl rewards.
Cash and share gifts are excluded. USDC campaign WLD remains a separate reward balance.
The owner receives income after the existing 10% performance fee. Morpho rates, liquidity
and asset prices can change; this preserves the accounting baseline, not a guaranteed
principal value or return.

Income collection leaves `costBasis`, `realizedLoss`, the heir and check-in timer unchanged.
It reduces tracked shares only by the shares actually redeemed. WLD uses canonical reward
cash first. Remaining managed value must still cover capital and unrecovered loss.
A repeated harvest cannot turn previously protected capital into available income.

`incomePosition()` returns gross income, its fee, net income, currently withdrawable net
income and a valuation flag. Share rounding is conservatively reserved. Quote failures
never advertise a fabricated balance. Canonical WLD cash can be collected when the share
liquidity probe fails, provided the capital postcondition holds. An expired owner must
use the existing explicit check-in/renewal flow before withdrawal. `minNetAssets` binds the
minimum net payment; a failed transfer or inadequate principal protection reverts atomically.

Ordinary partial/full withdrawals remain available separately and still allocate capital
proportionally to shares disposed. They must not be presented as protected income-only
withdrawals. Additional WLD campaign rewards in a USDC position remain separately subject
to the reward fee and are never silently exchanged into USDC.

Validation: `forge test --match-path test/OwnerIncome.t.sol`, full `forge test`,
`forge build --sizes` and `node scripts/gen-abi-errors.mjs --check`. Inert creation-code
parts keep each deployer and data chunk within EIP-170 and factory initcode within EIP-3860.
