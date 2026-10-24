# Key bot recovery, 2026-10-17

The bot was connected, not stopped. At 20:48–20:54 UTC, claims failed with
backend fetch errors/timeouts and transient Windows EPERM when atomically replacing
`C:/DauntlessRevived/data/discord-keys/keys.json`. Subsequent attempts sometimes
succeeded. Three read-only backend health requests took 8545, 1805 and 1169 ms;
backend responsiveness remains a separate concern, not a confirmed bot crash.

Applied a narrowly scoped patch to the actual live `discord-keys/keys.mjs`:

- Retry atomic rename on Windows EPERM/EACCES/EBUSY six times over 3.15 seconds,
  retaining the original file, flushed temporary snapshot and cleanup behavior.
- Retry a failed GET once for a fetch TypeError, using the same 15-second deadline.
  Never automatically retry a mutation, HTTP error or expired request.

Live source differed substantially from the old launcher checkout. Deployment
required its baseline SHA-256 to equal
`2AF19A8A8B2DDCBB83459F9EC95A9A0AF0FBA9C9B465E6D9328CE7E848262EA2`.
The newer recovery journal, global queue and moderation behavior were preserved.
Do not deploy the old checkout's whole bot over the live implementation.

The live source and state were backed up under
`C:/DauntlessRevived/backups/keybot-recovery-20261017` while the bot was stopped.
Only the Discord keys task/process restarted. The bot logged ready at 21:03:55 UTC
and a real claim logged `private_sent` at 21:04:02 UTC. No game/backend restart.

Validation: 36 tests passed against the actual live source copy, including durable
recovery, concurrent claims, preservation of the original state on failed writes,
bounded retries and no duplicate mutation requests. Local recovery workspace:
`C:/dr/keybot-recovery-20261017`. Live backend saturation can still cause timeouts;
this patch does not establish that all delivery failures are eliminated.
