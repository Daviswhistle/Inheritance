# Current submission readiness — November 9, 2026

Submission remains on hold at the user's instruction. This is a working evidence
index and review package, not a submission receipt or TFH acceptance.

## Current product and review scope

- App: **상속 / Inheritance**, `app_28c40a2a42b7f6c95789c2d5231b1314`.
- Production: https://inheritance.pages.dev/. The copy-review baseline is `cb4eab1`;
  the native-setup remediation is described below and requires a fresh deployment
  and financial receipt checkpoint.
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
| General CI | [`42592223626`](https://github.com/Daviswhistle/Inheritance/actions/runs/42592223626) succeeded for `cb4eab1`. |
| Deployment | [`42592223935`](https://github.com/Daviswhistle/Inheritance/actions/runs/42592223935) succeeded; [immutable release](https://3eeef6f2.inheritance.pages.dev). |
| iOS native host | [`42592223892`](https://github.com/Daviswhistle/Inheritance/actions/runs/42592223892): 4 passed, 0 failed, 0 skipped; iPhone 16 Pro, iOS 18.5, arm64 host. Approvals are simulated. |
| Physical Android, November 9 | SM-N986N: sign-in, closed-plan Home/Plan state, separate WLD/USDC balances, reset → setup entry, keyboard Done, back navigation and World App force-stop → guest/sign-in recovery passed; no blank screen observed. This row covers navigation and recovery, not an approved financial transaction. |
| Store and copy | English/Korean store descriptions were saved and checked after reload; app, store images and public legal copy were reviewed. [Release details](RELEASE.md). |
| Review materials | [Reviewer walkthrough](REVIEW_NOTES.md) and [current-contract review package](CONTRACT_REVIEW_PACKAGE.md) prepared. |

### Current-factory Android financial verification

**In progress:** the initial two-asset native request failed simulation before
a fee quote. WLD alone reached an approval screen quoting 0.01 WLD principal
plus 0.12 WLD network fee; it was cancelled without approval or spending.
[Preflight evidence](evidence/native-setup-preflight-2026-11-09.json) records the
mainnet-fork comparison and the asset-group remediation. Financial execution
through the corrected release is still pending. Add the exact factory/child, asset, transaction receipts and final
position here only after confirmation. Do not use a wallet approval screen or
CI success as a completed mainnet transaction.

The October 27 WLD and November 1 WLD/USDC round trips in
[device acceptance](WORLD_APP_ACCEPTANCE.md) concern the older contracts. Their
zero-share/assets/cost-basis exits remain useful historical evidence, but do
not validate the current factories above.

## Remaining observed-evidence boundaries

- Finalize current-factory Android financial receipts and resulting balances.
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
