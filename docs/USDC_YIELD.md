# USDC inheritance route

USDC support is a separate immutable yield factory. Existing basic WLD and Re7 WLD
factories and balances stay in place. Users enter WLD and USDC amounts, an heir
and a check-in interval in one plan. The app manages the separate contracts and
reviews changes to existing settings before submitting them. New deposits use
the configured Morpho routes, with explicit fee and risk consent. Existing basic
WLD positions remain manageable; an environment without a WLD yield route uses
basic custody for new WLD deposits. Existing funds never move automatically.
See [the unified flow](UNIFIED_PLAN.md) and [protected owner income](OWNER_INCOME.md).

## Fixed deployment configuration

- World Chain, chain ID 480.
- Asset: Circle-listed World Chain USDC, `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`, 6 decimals.
- Strategy: Re7 USDC, `0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B`, 18-decimal shares.
- Reward: canonical WLD, `0x2cFc85d8E48F8EAB294be644d9E25C3030863003`, 18 decimals.
- Canonical Merkl distributor: `0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`.
- Performance fee: immutable 1000 bps, recipient `0x93bC44B8296977Feb479F95855D9b9E051C17dA2`.
- Constructor checks code, distinct asset/reward/strategy, strategy asset, fee cap,
  recipient and period. No operator withdrawals, upgrades or strategy switching.

The asset/strategy/deposit availability and decimal counts were checked at World
Chain block **35799795**. Rates and underlying governance remain mutable.
[Circle's asset list](https://developers.circle.com/stablecoins/usdc-contract-addresses)
and [the route comparison](MORPHO_ROUTE_DECISION.md) record the selection evidence.

## Units and payouts

Amounts passed to the deposit gateway use USDC's six decimals; slippage bounds use
18-decimal strategy shares from the actual strategy quote. Receipt shares are
always displayed and approved independently of USDC cash. Every deposit invests
the specified USDC into the pinned strategy, leaving direct gifts idle.

USDC gains are charged 10% only when realized, after proportional principal and
realized USDC loss recovery. Gifts of cash or receipt shares are excluded. Failed
share valuations waive that exit's fee and cannot invent a loss. Later wallet
receipt redemption does not charge a second service fee.

Canonical actually claimed WLD stays in the USDC vault. It is not swapped or
deposited into the USDC strategy. WLD is paid with a separate 10% reward fee on
owner reward withdrawal, full asset exit or inheritance. WLD gifts are excluded.
USDC losses offset later USDC gains; they do not offset WLD fees. There is no price
oracle or cross-currency netting. Partial USDC and share exits leave WLD in place.

At inheritance, the same fixed heir receives USDC cash, or receipt shares if cash
redemption fails, plus idle USDC and WLD after their respective fees. A reward-only
vault can settle. Late canonical WLD still belongs to that fixed recipient even
after release and replacement of the owner's current vault. Owner recovery of
an archived settled vault routes canonical rewards to the heir before returning
genuine gifts; it never mutates the current vault.

## Activation and verification

The frontend and Worker require all of `USDC_ADDRESS`,
`USDC_YIELD_FACTORY_ADDRESS` and `USDC_MORPHO_VAULT_ADDRESS` (frontend `VITE_`
prefix). Frontend provenance, strategy, reward token and fee checks are tied to
the selected route; quotes, receipt holdings and wallet amounts remain separate.
Only explicit trusted factories and factory-created children are supported.

World App must allowlist the USDC token, new factory and Re7 USDC receipt address
in addition to all existing WLD entrypoints. Permit2 token permissions include
both asset tokens and both receipt tokens used for wallet redemption. Pending store review can prevent
metadata changes; do not enable a route with unusable transaction entrypoints.

`scripts/deploy-usdc-factory.mjs` is a dry-run unless `--broadcast` is explicit.
It uses a 9,500,000 gas ceiling and a 0.000020 ETH total-cost cap, including
execution and L1 costs; it quotes the current reserve before any broadcast.
Its gitignored 0600 signed state makes retries resume the same transaction. It
checks World Chain, the fixed strategy, source runtime, total fee cap and existing
funding. Do not disclose its state file, raw signed transaction or signing key.

Validation includes six/18-decimal contract tests, real World Chain fork tests,
browser transactions on Anvil, notification auth and keeper request-budget/
durable-recovery checks. Local reward fixtures and fork root injection establish
integration behavior; they do not establish a new vault's campaign eligibility,
real accrual or World App device approval. Source verification is not a security
audit. No independent third-party audit is claimed.

The USDC-enabled keeper permits 900,000 gas. A cold real-token fork stress case
with idle USDC, WLD gifts and both strategy calls exhausting their bounded gas
used 693,508 body gas, or 858,129 with a conservative transaction allowance and
20% padding. The former 850,000 bound was insufficient for this case. The existing
0.00001 ETH daily spending cap, 0.01 gwei maximum gas price and 0.000001 ETH OP-fee
reserve stay unchanged; the full worst-case reservation remains within that cap.

USDC settlement proof binds the finalized receipt to its source factory and
settled timestamp. If either historical RPC read is temporarily unavailable,
the keeper retains the pending job and its gas reservation for the next cycle.
It does not rebroadcast an already mined transfer or halt the signer merely
because evidence could not be read. An observed receipt mismatch still halts
execution.
