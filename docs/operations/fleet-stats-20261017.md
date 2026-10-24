# Fleet statistics and Discord status

The dashboard's fleet hunt total depended on main-host performance CSVs, while performance logging was disabled. One null main count made the combined graph unavailable. Discord separately queried local allocator capacity, explaining the apparently contradictory total. Main dashboard sampling now queries the local allocator too; worker health carries timestamped allocator capacity. No aggregate gameserver list is counted as local capacity.

Fresh capacity supplies running/pending/limit and CPU admission thresholds. Invalid or stale capacity is unknown, with timestamped process telemetry used only where available. A failed worker deploy probe no longer masquerades as zero hunts. The key-bot host is explicitly not a hunt host. Incorporated the existing live fifth-host configuration into repository code.

Discord projects only public numeric/boolean fields, displays all five hosts, distinguishes capacity/CPU blocks, shows RAM utilization and sample freshness, and does not advertise CPU/count headroom as guaranteed admission. Existing status message is edited, never replaced.

Validation: 42 monitoring tests passed. Deployed dashboard and Discord worker on main; health monitors on US, Germany and EU overflow. Only monitoring processes restarted. Main live Discord entrypoint is discord-status/worker.mjs (Run-Status.ps1), not the older discord-status.mjs beside it. Read-back of the actual Discord message returned HTTP200 with all five enhanced host fields and a fresh lastSuccess. Authenticated dashboard read returned error:null, five online hosts and 84 hunts (6+0+32+16+30), plus capacities10/38/96/42 for game hosts. Historical missing chart samples cannot be reconstructed; fresh samples populate the graph after refresh.

All four game hosts were CPU-blocked at verification. Monitoring repair exposes this pressure; it does not resolve capacity shortages or establish shorter matchmaking waits.
