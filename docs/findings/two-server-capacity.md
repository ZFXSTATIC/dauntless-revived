# Two-server hard capacity and Discord counters

Primary DeployServer: `OVERFLOW_AFTER_HUNTS=4`, `MAX_LOCAL_HUNTS=5`.
Hunt worker: `HUNT_WORKER=1`, `MAX_HUNTS=3`.
Both DeployServers stay on loopback. Keep the existing SSH tunnel and per-host public
game address; never substitute the primary address for a worker allocation.

The threshold chooses a preferred host; the hard limits apply inside native process
allocation on each host. A slot is reserved synchronously before any launch-queue wait.
Once the process enters the running list, its reservation is released, without an await
between the two operations. Failure releases the reservation exactly once. Ramsgate
and Training Dojo do not consume hunt slots; tutorials do. Memory and UDP-port admission
still apply. Both hosts full produces `capacity_unavailable` with reason `hunts`,
`memory`, or `ports`; metagame keeps its bounded retry policy. Missing hard-limit settings
retain compatibility with older installations; production must set the values explicitly.

`GET /gameservers` includes local `{running,pending,limit}` capacity. Routing logs record
the requested hunt, load, preference, selected address, worker health and refusal.
An ambiguous remote POST timeout never falls back locally and creates a duplicate.

Merged upstream PR #18 through `e8e106a`: automatic per-launch readiness markers,
exclusive UDP probes released before spawning, two bound UDP samples when no marker
exists, child exit/error detection, and liveness checks immediately before handoff.
The native DLL guards and shared zone-chat session IDs are retained. This verifies
listener handoff, not completion of an actual hunt or save from a game client.

`/counter category_id:<id>` is executable only by Discord account
`1121938502947459152`. It requires Manage Channels and Discord's Server Members Intent
in both code and the Developer Portal. It renames the category to **📊 Live Counter**
and reuses/creates Bots, Users, and Total voice counters. Everyone is denied Connect
and Speak; the bot retains View Channel and Manage Channels. Configuration lives beside
the protected key-claim state in `counters.json` (or `COUNTER_STATE_FILE`). Restart,
join/leave, and command execution refresh counts; unchanged names are not edited.
Join/leave bursts are coalesced, and failed refreshes retry periodically. No category
is changed until the owner executes the command.

After deployment, manually test a public paired hunt, a private party, Skip Matchmaking,
Blaze patrol, Pangar pursuit, and an escalation through completion on the worker. Verify
rewards and escalation progress after logging out and back in, plus two-player zone chat.
