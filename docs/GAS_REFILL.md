# Automatic operator gas funding

The service exchanges **operator-owned WLD or USDC fees** into ETH when the fixed
inheritance executor or refill bot is low. Customer inheritance contracts are never
funding sources. Base lending income stays in its deposited token; general Re7
campaign incentives are WLD. Receipt shares received as operator fees can also be
redeemed, subject to Morpho liquidity.

The treasury approves the immutable `OperatorGasFunding` contract, not the bot EOA.
There is no lifetime allowance renewal. The contract cannot send money to an
arbitrary address, call customer vaults, change recipients, accept caller-supplied
prices, or use arbitrary swap calldata. The separate treasury key stays local.
The treasury can pause funding, change its operating budget, revoke allowances,
and recover its own accidental deposits. The bot cannot do those things.

| Rule | On-chain behavior |
| --- | --- |
| Recipients | Fixed keeper and dedicated bot from constructor |
| Low balances | Keeper or bot below 0.00002 ETH |
| Batch targets | Keeper 0.001 ETH; bot 0.0001 ETH |
| Purchase amount | Only the deficits to those targets; no buy while both healthy |
| Initial spending budget | 10 USDC-equivalent per window; no lifetime spending cap |
| Budget window | 24 hours starting from first spend/reset; not a rolling window |
| Price | Canonical 30-minute TWAP, maximum spot gap 100 ticks |
| Tolerance | Pool fee plus 0.5% per hop, rounded up |
| Maximum transaction price | 0.05 gwei |
| Deadline | At most five minutes; stale signed calls revert atomically |

The treasury may adjust the daily budget without deploying again. Adjacent budget
windows can permit spending near both sides of a boundary. This is an operating
spend range, not a promise of funding when fees or liquidity are unavailable.

Three fixed Uniswap paths are compared: USDC/ETH (0.05%), WLD/USDC/ETH
(0.05% each hop), and WLD/ETH (0.3%). The Worker simulates actual input and estimates
transaction gas, including OP data fees, then chooses the cheapest available
funded path. A batch must buy at least 100 times its conservative gas reserve.
The direct WLD route can be cheaper than two hops despite its larger nominal fee.
Tiny repeated purchases are avoided by replenishing the larger reserve at once.

Pulling funds, optional receipt redemption, temporary exact router approval,
exact-output swap, allowance reset, WETH withdrawal, fixed ETH payments and unused
input refund occur in **one transaction**. Failure reverses all asset movements.
The router retains no allowance. Existing unrelated contract deposits are preserved.

The minute Cron delegates signing, planning and health reads to a SQLite-backed
`GAS_REFILL_EXECUTOR` Durable Object. Public HTTP health calls cannot start funding.
This gives financial execution its separate CPU budget on the existing free plan;
the existing D1 journal and fenced signer lease still protect overlapping calls.

Private `gas_funding_*` D1 records contain an exact signed transaction before
broadcast. A signer-wide fenced lease and one-pending-job index prevent competing
jobs even across controller deployments. A controller change pauses with
`deployment_transition_pending` while another controller's signed job remains
unresolved; restore its deployment configuration to finish the exact old job
before switching. An older contract-scoped journal must be resolved with its
original release before upgrading. These checks never replace or discard a
pending signature.
Planning and broadcasting use separate one-minute cycles to stay within Worker
request limits and the four-minute signed deadline. Dropped acknowledgements,
RPC ambiguity, delayed finality and reorgs recover the
same signature/hash; the Worker never signs a replacement nonce while unresolved.
A canonical failed call consumes its nonce before a fresh quote. A finalized
nonce consumed by another wallet transaction retires ambiguous work with an
unknown outcome; it is never reported as successful funding. Old active
`gas_refill_jobs`, if any, must be resolved before the replacement starts.

Setup uses local `.env.deploy` and `.env.gas-refill` keys and a 0600, ignored
`.env.gas-funding-activation.json` journal protected by kernel `flock`.
`node scripts/setup-gas-refill.mjs --check` is read-only and prints only public
addresses, budgets and required native reserve. Activation deploys the guard,
removes any treasury-to-bot allowances, approves only the guard for the four fixed
fee assets and seeds the bot up to 0.00001 ETH. Resume exactly the same journal:

Setup stages each bounded transaction once its receipt is canonical, recording
its exact signature, block hash and cost. It requires all setup receipts to be
finalized before reporting activation. A finality delay resumes the same journal
without repeating approvals or funding; a changed receipt stops further signing.
Before every signature and retry it revalidates the included prefix and uses
the journal's fixed next nonce. A mid-setup reorg cannot reuse a deployment nonce.

```sh
node scripts/setup-gas-refill.mjs --activate --broadcast
```

Activation has a combined 0.000025 ETH ceiling, including seeded ETH. The public
deployment address/code hash must be pinned in `gas-refill/src/deployment.mjs`
after canonical deployment verification. The Worker stays disabled until this
receipt and setup are verified. Enable `GAS_REFILL_ENABLED` only afterwards.
No external swap is claimed unless an actual canonical receipt exists.

Validation uses disposable keys on local Anvil. `node scripts/test-gas-refill.mjs`
checks durable recovery, code/identity checks, fixed payouts, WLD fee fallback,
lease fencing, finality/reorgs and corrupted journals. Genuine deployed protocol
validation is explicitly opt-in and still sends all transactions to a local fork:

```sh
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public node scripts/test-gas-refill-worldchain.mjs
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public forge test --match-contract OperatorGasFundingForkTest -vv
```

A fork verifies protocol compatibility and quoted costs. It does not establish
production income, continuous self-funding, or a production swap.

Protocol regression forks default to World Chain block 35,837,437. Set
`WORLDCHAIN_FORK_BLOCK` explicitly to verify another snapshot. Live spot/TWAP
divergence may intentionally reject a route; a historical fork pass is not
evidence that every route is executable at the current price.
