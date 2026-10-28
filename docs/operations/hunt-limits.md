# Hunt limits from the dashboard

The owner dashboard has a "Hunt limits" card. It sets how many hunts each host takes at once, with no restart.

- File: `data\config\hunt-limits.json` on MAIN, for example `{"main":16,"sg":10}`. Keys: `main`, `us`, `ger`, `sg`, `overflow`. Whole numbers 1 to 64. A missing key means that host uses its own setting (`MAX_LOCAL_HUNTS` / the worker's `MAX_HUNTS`).
- The deploy server on MAIN looks at the file on every hunt request (cached 3 seconds). Invalid or half-written JSON keeps the last good values.
- `main` replaces MAIN's own hunt limit. For a worker, MAIN stops sending new hunts once running plus pending reaches the number. The worker still enforces its own `MAX_HUNTS`, so the dashboard can lower a worker at any time but only raise it up to that setting. Set each worker's `MAX_HUNTS` to the most the box can ever take and use the dashboard below that.
- Only new hunts are gated. Running hunts are never stopped.
- Every change is appended to `data\config\hunt-limits.audit.log` (time, key, old, new, note).
- Override the path with `HUNT_LIMITS_FILE` (deploy server) and `DASHBOARD_HUNT_LIMITS_FILE` (dashboard).

## Going live (next batched MAIN restart)

1. Update the server code (`Update-DauntlessServer.ps1`), which includes the deploy server change.
2. Re-run `deploy\windows-server\Install-OwnerDashboard.ps1` so the dashboard gets `dashboard-limits.mjs`, the new env line and write access to those two files only.
3. Restart the stack through `tools/ops/dr-restart.sh`. Open the dashboard, set a number, check the audit log and the deploy log line `routing: worker at owner limit` once a worker is full.

Rollback: delete `hunt-limits.json` (or empty it to `{}`); every host goes back to its own setting.
