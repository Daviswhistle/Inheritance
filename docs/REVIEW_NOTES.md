# Reviewer notes

App ID: `app_28c40a2a42b7f6c95789c2d5231b1314`
URL: https://inheritance.pages.dev/
Languages: English and Korean. Platform: World App iOS and Android.

## Sign-in and custody

Tap **Continue with World App** to sign in; opening the app initializes the bridge without requesting a signature. World ID verification is not required. Pages verifies the MiniKit SIWE signature, origin, statement, chain and address, consumes a one-use random nonce in D1, and issues a one-hour session. The notification Worker independently verifies this session and current vault permissions. Expired sessions return to the sign-in screen.

User keys never reach our servers. Basic WLD stays in the user's vault; yield WLD or USDC goes into its fixed Re7 strategy and the user's vault holds receipt shares. WLD and USDC use separate factories and vaults, managed together in the app. User transactions go through the allowlisted tokens, receipt contracts and factories with World App approval. A dedicated infrastructure signer pays gas for eligible automated transfers; it cannot choose the recipient, file an heir's claim or withdraw an active owner's funds.

## The inheritance flow

1. Choose WLD and/or USDC amounts, an heir and a 1–365-day timer. Configured new routes default to Morpho with explicit risk and fee consent; earlier basic WLD positions remain manageable. Review the exact amounts and full recipient address in **Review plan**, then use **Confirm and deposit** for wallet approval. The review itself sends no wallet request. Missing asset creation, approvals and deposits execute atomically in one wallet request. Each confirmed deposit receives monitoring even if a later step is interrupted or the user edits the remaining setup.
2. Use **Home** to review the combined plan and check in to verified active assets. **Assets** separates principal withdrawals from income collection on new supporting contracts. Collecting income charges 10% of realized gains while preserving the inheritance principal and timer. **Invite your heir** appears immediately after setup and offers World Chat and a single link to their verified assets. The owner sees the last observed heir visit and notification permission, with delivery limitations stated. Notification permission is separate and is required on each recipient's World App.
3. The heir sees assets grouped by owner, without an owner setup form. After expiry the named heir can file a claim for the eligible assets together in one approval. Funds remain in the vault or its strategy for the fixed seven-day review window.
4. For registered supported vaults, the service can execute the eligible transfer after the review window. Only the named heir receives the funds. Manual completion of eligible assets together remains available. Completed history shows actual cash, invested shares, reward amounts and canonical transaction links; wallet-share redemption is separate. Finalized yield settlement can trigger a completion notification to the immutable recipient. Earlier basic deployments require manual completion.
5. The owner can renew to cancel the claim until the actual transfer executes, including after the seven days. Transaction ordering determines which action wins.

Automation depends on registration, network/service availability, gas funding and spending caps. Current contracts support one heir; the app does not claim multi-recipient inheritance. The interface shows service availability and keeps manual completion available. It does not promise execution at an exact time. A timer is not death verification, a legal will or an investment product.

An unfinished saved deposit blocks additional deposits into that position from
Assets as well as Plan. Resume verifies the original receipt before allowing new
funds. If a proven-unsent setup is cancelled and later funded through ordinary
Assets deposits, the confirmed deposit also requests monitoring; a delayed registration
response does not hold the user's asset navigation.

Yield exits charge 10% of realized positive net gains after loss recovery, without
charging deposited principal. USDC losses recover against later USDC gains only;
its actually claimed canonical WLD rewards pay a separate 10% when distributed.
WLD is held without conversion in a USDC vault. Gifts are excluded. Inheritance
first tries cash, then fixed-heir receipt shares plus idle cash and held WLD.
Late canonical rewards still belong to the original fixed heir after release or
replacement. Receipt redemption in the wallet pays no second service fee. Rates
vary, cash liquidity can fail, principal can lose value, USDC can depeg or be frozen,
and World App's verified-human boost has separate eligibility that this app does
not promise. General Re7 campaigns can pay WLD to eligible receipt holders; campaign
rates, end dates and published Merkl claim proofs determine actual rewards. See Yield Terms.

## Interface and verification

The public landing explains the plan and opens World App; authenticated users have a four-tab mobile interface. Home and Assets stay hidden until an appropriate personal plan or selected balance exists. Linked heir vaults remain distinct from the user's own vault. Discovery checks the authenticated monitoring index and bounded recent chain history; older unregistered vaults can be opened directly from a shared link. Current heir identity and canonical factory membership are checked before listing results.

MiniKit user-operation hashes are resolved through the official transaction-status API before waiting for the canonical transaction receipt. Success requires a successful receipt and observed contract outcome; cancellation, failed operations, timeout and unavailable refreshed state remain explicit. Duplicate action taps are blocked. Switching vaults immediately invalidates the prior roles and transaction route; new actions wait for canonical verification. Reauthentication restores a preserved shared-vault selection. System fonts, safe-area spacing, focus styles, labelled inputs, live status regions and a keyboard-accessible release dialog are provided.

Plan creation, settings changes and deposits require a retained recovery record before a wallet request is sent. The app verifies that record was actually saved. An interrupted plan uses its original trusted factory even after a new generation is introduced. The ordinary shared plan editor updates every unsettled asset, including earlier deposits. Changes to existing heirs or timers require review of the exact current vaults and settings; a changed list requires another review. An interval change explicitly includes a check-in in the same transaction, so shortening the period does not immediately expire old funds. Recovery requires its check-in event as well as the period-change event. Ambiguous settings requests block another plan mutation until the original receipt is verified. They do not lock withdrawals, income or wallet-share redemption. Structured wallet-policy rejections remain editable. Historical creation and deposit receipts remain valid after later owner actions. Income support is verified on the deployed contract rather than inferred from a generation label. The WLD overview includes held rewards and gifts in active USDC positions without converting their USDC balances.

Local verification uses real Anvil transactions, contract state, browser automation, actual Pages SIWE verification and SQLite-backed notification/automation paths. These tests do not certify native World App permission dialogs or real device behavior. Real iPhone/Android World App wallet approval and notification delivery remain external verification items. There is no independent third-party security audit; the app and store do not claim one.

Privacy and terms disclose session data, monitoring records, automatic transfer rules, risks and support. Source and contract information are linked from Help.
