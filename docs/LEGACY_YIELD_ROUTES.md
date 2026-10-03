# Retaining immutable yield routes

Yield factories are immutable. Changing the primary WLD or USDC factory only
changes where new vaults are created; it does not move, close or migrate vaults
created by an earlier factory. Keep every earlier factory configured so owners
can continue to discover and manage those positions.

## Frontend configuration

The frontend accepts two optional comma-separated lists:

| Asset | Factory list | Shared discovery block |
| --- | --- | --- |
| WLD | `VITE_LEGACY_YIELD_FACTORY_ADDRESSES` | `VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK` |
| USDC | `VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES` | `VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK` |

Leave a list empty when there are no older factories. Each configured list can
contain at most eight distinct, nonzero EVM addresses. Empty entries, malformed
addresses, and addresses already used by a basic or yield factory, asset token,
or strategy are configuration errors. WLD legacy routes require the primary
WLD yield route; USDC legacy routes require the primary USDC route. Each
nonempty list also requires one positive integer discovery block. Set it to the
earliest deployment block among all factories in that list so event discovery
does not skip an older vault.

Primary routes stay first in the frontend route list. This keeps new vault
creation pointed at the current primary factory while old factory addresses
remain recognized for existing positions. Each legacy route uses the matching
asset token, strategy and contract interfaces of its primary route.

Saved plans retain their original factory and deposit targets when the primary
route rotates. Resume does not redirect a pending deposit to the replacement
factory. Settings review includes all active configured generations. Income
capability is checked on the actual factory and vault independently of whether
that route is currently primary; older contracts without the API retain their
ordinary withdrawal controls.

## Keep integrations aligned

When rotating a primary factory, retain every older factory in the applicable
World App contract allowlists and backend factory allowlists. Keep the
notification jobs and backend's existing `legacyFactoryLists` configuration
for those factories so older positions continue to receive their notifications.
The frontend environment variables do not update backend configuration or
World App allowlists; update those independently and preserve existing entries.

Factory generations for the same asset can use the same Re7 strategy and
receipt token. Wallet receipt shares belong to that token, not to a factory
generation. Any UI that summarizes wallet shares must count a given asset and
strategy once, even when several legacy routes point to it.

Do not treat factory rotation as a fund migration. Each immutable vault remains
at its original address with its existing owner, heir, timing and balances.
