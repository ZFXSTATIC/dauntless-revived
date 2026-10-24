# Shop and Middleman shared reset — 2026-10-17

The owner chose to preserve Middleman's existing Thursday 18:00 UTC reset, rather than introduce an Eastern-time schedule. Both source and deployed Middleman used that boundary; the cosmetic shop previously used Monday 00:00 UTC.

WeeklyStoreWindow now supplies the week index and availability start/end for both. All selected cosmetic offers expose the same dates as Middleman, so rotation and offer countdowns share a boundary. No scheduler or host-local timezone is involved. Changing the week index can refresh the current cosmetic selection once on deployment.

Validation: TypeScript compilation and 60 shop/Middleman tests passed, including exact boundary minus 1 ms, boundary, and plus 1 ms; existing purchase, insufficient-funds and retry/idempotency tests also passed.

Deployment: compared compiled freestore.js and shoplayout.js against actual live copies; only the intended clock changes differed. Added storeclock.js, verified original/staged/deployed hashes, and backed up to C:/DauntlessRevived/backups/shop-clock-20261017-232335. Restarted only metagame through the existing supervisor; hunt services were not restarted.
