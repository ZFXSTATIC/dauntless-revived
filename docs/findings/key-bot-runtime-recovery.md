# Key bot runtime recovery (2026-10-08)

A running scheduled task and Node process do not establish Discord readiness.
Production had empty bot logs while the process remained alive. A restart restored
application authentication and command registration. The original stall location
was not captured, so its root cause is unconfirmed.

The bot now exits after two minutes without gateway readiness, allowing its
existing supervisor to restart it. Startup stages and safe numeric HTTP failure
statuses are logged without credentials, invites, or interaction payloads.
Counter initialization no longer delays the key-ready log. Backend requests have
a 15-second timeout: a live read took 4.7 seconds against the previous five-second
limit. This tolerates short load spikes; it does not fix backend saturation.

Claims still defer ephemerally and re-display the same persisted unused invite.
They do not issue replacement codes or depend on DMs. Thirty bot tests passed,
including uncertain-response recovery, concurrent claims, and private replies.

The same deployment incorporated upstream through `88e6bcf`: weekly Middleman
limits, the no-Platinum-price client fix in launcher 0.1.28, five-second public
grouping, native duplicate-ability prevention, and wall-clock empty-world expiry.
The server DLL built from `df91e1c` has SHA-256
`B3D693D441468CF56E27105A6BF93CD55ECC93E364103A2C5516EBC472AB1E06`.
It is a server runtime build; launcher 0.1.28 retains its upstream packaged DLL.
All four hosts were restarted onto the server build. Metagame matchmaking/party
tests (79), worker tests (25), Middleman tests (4), and native idle-policy checks
passed. Host health and allocation checks do not prove player travel, completed
hunts, or lag-free combat.
