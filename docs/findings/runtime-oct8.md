# October 8 runtime update

Includes upstream c3bd3c9 (Middleman fusion claim handling and native vendor tabs).
The native DLL is rebuilt and its launcher/server-kit pins updated together.

- Tutorial request retries share an in-flight allocation; immediate identical
  retries reuse that player's result for 60 seconds, without sharing tutorials
  between accounts.
- Party members sent to a hunt receive a bounded five-minute loading grace for
  heartbeat-based removal and automatic leader eviction. Explicit leave/kick
  still works. Repeated status polls do not renew the grace.
- Empty temporary worlds are reclaimed after three minutes of continuous fresh
  zero-connection telemetry, with a five-minute startup grace. Missing telemetry
  is not treated as zero. The two-hour maximum remains; Ramsgate and dojo remain
  persistent. HUNT_EMPTY_MINUTES and HUNT_STARTUP_GRACE_MINUTES override defaults.
- Deployment reports native occupancy for every instance, not just cities.
  Launcher instance counts prefer those measurements over heartbeat attribution.
  Account-level online counts still use authenticated player activity.

Validation: 76 party/Middleman tests, 17 status tests and four lifetime tests
passed. Native Release x64 build passed. Full player hunt completion and the
reported in-game party-kick scenario still require a live retest.
