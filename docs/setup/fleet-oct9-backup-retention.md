# October 9 fleet update and backup retention

PR #42 source revision `7f70c84a837f7f1115addec9add0270591838115` was deployed to the central metagame and all four deployment controllers. All four game hosts received the `internal-server-dll` artifact from successful CI run 37960570493, SHA-256 `f1de8581491099ea40d6fb166d7f2732273ae616ccd9e999ba2d3084de858260`. This is the CI-built artifact, not the separately built workstation candidate hash quoted in the PR. Application/DLL rollback copies are paired on each host.

Local validation: 723 metagame tests, 86 deployment tests, both TypeScript builds passed. The owner authorized the coordinated restart. Subsequent worker snapshots reported complete observations and connected players in EU overflow, AUS and Germany. This is not proof of full hunt completion or a controlled CPU benchmark.

Main-host cleanup removed 53 old database copies (97.46 GiB), preserving the newest database that passed SQLite quick_check. No live database was removed. Free space increased to approximately 109 GiB. Non-database rollback files were retained.

Windows backups now retain one completed database by default (`Hourly=1`, `Daily=0`). Retention runs only after the new database is checked and required existing secrets are copied successfully. Failed or missing database copies do not retire the last recovery point. Germany's weekly receiver similarly deletes older matching database copies only after transfer, SHA-256 verification and SQLite quick_check succeed.

The existing 60-second backup budget could not copy the approximately 6.7 GB live database. Copy budgets are now 15 minutes, with the HTTP client waiting slightly longer; writer-connection backups, exclusivity and integrity checks remain. Separate-connection copies can restart under live writes and must not replace the writer endpoint.

Germany retains its 30 Hz native frame cap and CPU admission guard. PR #42 caches channel assignment information to reduce cold-join scans; this spends modest memory on lookup state, rather than pretending spare RAM can substitute for CPU. Do not lower tick rate or raise process limits solely because memory is free.
