# Optional device restrictions

Updated Windows launchers report the SMBIOS system UUID and, when available, the TPM endorsement public-key SHA256 before Play. Fixed, hidden PowerShell queries time out after four seconds. Missing TPM, failed queries and non-Windows clients remain compatible. Settings explains collection. No private TPM key is accessed.

These are spoofable client claims, not attestation or proof of cheating. Older/modified launchers and direct game clients can bypass the check. Never automatically ban from these identifiers, movement corrections, latency or falling. Shared PCs can match another account's restriction; moderators must review evidence and appeals.

The account-key-authenticated `/undaunted/api/DeviceSignals` endpoint accepts only the two signal fields, limits reports to ten per account per minute, and stores only domain-separated HMAC-SHA256 values. Raw identifiers must never enter logs. Admin views expose short hash prefixes. Missing or generic identifiers do not create a shared matching bucket.

The dashboard's device checkbox is off by default. With a seven-day account suspension, it snapshots signals reported within the previous 24 hours. No recent observation means the entire ban request fails atomically; retry without device scope to apply an account-only suspension. Matching either claimed identifier blocks Play in updated launchers. Expiry and unban release the restriction; later reports cannot erase its snapshot. Device scope does not ban additional accounts automatically.

## Rollout and rollback

1. Verify a consistent database backup and privately back up configuration and changed application/dashboard files. Check disk headroom. Never copy a live SQLite database as a standalone file.
2. Apply additive migration `0030_device_signals.sql` through the existing migration runner. Preserve environment-specific journal history; append its entry rather than overwriting a divergent live journal. No inventory/account data is changed.
3. Generate a random 32-byte hexadecimal `DEVICE_SIGNAL_HMAC_KEY` directly into protected environment-specific secret storage, without terminal output. Back it up privately with configuration. Replacing this key invalidates existing matches and requires recollection; do not rotate it casually.
4. Deploy the backend and targeted dashboard changes, preserving unrelated live fleet UI. Restart only the backend/dashboard. Verify health, unauthenticated report rejection, authenticated reporting, table presence and absence of raw identifiers in logs.
5. Distribute the updated launcher. Older backends returning 404 and explicitly disabled backends returning `device_signals_unavailable` remain compatible. Other report failures stop that launch attempt without issuing any ban.
6. Roll back application/dashboard files and restart if needed. Leave additive tables in place. Removing the HMAC configuration disables this optional check; account/IP enforcement remains independent. Do not restore an old database over newer progression to roll back code.

Validation: 763 backend tests passed; 259 launcher tests passed (three skipped); 13 dashboard tests passed. Additional controller coverage verifies a device restriction prevents game/relay startup and removal permits a later launch. Windows packaging succeeded. Production status must be checked separately; these results do not establish hardware attestation or live deployment.

Rollout status: launcher 0.1.35 was published with all four release assets verified by size and GitHub SHA256; news was published separately. Backend/dashboard device enforcement remains staged, not deployed. A fresh main database backup passed `quick_check`; the superseded database backup copy was removed after verification, recovering approximately 19 GiB. Configuration rollback files were preserved. Subsequent work prioritized reported part-break visuals. Another developer fixed the reported title-screen disconnects; do not replace their changes with this earlier staged snapshot without a new comparison.
