# Mac continuation — 2026-10-25

## Objective and authorization

Finish Inheritance's World App guideline remediation, verify the actual World App
flows, and resubmit when ready. The user withdrew the previous submission and
explicitly authorized fixes, deployment and resubmission. They have no phone and
rejected BrowserStack signup. They now want to continue on their Mac. Do not
repeat Windows emulator experiments or request another paid/cloud signup without
new user direction. Do not claim that a Mac automatically supports this app;
inspect its hardware, OS and available official installation paths first.

## Repository and production

- Repository: https://github.com/Daviswhistle/Inheritance, branch `main`.
- Production: https://inheritance.pages.dev
- Deployed runtime: `a56335f8a978db1dda9b154b3a606b5de74382ae`.
- Immutable deployment: https://30a7c891.inheritance.pages.dev
- Later commits add verification tooling and documentation; they are not a new
  product runtime deployment.
- App ID: `app_28c40a2a42b7f6c95789c2d5231b1314`.
- Metadata ID: `meta_9cf3b324ec9a1838a56c5b6d98be8674`.
- Last confirmed portal status: `unverified` after user withdrawal. Re-read it.
  Earlier `awaiting_review` receipts are historical, not current approval.
- Deep link: https://world.org/mini-app?app_id=app_28c40a2a42b7f6c95789c2d5231b1314

## Read first

`docs/WORLD_APP_ACCEPTANCE.md`, `docs/GUIDELINE_REVIEW.md`,
`docs/LAUNCH_SCOPE.md`, `docs/REVIEW_NOTES.md`, `docs/RELEASE.md`.
Read any applicable local AGENTS.md before modifying the Mac checkout.

## Completed evidence

The runtime includes prelogin consent and legal dialogs, final plan risk/recovery
disclosures, keyboard/accessibility fixes, authentication timeout handling, and
updated store assets. Repository documents contain the complete test receipts.
Native Android/iOS test hosts simulate wallet responses and do not establish
actual World App acceptance. iOS simulator XCTest passing is not proof that the
App Store World App binary will run in the simulator.

At source `b09627748594e84660b1683dc0a41479c08d8ad1`, full CI passed:
https://github.com/Daviswhistle/Inheritance/actions/runs/40091742269

The added World Chain fork runner and manual workflow passed all five suites:
21 passed, zero failed, zero skipped, block 36,753,480, block hash
`0x636136a382c158bc475fb402b8c26cc54e11a50fb0e85de3611352a5d60848fd`.
https://github.com/Daviswhistle/Inheritance/actions/runs/40091745672
No live funds or transaction broadcasts were used for fork tests.

## Windows attempts — do not mistake installation for acceptance

1. WSL Google Play Android 15 AVD: ARM translation was present but interaction was
   too slow. It was stopped.
2. Windows-native Google Android 15 emulator: WHPX and NVIDIA GPU worked; Google
   account login succeeded. Play Store rejected `com.worldcoin` as incompatible.
3. A signed ARM64 4.0.4100 bundle installed directly, then crashed on startup.
4. BlueStacks 5.22.285.1013 Pie64 / Android 9: signed ARM32 4.0.4401 installed;
   first launch and retry both produced obfuscated `FATAL EXCEPTION: Thread-2`
   in `com.worldcoin`, returning to Gamecenter. No login or Mini App was reached.

Bundles came from APKPure and were verified with apksigner v2/v3 integrity and
app certificate comparison against https://world.org/.well-known/assetlinks.json.
No patching, device-identity spoofing or attestation bypass was performed.
The crash text does not establish the exact cause. These results do not prove
all Mac or PC environments fail. BlueStacks removal was requested by the user.

## Next work on the Mac

1. Inspect `uname -m`, macOS version, Xcode/simulator tools and existing authorized
   access. On Apple Silicon check whether the publisher actually makes the iOS
   app available for this Mac through the App Store; do not assume availability.
   Check official ARM64 Android development options if needed. Verify current
   official support and installation requirements before promising success.
2. Use the actual World app (`com.worldcoin`, now listed as World Money in the
   observed Android store) for MiniKit wallet/transaction acceptance. Distinguish
   it from the separate World ID app and from SDK simulator/test-host tools.
3. Follow WORLD_APP_ACCEPTANCE.md. Collect actual login cancel/retry/success,
   keyboard Done, contacts, notifications and approval cancellation results.
   Do not record success from mocks or app installation alone.
4. User credentials and authentication codes must be entered by the user; never
   capture screens/logs while credentials are being entered. Do not extract or
   transfer Google sessions from Windows.
5. Real deposits/withdrawals require an explicitly approved amount and a willing
   tester's disposable funds. Do not infer permission to spend existing assets.
6. Resolve launch scope: operator is in Korea; portal countries last read were
   KR, US, GB, CA, AU, JP, SG. User has not approved narrowing the country list.
   No legal review was supplied. Do not invent a blanket mandatory legal report,
   independent audit, or physical-device report requirement; equally, do not
   claim lawful operation in all seven countries without supporting analysis.
7. Finish authorized fixes and relevant checks, deploy actual runtime changes if
   needed, verify live behavior, update truthful reviewer materials and submit.
   Preserve the portal contract/token allowlists and notification restrictions.

## Access and nonportable artifacts

GitHub contains source, documentation, workflows and committed assets. It does
not contain Windows/WSL `/tmp` evidence, downloaded APKs, emulator disks, local
Google authentication, secrets or installed SDKs. Reacquire only what is needed.
Use existing authorized GitHub/World developer portal connections on the Mac;
never ask for passwords or API keys in chat. Windows uses the Daviswhistle
GitHub identity for this repo; an unrelated default identity lacked permissions.

The remaining actual-host and launch-scope gaps must be reported honestly. Do
not resubmit merely with an unfinished-work disclosure and call the task ready.
