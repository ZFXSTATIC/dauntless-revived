# Hunt lifecycle and locale rollout, 2026-10-17

Activated during authorized maintenance: four live game hosts have a checked patch under
`staging/hunt-patch-20261017`. Main EU is a deployed folder, not a Git checkout.
The patch preserves each host's existing deploy code, adding readiness timestamps
and a 15-second non-overlapping watchdog, plus the tested hunt-lifetime module.

Ready hunts require 120 seconds of continuously observed zero connections before
closing (normally 120–135 seconds with polling). Positive counts, missing/stale
telemetry or long observation gaps reset the timer. Connections still joining count
as occupied. Ramsgate and Training are exempt. Age alone no longer kills occupied
hunts. Existing child-exit cleanup releases crashed server allocations.

Set `HUNT_EMPTY_MINUTES=2` and removed extra startup grace during activation.
Prior NA/EU overflow settings used ten minutes. Applied caps: NA 26→32 and EU
overflow 30→36. Both retain CPU limit 80/resume 65 and memory admission. Read-only
preflight found NA at 26 hunts, ~61% CPU, 14.6 GiB free; EU overflow at 30 hunts,
~50% CPU, 41.4 GiB free. A higher cap does not override resource admission.

Final native build: source commit `9245d3f` plus the two-minute `HuntIdlePolicy`
change. No experimental combat changes. DLL SHA-256:
`467303165F05FF37D51C58CEE3C2E9D35B00BB2A3F52743591648FEB74C02893`.
Both idle timers must agree: the older native timer used 30 seconds after a player
had connected, or 180 seconds before anyone joined. It now requires 120 continuous
empty seconds in both cases and resets on pending/open connections. Native tests
cover both cases, reconnect resets and occupied intervals.
French/German/Italian decimal parsing regression tests passed for current and new
threads. The command-line hook returns `-CULTURE=en-US`; CRT locale is set to C
before server hooks. An actual hunt part-break check remains necessary.

Observed live disk DLLs: main EU, NA and Germany used `BEB17A8F…`, containing the
culture argument; EU overflow used `87AECD7B…`, lacking it. Absence of the locale
diagnostic text in a binary string scan is not evidence that its code is absent:
the tested Release compiler splits that literal. Verify new process runtime logs.

DeployServer suite: 99 tests passed. Per-host staged JavaScript syntax checks pass.
Live files/config hashes are recorded in staged manifests to detect concurrent edits.
All four hosts were backed up and restarted. The first NA attempt missed game
processes because CIM executable paths contained repeated backslashes, leaving the
DLL locked. Original files and the task were restored; normalized matching and an
exclusive DLL-open check fixed deployment. Rollback attempts service restart even
if a restore copy fails. Main deployment does not require a Git checkout.

EU overflow logged seven deploy watchdog closures with `reason=empty` at process
ages 2.17–2.32 minutes, while 27 other hunts were occupied. CPU/memory admission
remains enforced even below the increased caps. After the first locale rollout,
runtime locale markers were verified on all observed game processes on all hosts;
the final native timeout alignment was then applied with scoped hunt restarts.

The historical zero-health/no-down report remains unresolved. TFBTA and Laila were
named, but no currently stuck character was identified. Display health and server
health are separate; do not force healing or death without identifying which state
is wrong. No speculative combat changes are included in this patch.
