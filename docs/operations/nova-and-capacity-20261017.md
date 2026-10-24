# Nova mutation enforcement and capacity waits

Static inspection of the supplied Nova Unlocker 1.0.3 C# source found direct
HTTPS account login and inventory edits, not a necessary game-process injection.
The supplied program was not compiled or executed. AccountBackend.cs,
EquipmentBackend.cs, GameplayBackend.cs, TonicsBackend.cs and PlatinumEditor.cs
provide seven exact mutation source markers. Software identity is not attested:
renaming or modifying the program cannot be reliably detected by these markers.

Authenticated non-gameserver requests with an exact marker and a nonempty inventory
delta are rejected before inventory processing. The authenticated actor receives
the existing seven-day account suspension, with bounded evidence in the dashboard
moderation log. Body account/character IDs cannot select the sanction target.
Existing bans are preserved; protected administrator accounts are blocked without
automatic suspension. Reads, empty connection probes, names and user agents are
not ban evidence. No automatic IP/device ban is added. Existing JWTs fail their
next authentication check; this does not promise an immediate native UDP kick.

Production inventory code lacked the repository's two client-authority checks.
A bounded read-only audit of the latest 10,000 inventory log rows found only
gameserver/store callers, including crafting, updates, rewards, quickslots and
transmogs. The deployed controller candidate adds only those two checks: public
client inventory mutation is refused even if Nova markers are removed. Trusted
server and shop operations retain the existing validation and transaction paths.

Searching cancellations were independently confirmed in live matchmaking logs:
active candidates were cleared with `capacity wait expired` while CPU/memory/hunt
admission rejected allocations. Production lacked the active-poll deadline renewal
already in source. A bounded patch renews active waits and honors Retry-After;
abandoned requests still expire. Resource guards remain enabled. This fixes the
fixed-minute cancellation, not an absence of available server capacity.

Validation: three detection tests; five inventory authority tests; 68 shop,
loadout and fusion tests; 43 matchmaking tests run against the exact patched
production matcher. The exact production authority candidate also passed a
pre-write denial check. Build and staged JavaScript syntax checks passed.

Deployment uses four verified files: inventory route/controller, the new detection
helper and matchmaking controller. Existing production files are patched directly,
preserving unrelated live code. Only metagame is restarted through the existing
supervisor; hunt processes are not restarted. No database migration is introduced.
Local staging and before/after manifest: `C:/dr/nova-defense-live-20261017`.

Applied and verified: all four live file hashes match the staged manifest;
metagame restarted as PID 11476, HTTP health returned 200, chat listened, and an
unauthenticated inventory POST returned 401. Existing hunt processes remained
running. Health latency was about 6.4 seconds during one loaded sample, so this
does not establish that overall capacity or latency is resolved.

Separate remaining issue: sampled deploy 500 errors were Training Grounds routed
to the NA hunt worker, which rejects that world when its dojo support is disabled.
Those were not misclassified patrol-capacity errors; no worker policy was changed.
