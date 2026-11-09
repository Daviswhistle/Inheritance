# Current submission readiness — November 9, 2026

Submission remains on hold at the user's instruction. This is a working evidence
index and review package, not a submission receipt or TFH acceptance.

## Current product and review scope

- App: **상속 / Inheritance**, `app_28c40a2a42b7f6c95789c2d5231b1314`.
- Production: https://inheritance.pages.dev/; current runtime `80a2f18`.
  The earlier copy-review baseline was `cb4eab1`.
- Fresh Portal read: `unverified`, South Korea only, English and Korean.
- Store availability is South Korea only. The app does not require a residence
  declaration or use IP/network country to gate setup or deposits. Earlier
  regional-control checklists are historical and do not authorize restoration.
- Current World Chain (480) yield factories: WLD
  `0xaC23bd1aF03ce3A178ac9dc54e0159005422F0ff`; USDC
  `0xB3d5ead33a91287C2D39b345041D5a44dC381c5e`.
  Both fix the service fee at 1000 bps of realized positive net gains and the
  recipient at `0xe819320ed3d03f9912b06a48cc5e7f06060cc67a`.

## Completed evidence

| Area | Observed result and boundary |
| --- | --- |
| General CI | [`42613413249`](https://github.com/Daviswhistle/Inheritance/actions/runs/42613413249) succeeded for `80a2f18`. |
| Deployment | [`42613413275`](https://github.com/Daviswhistle/Inheritance/actions/runs/42613413275) succeeded; [immutable release](https://05c5fe99.inheritance.pages.dev). Nineteen public files match production and the immutable build. |
| iOS native host | [`42613413262`](https://github.com/Daviswhistle/Inheritance/actions/runs/42613413262): 4 passed, 0 failed, 0 skipped; iPhone 16 Pro, iOS 18.5, arm64 host. Approvals are simulated. |
| Physical Android, November 9 | SM-N986N: sign-in, closed-plan Home/Plan state, separate WLD/USDC balances, reset → setup entry, keyboard Done, back navigation and World App force-stop → guest/sign-in recovery passed; no blank screen observed. This row covers navigation and recovery, not an approved financial transaction. |
| Store and copy | English/Korean store descriptions were saved and checked after reload; the Korean final paragraph now says the assets share a recipient and renewal period (567 characters), without asserting identical creation timestamps; app, store images and public legal copy were reviewed. [Release details](RELEASE.md). |
| Supplemental local-chain browser | 93 checks passed, with canonical balance/receipt and durable IndexedDB recovery assertions. The bridge and approvals are simulated. |
| Review materials | [Reviewer walkthrough](REVIEW_NOTES.md) and [current-contract review package](CONTRACT_REVIEW_PACKAGE.md) prepared. |

### Current-factory Android financial verification

**In progress:** the initial two-asset native request failed simulation before
a fee quote. WLD alone reached an approval screen quoting 0.01 WLD principal
plus 0.12 WLD network fee; it was cancelled without approval or spending.
[Preflight evidence](evidence/native-setup-preflight-2026-11-09.json) records the
mainnet-fork comparison and the asset-group remediation. The corrected runtime was deployed and 16 public files matched its immutable
build. The user approved a ceiling of 0.02 WLD + 0.02 USDC test principal and
0.5 WLD total network costs (at most 0.15 WLD per transaction).
Both current factories created their own vault and deposited exactly 0.01 of
their asset. Two distinct canonical receipts have status 1; both positions hold
Morpho strategy shares and record the exact deposited capital. Their combined
actual WLD network cost is 0.15827150695141555, reconciled against transfer logs
and the wallet balance. After process termination and fresh sign-in, both
balances were restored without a second deposit.

Additional deposits of 0.01 WLD + 0.01 USDC succeeded in one existing-vault
request. Its canonical receipt contains both exact transfers; wallet reconciliation
shows zero additional network cost. Each vault now records 0.02 principal and
holds strategy shares. The Korean completion notice was observed on the phone.
The combined renewal is awaiting the user's direct native approval; no additional
network fee is shown. Full-exit verification remains pending.
[Sanitized current-factory results](evidence/android-current-factories-2026-11-09.json) record completed steps and pending exit separately.
Canonical receipts, account-level snapshots and phone captures are kept outside
Git. This records initial deposits, not a completed round trip. Add the exact factory/child, asset, transaction receipts and final
position here only after confirmation. Do not use a wallet approval screen or
CI success as a completed mainnet transaction.

The October 27 WLD and November 1 WLD/USDC round trips in
[device acceptance](WORLD_APP_ACCEPTANCE.md) concern the older contracts. Their
zero-share/assets/cost-basis exits remain useful historical evidence, but do
not validate the current factories above.

## Remaining observed-evidence boundaries

- Finish combined renewal and full exit on Android; verify
  final custody balances, cost basis, received assets and actual network costs.
- Actual physical-iPhone World App approvals/permissions are not established
  by the native-host results.
- A recipient's mainnet claim, full seven-day wait and final payout have not
  been observed end to end. Local/fork coverage is recorded separately.
- The October 25 TFH inquiry has no observed reply. The updated contract/fee
  materials are prepared; acceptance has not been confirmed. Successful CI,
  source verification and deployment do not establish TFH review or fee
  agreement. The missing reply alone does not establish a categorical bar to
  review intake. No follow-up message was sent in this work.

The official smart-contract guidance recommends independent audits; it is not
presented here as a universal submission prerequisite. The current package
states the actual review scope and available evidence without claiming an audit.

## Reading the historical records

[The November 4 review](FINAL_SUBMISSION_REVIEW_2026-11-04.md) preserves its
baseline, fixes and original release checklist. Its old production revision,
merge/deploy tasks and residence/IP restrictions are not the current state.
[RELEASE.md](RELEASE.md) retains chronological receipts, and
[WORLD_APP_ACCEPTANCE.md](WORLD_APP_ACCEPTANCE.md) retains device-specific
history. This page is the current readiness index; no review submission is
performed or authorized by preparing it.
