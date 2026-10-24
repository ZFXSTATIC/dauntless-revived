# Two Ramsgate instances

The main deploy server can balance CITY allocations between its own Ramsgate and
the overflow worker's persistent Ramsgate. Parties in one allocation stay together.
Existing occupants are not migrated.

Main deploy environment:
- `CITY_OVERFLOW=1`
- `CITY_STATUS_KEY`: a local metagame administrator key, stored only in the protected environment file.
- `RAMSGATE_PLAYER_LIMIT=24`: admission target per city, maximum 32.
- `OVERFLOW_DEPLOYSERVER_URL`: the existing HTTP loopback SSH tunnel.

Worker deploy environment: `WORKER_RAMSGATE=1` alongside `HUNT_WORKER=1`.
The worker prewarms Ramsgate on `PORT_RANGE_END`. Permit that UDP port through its
allowlist and hosting firewall. Keep all advertised game ports distinct across
hosts because existing status/matchmaking attribution uses ports.

Routing prefers each game process's bounded, count-only native diagnostic snapshot, falling back to the metagame's authenticated occupancy snapshot, and 45-second landing
reservations, prefers the less occupied city, and keeps concurrent parties within
the admission target. Explicit worker unavailability/capacity can fall back to a
city with space; unknown launch failures are surfaced rather than hidden. Both
full returns the existing capacity response. Occupancy is heartbeat-based, not
an authoritative native hard player cap.

This requires an extra persistent game process on the worker. Keep its memory
guard enabled; hunt admission may wait sooner while Ramsgate consumes RAM/CPU.
Disable `CITY_OVERFLOW` to restore main-only routing before disabling the worker.
