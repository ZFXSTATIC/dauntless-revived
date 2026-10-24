# CPU admission recovery threshold

User requested new hunts to launch until CPU reaches80%, rather than remaining blocked until65%. Staged and activated GAMESERVER_CPU_LIMIT_PERCENT=80 and GAMESERVER_CPU_RESUME_PERCENT=79 on main EU, US, Germany and EU overflow after explicit maintenance-now approval. One percentage point of hysteresis remains; existing code requires resume strictly below limit. These use smoothed allocator CPU, not an instantaneous hard ceiling on host utilization. Hunt caps and memory guards are unchanged.

Original/staged config hashes were checked; private backups are under each host root at staging/cpu-resume-20261017/deploy.env.before. Worker activation script is Apply-CpuResume.ps1. Main config is data/config/deployserver.env and uses Stack.ps1 restart -Only deploy -NoBackup after the same hash checks. No account database or credentials are included here.

Post-restart dashboard read: error:null, five hosts online, all four game capacities report limit80/resume79, each CPU gate open. New hunt counts were main2, US1, Germany2, overflow5. Main deploy PID5976; metagame5064 and gateway11976 remained online. Gateway TLS/backend check passed. This verifies activation and new allocations, not a guaranteed matchmaking wait time.
