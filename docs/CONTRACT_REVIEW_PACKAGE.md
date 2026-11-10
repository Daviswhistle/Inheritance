# Inheritance — contract and fee review

Source repository: https://github.com/Daviswhistle/Inheritance

Please review the deployed inheritance contracts and service fees for the South Korea Mini App release. The app supports English and Korean.

## Contracts and user control

World Chain mainnet, chain ID 480:

| Contract | Address |
| --- | --- |
| WLD factory | `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff` |
| USDC factory | `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e` |
| Re7 WLD strategy | `0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f` |
| Re7 USDC strategy | `0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B` |
| Service-fee recipient | `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a` |

Our factories and user vaults are immutable. Each depositor controls their recipient, renewal period and withdrawals. The developer cannot upgrade a user's vault, seize its assets or change its recipient. The service-fee rate and recipient are fixed at deployment.

After the renewal deadline, the designated recipient can file a claim. Payment becomes eligible after seven days. The owner can renew to cancel the claim until payment executes. Automated execution can pay only the designated recipient. Operator gas support uses a separate operator treasury.

Ending inheritance combines withdrawal and recipient removal in one atomic transaction. A failure rolls back the combined transaction. If cash redemption fails during inheritance settlement, the recipient receives the strategy shares instead and can redeem them as liquidity permits.

## Service fees

The service fee is 10% of positive profit after strategy costs. Deposited principal is excluded from the fee calculation. A loss recognized on an earlier withdrawal is deducted from later gains in the same vault and asset before a profit fee is charged.

- **Cash settlement:** profit is calculated from the assets actually received; the fee is paid in that asset.
- **Share settlement:** profit is calculated using the strategy's `convertToAssets` quote; the fee is paid in shares. This quote is not a guarantee of cash redemption value. Valuation is limited to 150,000 gas. If it fails, that exit's fee is waived and all exiting shares go to the recipient. Redeeming those shares later through our factory does not incur another service fee.
- **WLD rewards in a USDC vault:** a separate 10% fee applies to claimed WLD rewards when paid out. Direct gifts are excluded, and USDC losses and WLD reward fees are accounted for separately.

The app shows the current Re7 strategy fee before deposit and requires renewed review and consent if it changes. World App confirms any separate network charge in its native approval screen.

## Improvements and verification

Home, Assets, Plan and Help have distinct roles. Setup reviews amounts, recipient, renewal period and fees before native approval. Keyboard handling keeps inputs and actions accessible. Interrupted requests retain their original identifiers and receipts, preventing duplicate deposits or withdrawals.

On November 9, physical Android World App completed initial deposits of 0.01 WLD and 0.01 USDC, another 0.01 of each asset, combined renewal and full Morpho withdrawal through the factories above. Both vaults ended with zero idle assets, strategy shares and recorded principal, and their recipients were removed. Funded and ended states were restored after process termination and sign-in.

Final verification on November 10:

- 476 contract tests; 25 World Chain fork tests at block 37478097; 12 money-safety scenarios; 72 English/Korean UI layouts — all passed.
- The production version's iOS simulator native-host tests passed 4/4 with simulated wallet approvals.
- Type checking and lint passed. All 22 checked production static files matched the immutable release for runtime `e73e11f`.
- Contract tests cover access control, separate fee recipients, principal protection in fee accounting, loss accounting, minimum outputs, cash/share settlement, reentrancy and rollback. CI enforces at least 90% line coverage for critical custody logic.

## Review files and reproduction

- [Contract source](../contracts/): `InheritanceVaultMorpho.sol`, `InheritanceVaultUSDC.sol`, their factories and deployers, `libraries/YieldMath.sol`, and `OperatorGasFunding.sol`.
- [Contract tests](../test/) and [application/fork verification](../scripts/verify/).
- [Current Android transaction evidence](evidence/android-current-factories-2026-11-09.json), [deployment history](RELEASE.md), and [reviewer walkthrough](REVIEW_NOTES.md).

Run `forge test -vvv` for contract tests. For live-state local forks, set `WORLDCHAIN_FORK_RPC` to a World Chain RPC and run `node scripts/verify/worldchain-forks.mjs`. Run `node scripts/verify/money-safety.mjs` and `node scripts/verify/product-ui.mjs` for the disposable local-chain browser checks, using the dependencies documented in `.github/workflows/ci.yml`.
