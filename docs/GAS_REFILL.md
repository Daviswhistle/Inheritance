# Automatic gas refill

The inheritance executor spends native ETH on World Chain. Service fees arrive
in USDC, WLD or receipt shares, so earning a fee does not itself fund execution.
The refill service uses a separately approved **operator USDC budget** to buy ETH
and top up the fixed inheritance executor. It cannot withdraw from a customer
vault, claim customer rewards, change heirs or move Morpho deposits.

## Wallets and authority

- Treasury: the immutable service-fee recipient,
  `0x93bC44B8296977Feb479F95855D9b9E051C17dA2`.
- Beneficiary: the existing inheritance executor,
  `0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b`.
- Refill bot: `0x20A85A9e929C69A440938eb650d70619b7562eD5`, a dedicated EOA
  with its own nonce sequence and private key.
  Only this new key is deployed to the refill Worker. The treasury key stays local;
  the inheritance execution key is not shared with the refill service.

The treasury grants the bot a finite USDC allowance. The initial deployment
uses at most **10 USDC**, not an unlimited approval, and the bot never renews
that allowance itself. It draws only the shortfall needed for a refill. Fees
normally replenish the treasury, but fungible USDC in that wallet is not
cryptographically identifiable as fee income; the allowance is an explicit
operator spending budget. A compromised bot key can consume the remaining
allowance, so keep it small and revoke it from the treasury to stop access.

WLD and fee receipt shares are not sold by this version. Refill also requires
some native ETH in the bot to start: a wallet with no ETH cannot execute a swap.
Bootstrap funding is capped at 0.00001 ETH in the local activation tool.

## Policy

| Setting | Default / upper bound |
| --- | --- |
| Inheritance executor low balance | Below 0.00002 ETH |
| Inheritance executor target | 0.0001 ETH |
| Bot retained gas target | 0.00001 ETH |
| USDC input per refill | At most 1 USDC |
| USDC reservation and spending per rolling 24 hours | At most 1 USDC |
| Gas price | At most 0.01 gwei |
| Refill transaction gas budget per rolling 24 hours | 0.00001 ETH |
| Slippage | At most 0.5% against a 30-minute TWAP |
| Spot/TWAP divergence | At most 100 ticks |
| Router transaction deadline | At most 300 seconds |

These are application controls. The finite USDC approval is the on-chain bound
on treasury access; the daily limits are enforced by the service's private D1
state. No public HTTP endpoint signs or submits transactions.

## Exchange route

The service pins the World Chain deployment and its single USDC/WETH pool:

- USDC: `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`, six decimals.
- WETH: `0x4200000000000000000000000000000000000006`.
- Uniswap V3 factory: `0x7a5028BDa40e7B173C278C5342087826455ea25a`.
- SwapRouter02: `0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6`.
- Fee-500 USDC/WETH pool: `0x5f835420502A7702de50Cd0E78D8aA3608b2137e`.

[Uniswap's canonical deployment record](https://github.com/Uniswap/contracts/blob/main/deployments/480.md)
and live factory/router/pool reads ground the route. It uses a fixed
`exactOutputSingle` plus `unwrapWETH9` multicall, rather than executing arbitrary
third-party quote calldata. The input maximum includes the pool fee and bounded
slippage. The oracle and price guard are checked again immediately before signing
an allocated swap; a newer, lower TWAP tightens its input limit. Missing observations,
wrong identities, an excessive price move,
insufficient allowance or unavailable liquidity prevent a trade.

## Recovery and operation

The separate Cloudflare Worker checks every five minutes. It stages each signed
transaction and reserves its budget in private `gas_refill_*` D1 records before
broadcast. An exclusive lease prevents concurrent signing. A restart or a lost
broadcast response resumes the same hash and nonce. Receipt outages preserve
the pending transaction; they are not evidence that a second transfer is safe.
State transitions are fenced by the current lease token. A delayed former owner
cannot complete or cancel a newer owner's staged transaction, and completion
atomically requires the absence of any pending signature before releasing budgets.
Canonical finalized confirmation is required before moving to the next phase;
the receipt block is checked again after finality and historical fee reads.
therefore the full sequence can take substantially longer than one cron interval.
If L1 fees change before a persisted transaction is broadcast, its gas reservation
may increase atomically within the already reserved daily budget. Its signature,
nonce and transfer amounts remain unchanged. Pool liquidity is required for a
new exchange; receipt recovery and acquired ETH payouts do not depend on it.
Active jobs also refresh their gas reservation as older rolling-day expenditure
expires, while retaining pending reservations and the per-job upper bound.

The bot pulls USDC, approves a finite router input, swaps and unwraps to itself,
then sends the amount still missing from the fixed beneficiary, retaining bot
gas and the payout transaction fee. Existing bot ETH is reused before buying
more; sufficient retained ETH can fund a payout without any USDC allowance.
Before an unsigned treasury pull resumes, its current balance and finite allowance
are checked again; a shortfall retains the job and budget for later recovery.
Ambiguous provider errors without EVM revert data also wait and retry, including
gas estimates and optional operator-fee oracle reads.
Gas price changes wait or use the remaining reserved daily budget; they do not
permanently halt a job merely because its initial gas estimate changed. If somebody
has already topped up that beneficiary before a payout is signed, it keeps the
allocated funds for a later refill. A persisted payout is honoured unchanged even
if the beneficiary is funded later. An expired signed swap is rebroadcast with
the same signature and nonce; after its finalized revert, router approval is
revoked and unused USDC remains in the bot. A failed swap simulation follows the
same cancellation path. It never repeats that job's treasury pull. A later job
reuses the allocated USDC and re-quotes within the rolling budgets. Other failed
or inconsistent receipts stop the job for operator inspection.

Read-only health endpoints report disabled, healthy, pending or a bounded reason
such as awaiting budget or insufficient bot gas. Never publish signed raw
transactions, private keys or the detailed D1 job record. Do not delete pending
records or reset nonces to resolve an RPC outage.

Activation requires the separate bot secret, finite treasury allowance and
bootstrap ETH. A deployment with the service disabled creates no exchange or
token-spending authority. Store review and customer transaction allowlists do
not control this operator-only service.

Prepare and inspect the local key without uploading or spending treasury funds:

```sh
node scripts/setup-gas-refill.mjs --prepare
node scripts/setup-gas-refill.mjs --check
```

Only after authorizing the finite budget, run the local activation once:

```sh
node scripts/setup-gas-refill.mjs --activate --broadcast
```

Its gitignored 0600 journal resumes the same signed setup transactions. A completed
journal never renews a consumed USDC allowance. Do not delete it to retry an RPC
failure. Every retransmission rechecks current L1 and operator fees against the
setup reserve and total budget, preserving the same signature if fees are too high.
Local activation requires Linux `flock` and holds an exclusive kernel lock before
reading balances or the journal. A concurrent command exits without signing.
The ignored lock file can remain after completion; the kernel releases ownership
when the process exits, including a crash. Do not delete its inode while activation
is running. Checks and key preparation do not acquire a spending lock.
Enable the separately deployed Worker after setup and verify both its
health and the beneficiary's ordinary automation health. Empty USDC treasury or
an exhausted allowance is a waiting state, not a reason to access a customer vault.

Validation covers genuine local Anvil transactions and SQLite recovery, plus an
opt-in real-protocol World Chain fork. A fork does not prove production trading,
continuous operation or future liquidity. This service has no independent
third-party security audit.

Run the entire Worker against real protocol contracts without production writes:

```sh
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public node scripts/test-gas-refill-worldchain.mjs
```

The test uses fresh local accounts and accelerated fork finality. All transaction
broadcasts go to a locally spawned Anvil instance, including fixture funding.
