# Germany worker and weekly backups

Germany (`ger`) is a worker of the existing account database. The launcher shows
EU (`main`, retained for compatibility), Australia (`aus`) and Germany (`ger`).
Explicit Germany selection routes Ramsgate, Training and hunts only to Germany;
failure or capacity exhaustion must not silently send that player elsewhere.
Parties continue to follow their leader. EU uses Germany on an explicit capacity
refusal before attempting the existing Australia overflow path.

Main deploy configuration uses `GERMANY_DEPLOYSERVER_URL` (HTTP loopback tunnel)
and `GERMANY_PUBLIC_HOST` (destination validation). Metagame enables selection with
`GERMANY_REGION=1`. Add Germany's loopback allowlist tunnel to gateway
`ALLOWLIST_ADDITIONAL_URLS`; routing alone does not open the game UDP ports.
The owner dashboard accepts `DASHBOARD_GERMANY_URL` and reports Germany separately
and in fleet totals. No worker API should bind publicly.

## Automatic hunt capacity

`MAX_HUNTS=auto` (or `MAX_LOCAL_HUNTS=auto`) replaces the fixed hunt ceiling with
the configured UDP port pool, reserving its last two ports for persistent worlds.
CPU and memory admission determine whether another hunt can start. Both guards
are mandatory in automatic mode. Expand the allocator and firewall range together.
The port count is an upper bound, not a promise of simultaneous playable hunts.
Existing worlds are not evicted when resource use rises.

Germany uses a shared Windows job CPU hard cap of 50% for the deployment process
and all its child game processes. Dot-source `Set-ProcessCpuBudget.ps1 -Percent 50`
in its dedicated task wrapper before starting Node. Failure to apply the cap must
prevent launch. CPU admission at 45%, resuming at 35%, leaves startup headroom;
10-second startup pacing lets host telemetry catch up. Other applications on the
same machine remain outside this job: their usage can make total host CPU exceed
50%. The cap applies to aggregate Dauntless CPU, not each hunt individually.

## Backups

Run `Receive-WeeklyDatabaseBackup.ps1` on the backup worker with the source host
and a protected SSH identity. It selects a source snapshot less than two hours old
made by the existing hourly SQLite online backup helper, copies only the database over SSH, compares
SHA-256 and runs SQLite `quick_check` before publishing the copy. A `.partial`
file is not a successful backup. `backups/last-success.json` records verification.
Protect the backup directory for administrators and SYSTEM. Pin the source host
in `keys/known_hosts` for the scheduled task identity. Do not put backups, private
keys or configuration secrets in Git or the public download bucket.

Schedule once weekly using Windows Task Scheduler with `StartWhenAvailable`,
`MultipleInstances IgnoreNew` and bounded retries. Existing source backups remain
enabled. No archive retention deletion is performed by the receiver.
