# Hunt cap increase — 2026-10-17

Owner authorized maintenance now, ending active hunts on US and EU overflow. Raised EU overflow MAX_HUNTS36→42 and US32→38. Configuration hashes checked against staged plans before stopping and before writing. Original config backed up per host in staging/cap-increase-20261017/deploy.env.before.

Only each host's deploy task and owned game/deploy processes were restarted; no DLL or application modules changed. CPU guard remains enabled at80percent (resume65), memory guard enabled with4096MB floor. Available physical RAM before maintenance was approximately41.8GiB EUoverflow and15.5GiB US.

Verified both scheduled tasks Running and deployment port61001 listening: EUoverflowPID11444, USPID13276. New processes logged matchmaking requests. The already-known US TrainingDojo routing rejection remains separate from hunt-cap limits.
