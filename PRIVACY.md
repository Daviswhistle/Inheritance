# Privacy implementation

The user-facing policy is [app/public/privacy.html](app/public/privacy.html). It describes one-hour tab sessions, one-use hashed nonces, selected contact data, public chain reads, registered vault monitoring, authenticated heir visit times and last reported notification permission, immutable completed yield recipients, alert delivery history and automated-execution records.

Settings recovery is retained per wallet in the tab. Public received-inheritance candidates are remembered locally and never grant access without fresh chain verification. Only the current heir can record readiness, which the owner sees as a last observation rather than delivery proof.

No private wallet keys, seed phrases, biometrics, full contact lists, advertising trackers or analytics are collected. The dedicated automation signer is an infrastructure secret and only pays gas for contract-enforced eligible transfers.

Deleting off-chain monitoring records does not erase public blockchain history. Authentication and rate-limit records expire; persistent monitoring records can be removed after wallet ownership verification through support. Deletion can stop reminders and automated execution for that vault.
