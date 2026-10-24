# World regions

Launcher Settings offers Main and Australia (OCE). The preference is saved to the authenticated account when Play is pressed; relaunch after changing it. Older launchers/accounts default to Main.

Australia routes Ramsgate, Training Grounds and hunts to the AUS worker. Main retains its two-host Ramsgate/hunt pool. Training Grounds follows the selected region too. Cross-region invitations use the central party/account backend; an invited player's own preference does not override the party leader's hunt region. Private party rosters remain isolated, and public queues group the same hunt within the same region.

An explicit OCE selection never silently falls back to Main. If AUS is unavailable or full, the existing bounded capacity wait applies. Main retains its overflow behavior, including AUS when the Main pool is full. Ambiguous launch failures never duplicate a hunt.

## Configuration

- Main metagame: `AUS_REGION=1` enables the account preference API.
- Main deploy: `AUS_DEPLOYSERVER_URL=http://127.0.0.1:61021`; retain the Main worker's `OVERFLOW_DEPLOYSERVER_URL`.
- AUS deploy: `HUNT_WORKER=1`, `WORKER_RAMSGATE=1`, no regional or overflow URL. The central metagame is reached through the private tunnel.
- AUS Ramsgate uses `PORT_RANGE_END`; hunt ports end two ports below it. Include Ramsgate's UDP port in `ALLOWLIST_PORTS` and publish the updated configuration through the main gateway's additional allowlist tunnel.
- The main dashboard uses `DASHBOARD_WORKER_URL` and `DASHBOARD_AUS_URL` for its private worker monitors. Overview combines all hosts; Server #1, #2 and #3 retain their own resource/process/world views.
- The Discord status worker reads the owner-protected dashboard over `STATUS_DASHBOARD` (default loopback port 61110). Only numeric aggregate metrics and fixed public labels enter the embed; no addresses, account details or raw errors are forwarded.

`GET/POST /undaunted/api/HuntRegion` requires the player's account key. POST accepts only `{ "region": "main" }` or `{ "region": "aus" }`. Migration 0020 stores preferences in the shared database.

## Hunt cleanup

The watchdog checks every 15 seconds. Ramsgate and Training are exempt from all of it, and ports are released only after the original child exits. A temporary hunt or tutorial is stopped for one of three reasons:

- `max-age`: `HUNT_MAX_AGE_MINUTES=120` stops it after two hours, including occupied instances. This is the ceiling, and it is the only reason that does not depend on telemetry.
- `empty`: `HUNT_EMPTY_MINUTES=10` retires it earlier after continuously fresh native zero-connection readings. A positive count, a missing reading or an observation gap over 90 seconds resets the timer.
- `silent`: `HUNT_SILENT_MINUTES=15` retires an instance that reports no telemetry at all **while another instance on the same host is still reporting**. A process whose net driver never started listening writes no diagnostics and never runs its own idle shutdown either, so without this it survives to the ceiling. When no instance on the host reports — native diagnostics off, or `GAMESERVER_READY_DIR` unset — silence proves nothing and nothing is stopped for it.

An instance that never wrote its ready file is judged on the same occupancy rules once `HUNT_UNREADY_GRACE_MINUTES=5` has passed from its start, rather than being exempt from cleanup for want of a readiness timestamp.

## Operations and verification

Fleet CPU is an equal-host arithmetic mean; memory and hunts are summed. Stale hosts make combined totals unavailable. Monitoring and matchmaking assignments do not prove native player entry or hunt completion.

Rollback regional routing by setting `AUS_REGION=0` and removing the main deploy AUS URL; existing preference rows are retained. Move affected players to Main in launcher Settings. Preserve the shared account database and drain active worlds before stopping a worker.

## Launcher and firewall migration checks

Launcher 0.1.23 forwards `huntRegion` through the preload IPC bridge; earlier region-enabled versions could discard the selection and redraw Main. The preload regression executes the actual bridge and checks both region values survive a settings reload.

When moving a worker's game directory, inspect the application filter as well as UDP ports and remote addresses on `DauntlessRevived-GamePorts-Allowlist`. An existing program-specific rule can still point to the old executable even while the allowlist helper reports healthy. Set its program to the deployed `GAMESERVER_BINARY_PATH` (or preserve an intentionally unrestricted application filter); do not clear the authenticated remote-address restrictions. The helper updates ports/addresses but preserves existing application filters.

Verify actual native `connections` after the change. A successful CITY assignment, a bound UDP socket, and healthy backend/allowlist processes alone do not prove that players can reach a world.

## CPU admission and strict AU capacity

Enable `GAMESERVER_CPU_GUARD=1` on each deploy host. New temporary game processes are refused while smoothed host CPU exceeds `GAMESERVER_CPU_LIMIT_PERCENT` (80), resuming below `GAMESERVER_CPU_RESUME_PERCENT` (65). Samples run every two seconds. Existing worlds are not evicted by the guard. CPU admission failures use the same bounded capacity wait as RAM/hunt limits.

Main can automatically overflow new hunts to AUS after EU capacity rejection. `AUS_RESERVED_HUNTS=8` on both the Main router and AUS worker preserves eight of AUS's configured hunt slots for direct AU requests; EU overflow requests are marked and checked again at the worker against running plus pending launches. Set `AUS_PUBLIC_HOST` on Main to the expected AUS advertised host to reject a misrouted worker reply. This check applies to explicit AU requests only.

AU never falls back to EU. Cross-region parties follow the leader. Set `WORKER_DOJO=1` on AUS so training also stays local. Solo candidate reuse includes the saved region so a previous EU assignment cannot survive a switch to AU. Players must use launcher 0.1.23 or later and press Play after selecting Australia to save the account preference; the stock game's region UI is not the launcher preference API.
