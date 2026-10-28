# Trimming the history tables

The save database is about 35 GB, and under 0.5 GB of it is real player data (characters, inventories).
The rest is history: saved versions of every character and loadout, and audit logs. Every hourly backup
copies all of it. `tools/ops/history-trim.cjs` removes old history rows safely: it writes them to gzip
NDJSON archives first, checks the archives, deletes in small batches, and can put every row back.

## What may be trimmed, and what not

| Table | Size | Trim? | Why |
|---|---|---|---|
| `characterhistory` | ~19.8 GB | yes, the main target | Only read for admin rollback / save-history list (`controllers/savehistory.ts`) and "newest save per character" (`controllers/activecharacter.ts`). The app already prunes it per character on every save (newest `SAVE_HISTORY_KEEP`=100, plus last-of-hour for 48 h, plus last-of-day for 30 days). The script applies the same rule with smaller numbers to every character at once. The newest rows of each character always stay. |
| `loadouthistory` | ~3.4 GB | yes | Same rules and readers as `characterhistory` (loadout rollback). |
| `progression_events` | ~4.8 GB | not now | Append-only audit log (a trigger refuses DELETE). Only the newest row per account is used by the app (grant retry guard, "has this account used real progression"), but it is the record of every progression write. The script only allows rows older than 90 days, keeps the newest row per account, and needs `--include-audit`; it drops and recreates the trigger inside each delete transaction. All rows are under 30 days old today. |
| `inventorylog` | ~1.6 GB | never | Append-only item ledger. Store revocation (`controllers/storerevocation.ts`) and `tools/find-uncredited-purchases.sql` look up old rows with no time limit. The script refuses it. |
| `inventorytransactions` | ~1.25 GB | no need | The retry (idempotency) receipts. The app already deletes receipts older than 30 days on every inventory transaction (`controllers/inventory.ts`, `TRANSACTION_RECORD_DAYS`). Younger ones must stay; the script refuses less than 30 days. |

## How the file gets smaller

Deleting rows does not shrink `undaunted.db`: the pages go on SQLite's free list and are reused by new
history, so the file stops growing. The hourly backup (SQLite online backup API) copies free pages too, so
backups only shrink once the live file is compacted. The script never runs `VACUUM`.

Recommended: one compaction in a maintenance window after the trim.

1. Stop the stack (the stop takes a backup).
2. `VACUUM INTO 'undaunted.compact.db'` from the stopped database (needs free disk the size of the compacted file).
3. `PRAGMA integrity_check` on the new file, compare row counts of `users`, `characters`, `inventory`.
4. Rename the old file to `undaunted.pre-compact.db` (keep it until the next good backup has been checked), move the new one in, start the stack.

An alternative that needs no downtime is to change the backup to `VACUUM INTO`, which writes compact backups
from a running database; the live file then stays large but stops growing.

## Order of steps

Off-peak only (lowest player count of the day). Nothing below needs the server stopped except the compaction.

1. **On a copy first.** Take the latest backup copy and run the dry run and a full execute + restore on it:
   ```
   node tools/ops/history-trim.cjs --db <copy> --keep-days 7 --keep-per-key 20 --hourly-hours 24 --daily-days 14
   node tools/ops/history-trim.cjs --db <copy> <same numbers> --execute --archive-dir <dir> --check
   ```
2. **Dry run on the live server** (read-only, no changes):
   ```
   node tools/ops/history-trim.cjs --db C:\DauntlessRevived\data\undaunted.db --i-am-on-main <same numbers>
   ```
3. **A careful first live run** with a row cap: add `--execute --archive-dir <dir on a disk with room> --max-rows 20000`.
   Check the server (below). Then run again without `--max-rows`. It picks up where it stopped.
4. Defaults while running: 2000 rows per transaction, 200 ms pause, stops on busy/locked errors and when the
   `-wal` file passes 512 MB (`--max-wal-mb`). A stop is safe: run the same command again later.
5. Keep the archive directory (copy it off the box, encrypted like the backups) at least until the next
   compaction and one good backup.
6. If the history should stay small, set the same numbers in the metagame env (`SAVE_HISTORY_KEEP`,
   `SAVE_HISTORY_HOURLY`, `SAVE_HISTORY_DAILY`) so the app prunes to them on every save.
7. Compaction (above) in the next maintenance window.

## Checking that nothing broke

- `node tools/ops/history-trim.cjs --verify-archive --archive-dir <dir>`: every archive member matches its checksum and row count.
- A dry run with the same numbers reports 0 rows.
- Players log in and their character loads; the dashboard shows no new metagame errors.
- Admin save history (`/SaveHistory`) of a few characters still lists recent versions; each character still has its newest versions.
- After compaction: `integrity_check` is `ok` and the next backup succeeds and is smaller.

## Rollback

- Put rows back: `node tools/ops/history-trim.cjs --db <db> --restore --archive-dir <dir>` (add `--i-am-on-main` on the server).
  It uses `INSERT OR IGNORE` with the original ids, so it is safe to run twice and while the server runs.
  `--tables a,b` restores only some tables.
- After a compaction, the old file (`undaunted.pre-compact.db`) or the last backup is the full rollback: stop the stack, move it back, start.
