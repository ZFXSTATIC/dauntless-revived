# Void creator reward

Code `Void` (case-insensitive, surrounding spaces ignored) grants10000 ordinary Rams (`CURRENCY_NOTES`) once per account. GET `/creator` reads status only. POST `/creator` accepts the native JSON `{slug,authorization}`; GET also accepts the native `X-Epic-Authorization` token. All token forms are verified by the existing metagame JWT middleware; supplied account IDs, character IDs and reward amounts are ignored.

A permanent `onetimejobs` receipt `creator:void:<accountId>` and the audited inventory grant commit in one immediate SQLite transaction. The active owned character receives the grant. Existing inventory request receipts alone cannot enforce this: they are character-scoped and pruned after30days. No new schema migration is required. Repeated claims return409; GET after a claim reportsVoid. Failed grants roll back the receipt and remain retryable. The authenticated POST uses the existing player mutation rate limit.

Validation:93 targeted reward, permission, inventory and shop tests pass, including two independent Node backend processes competing for the same account claim, a fresh process refusing a repeat, character switching, malformed inventory rollback, invalid auth/codes and native credential locations. Native client code confirms GET status and POST mutation; POST serialization fields are `slug` and `authorization`.

Isolated in-game test: TESTTFBTA successfully redeemedVoid. Ledger records exactly10000 Rams,68000->78000, one permanent receipt. The unmodified creator callback did not refresh native inventory, so the game continued displaying68000; a committed backend reward does not prove the client has refreshed.

`CreatorRewardRefresh.h` is a client-only pilot gated by DR_CREATOR_REWARD_TEST=1. Creator-screen interaction triggers at most 3 owned-inventory ServerRefreshInventory requests over 15 seconds. A toast is based on observing a 10000-Ram balance increase; it never modifies inventory or grants currency locally. Release x64 native build passes. The user confirmed the in-game balance updates with this build; a separate toast confirmation remains pending.

Fresh local account VOIDCODETEST started at 68000 Rams with no receipt. After entering Void, the user confirmed the balance changes; the database records 78000 Rams, exactly one +10000 grant and one permanent receipt. Verify-Creator-Refresh.cjs then submitted VOID again through the native authenticated POST: HTTP 409, with balance, receipt and grant count unchanged. TESTTFBTA's original claim remains intact. Only the isolated C:/dr/anticheat-test runtime has been changed. No production rollout or release packaging has occurred.

## Further codes (TheFool, ZFXSTATIC, ZEDFXSTATIC)

`creator.ts` now keeps a small table of codes. Each code is matched like Void (case-insensitive, spaces trimmed) and has its own permanent receipt `creator:<slug>:<accountId>`, so every code can be redeemed once per account, independently of the others.

- `TheFool`: 20 each of `ORB_FLAME`, `ORB_FROST`, `ORB_SHOCK`, `ORB_TERRA`, `ORB_PHYSICAL` (the five 1.4.4 orbs), same 32-bit stack check as Void's Rams.
- `ZFXSTATIC` and `ZEDFXSTATIC`: 48 h of the timed entitlement `escalation_xp_boost_entitlement` (the boost the Elite ranks give, see `progression_config.json`), granted through `GrantEntitlementInTx`. The two codes have separate receipts, so an account that enters both gets 96 h; a still-running boost is extended rather than reset.

GET `/creator` reports the first redeemed code in table order (Void first), so Void accounts see exactly what they saw before. The Void reply is unchanged; the other codes reply with `granted` and, for the boost codes, `grantedEntitlement`. Not yet checked in game: whether the 1.4.4 client shows and applies the boost entitlement granted this way.
