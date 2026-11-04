# iOS native test-host sign-in retry

The audit's two iOS 18.5 runs (`41756895853`, attempts 1 and 2) remain failed evidence. A local iOS 27.0 simulator reproduced the same missing-approval symptom with a focused test and identified a test-host UI cause. This does not establish the state of the real World App.

## Root cause

The host completes a Reject touch on `pointerup`. The bridge immediately removes the pending decision row. WebKit then sends a compatibility `click` at the same coordinates; with the row gone, this can target **Reject next sign-in** inside the same shadow dialog. Keeping the modal open for 300 ms prevents fall-through to the app, but does not protect controls inside the modal.

In a source snapshot isolated from HMR, the native baseline recorded:

- 8,927 ms: the second deliberate Reject settles the signature and auth attempt.
- 8,929 ms: `host-reject-next-auth` fires, without a separate native touch.
- 11,481 ms: the next explicit login handler runs.
- 11,541 ms: nonce completes and signing starts.
- 11,543 ms: signing is rejected. Native receipt records a valid same-origin `wallet-auth`; host command 9 ends with `user_rejected`, no pending request and a closed dialog.

Thus the app received the retry, fetched a nonce, and sent the SDK command. The host had accidentally armed its injected rejection. The trace does not support an SDK cooldown, stale auth guard, missed login touch, or a 300 ms close race against the later retry.

## Change

The host's shadow-root capture handler consumes only a trusted mouse compatibility click near a completed decision touch (8 px, at most 500 ms). It leaves keyboard activation and later independent gestures available. The existing touch validation, approval requirement, timeout and one-decision-per-request behavior remain.

Read-only diagnostics expose stage names/timestamps, native command names and origin checks, command IDs/states/error codes, and modal-open state. Nonces, signed messages, signatures, tokens, payloads and wallet addresses are excluded from these diagnostics.

`testRejectedLoginCanBeRetriedRepeatedly` uses three real Reject touches, one login tap per attempt and the original 20-second approval bound, followed by an approved sign-in. It adds no retry taps or longer waits.

## Validation and limits

- TypeScript build check, login lifecycle tests and six bridge unit tests passed locally. Production build passed and contains none of `inheritance-test-controls`, `inheritance:auth-stage`, `__INHERITANCE_TEST_HOST__` or `host-reject-next-auth` in its generated assets; the diagnostics are gated by Vite DEV.
- The existing full native lifecycle test passed its reject/retry and process-death sign-in checks on iOS 27.0, then failed later at the existing keyboard Done lookup. That failure is separate and is not counted as a full native pass.
- The fixed focused native test passed on iOS 27.0: 1 test, 0 failures, 30.092 seconds. All four auth attempts opened a fresh approval; no `host-reject-next-auth` stage occurred. Baseline and fixed sanitized command/stage snapshots are in `docs/evidence/ios-login-retry-2026-11-04.json`.
- Matching iOS 18.5 CI and real World App validation remain separate gates.

Local root-cause artifacts: `/tmp/inheritance-retry-root-cause.log` and `/tmp/inheritance-retry-root-cause.xcresult`. These are disposable local evidence paths, not portable repository attachments.
