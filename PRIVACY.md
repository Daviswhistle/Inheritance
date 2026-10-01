# Privacy implementation

The user-facing policy is [app/public/privacy.html](app/public/privacy.html). It describes one-hour tab sessions, one-use hashed nonces, selected contact data, public chain reads, registered vault monitoring, alert delivery history and automated-execution records.

No private wallet keys, seed phrases, biometrics, full contact lists, advertising trackers or analytics are collected. The dedicated automation signer is an infrastructure secret and only pays gas for contract-enforced eligible transfers.

Deleting off-chain monitoring records does not erase public blockchain history. Authentication and rate-limit records expire; persistent monitoring records can be removed after wallet ownership verification through support. Deletion can stop reminders and automated execution for that vault.
