# Training Grounds regional rejection

Confirmed US deploy log: `Matchmaking for SHARED ShatteredIsles_TrainingDojo failed: Hunt worker does not accept this world`; main routing returned HTTP500. US and EU overflow had HUNT_WORKER=1 and WORKER_RAMSGATE=1 but lacked WORKER_DOJO=1. Germany already enabled it. Regional routing intentionally retains Training Grounds in the selected region; changing routing to EU would mask the configuration mismatch.

Staged WORKER_DOJO=1 on US and EU overflow; user explicitly approved immediate maintenance. Applied only this configuration change with original-hash checks and backup at each root's staging/training-grounds-20261017/deploy.env.before. Restarted their deploy tasks and owned games. No source/DLL change or main/Germany restart required. The initial staged file failed a newline validation before mutation; regenerated with Environment.NewLine and applied successfully.

Validation: direct worker SHARED requests returned200, US port8774 and overflow8774 with persistent session IDs. Main allocator requests for regions main/us/ger all returned200 with correct regional destinations: main8776, US8774, Germany18896. These are server-side launch/routing checks; player completion of loading remains unverified.

Preserve WORKER_DOJO=1 on regional workers whenever rebuilding their deployment configuration. It enables the on-demand persistent dojo; it does not alter hunt caps or CPU admission thresholds.
