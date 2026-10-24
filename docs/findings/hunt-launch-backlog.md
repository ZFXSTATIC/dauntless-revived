# October 8 launch backlog

Germany was accepting 61 pending launches with ten seconds of pacing per spawn.
That backlog alone exceeds the 120-second remote request deadline, so requests
could fail before their processes even started. Running capacity is not a safe
limit for the number of launches waiting to spawn.

HuntAdmission now allows at most two pending spawns per worker. Rejections use
the existing capacity response and polling retry path. The reservation releases
at spawn, so this does not cap running hunts at two. CPU, memory and port limits
still apply. Existing queued work was cleared by restarting the game workers.

Validation: 40 tests passed across capacity, catalog contracts, regions, game
servers, matchmaking and launch latency. The catalog contract covers 138 rows
including 53 pursuit, 26 patrol and 15 escalation rows. Trials are selected by
the separate rotating arena path. These checks do not establish full in-game
completion or resolve the reported client-specific invisible behemoths.

## Dedicated-host pacing

The owner subsequently requested more throughput on AUS and Germany. Both
already had an automatic ceiling of 96 hunts. Before tuning, AUS had 16 running
at 18% CPU and Germany 13 at 54%; the ceiling was not the bottleneck.
SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP is now 2 on both hosts (previously
5 on AUS and 10 on Germany). Both workers were restarted with config backups.
The two-pending-spawn bound, memory checks and CPU admission at 80/65 remain.
This raises launch throughput, not a promise that all 96 hunts fit under load.

Corrected live probes: AUS Funguy Easy escalation returned HTTP 200 in 7.13s;
Germany Hard Trials returned HTTP 200 in 15.4s. Direct worker requests must omit
Region (or use main); regional routing belongs at the primary coordinator. Earlier
direct-worker probes sent aus/ger and falsely received capacity_unavailable because
workers have no regional routing destination configured. Those probe failures are
not evidence of exhausted capacity. Successful allocation still does not prove
client travel or full combat completion.
