# Hunt runtime stability

Dedicated 1.4.4 processes initialize Phoenix backend endpoints to `127.0.0.1:61000`. An overflow worker therefore needs its authenticated loopback tunnel to the primary metagame before accepting hunts. A launcher-generated `Game.ini` in another Windows account is not a substitute: SYSTEM has a separate profile. The endpoint override is server-side; players do not need a new launcher for this repair.

Empty-hunt expiry terminates only the dedicated process, with exit code zero. Running CRT teardown from the game tick previously left empty processes holding their UDP ports and then faulting. Connected players still prevent idle expiry. A listening socket alone does not prove successful player authentication or completed gameplay.

The custom replication loop preserves owner-only relevancy. Non-moving actors with authored update rates below 30 Hz use a cadence with a conservative 10 Hz minimum. Pawns, controllers, movement replication, tear-off and temporary actors retain immediate per-frame consideration. Initial consideration is immediate; lower-rate state can wait one cadence interval plus a server tick. This avoids treating every background/player-state update as a movement update.

`DR_ServerTickCount`, `DR_ServerSimulatedSeconds`, `DR_EngineMicros` and `DR_ReplicationMicros` are exported cumulative counters. Resolve their RVAs from the exact deployed DLL; addresses differ between builds. Additional counters measure replication attempts, owner-only skips and deferred low-rate actors. Compare rates under similar player counts. Simulation seconds per wall-clock second should remain near one.

When `GAMESERVER_READY_DIR` exists, bounded address-only fault and connection-count diagnostics are written as `native-fault-<PID>.log`. They contain no command lines, keys or player identities. First-chance exceptions are diagnostic evidence, not automatically fatal crashes.

## Windows backups and lag

Separate SQLite backup connections can restart continuously when live players save. Hourly jobs previously accumulated and competed with the game for CPU and disk access. The Windows backup script now holds an OS-released exclusive file lock. Direct/offline copies abort after repeated restarts or a 60-second deadline.

For online copies, set `BACKUP_ROOT` in `metagame.env` to the installation's `backups` directory (new installations do this). `/internal/backup` accepts only direct local requests authenticated with the game-server key, refuses forwarded requests, validates a timestamp-only backup directory, and never overwrites a destination. It copies through the metagame's existing writer connection so normal saves do not restart the backup. Integrity checking runs in the separate helper process after the copy. Keep the endpoint behind the existing loopback-only metagame binding.

If the metagame is stopped, the helper uses the SQLite backup API directly. An ambiguous HTTP timeout never triggers a duplicate fallback. Failed/partial copies are not reported as valid backups. Neither the database journal mode nor player progression is changed by this repair.

Validation: native idle policy, owner isolation and cadence tests; metagame backup authorization/single-flight/overwrite tests; an actual SQLite backup with interleaved saves; and bounded-backup progress/deadline tests. Live deployment observations belong in the operator's private report. These checks do not establish full completion of every hunt or escalation.
