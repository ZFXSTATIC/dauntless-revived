# Account and IP bans

Launcher 0.1.29 shows the server's ban reason and **Go to support**, which opens
https://discord.gg/dauntlessrevived. Manual region choices remain manual; fresh
settings select Automatic and compare two TCP handshakes per available region.
TCP latency is an estimate, not in-game ping or a guarantee of available capacity.

The owner's dashboard, **Players & accounts → Player moderation**, accepts an
account ID from the directory. View status to see authenticated IP observations.
Enter a required reason, then Ban player. Leave the optional IP empty for an
account-only ban. An IP ban must use an address observed for that account and can
affect other users behind the same router/VPN. Unban requires a reason too.
Administrator accounts are protected from this interface.

The backend associates the current username with the observed public IP only after an
 authenticated game heartbeat. Opening the launcher or logging in does not record it.
These observations live only in memory, never in the database or application logs.
Launcher 0.1.30 sends an authenticated end-of-play notification when its game exits.
If that notification cannot arrive (crash, network loss, older launcher), observations
expire after 90 seconds without a heartbeat; memory cleanup runs every ten seconds.
The moderation endpoint filters expired entries immediately and returns the username.
Only the trusted gateway's secret-authenticated forwarding header is accepted;
loopback addresses and arbitrary forwarded headers are not recorded. No hardware
IDs or external IP lookup services are used. Explicit IP bans and their audit history
remain persistent, separately from these temporary observations.
Migration 0024 clears legacy observations in the live database. Historical backups
created before this migration can still contain the previous records; it does not
rewrite backups or securely erase old SQLite pages. Keep backups private.

`GET /undaunted/api/Moderation/:accountId` and `POST /undaunted/api/Moderation`
require a direct owner/admin key, never a proxied request. POST accepts
`{accountId, reason, active, address?}`. Account and optional IP bans persist across
restarts. Backend authentication/token validation refuses banned accounts, and
IP bans block public API calls except server discovery. Existing native game
connections are not forcibly disconnected by this feature; enforcement occurs
on the next checked backend request or login. Shared backend enforcement applies
to every region. Unbanning re-enables existing account keys; no key rotation occurs.

Back up the database before applying migration `0023_moderation`. Rollback should
restore application code while retaining the additive tables, not overwrite
subsequent player saves with an old database. Older launchers will show a generic
key/login error instead of the reason; update them to 0.1.29.

Pooled Ramsgate needs the matching native DLL and deploy service together. Verify
`GAMESERVER_READY_DIR` and fresh `city-occupancy-PID.txt` snapshots on every worker.
Set `REGION_AUS_PROBE_HOST/PORT` and `REGION_GER_PROBE_HOST/PORT` to reachable TCP
listeners on those hosts. Probes send no credentials or application data.
