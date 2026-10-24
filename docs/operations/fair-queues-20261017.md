# Ramsgate capacity waits and hunt priority

Existing direct CITY allocation already preserves MATCHING on confirmed capacity503 and renews a60-second idle lease when polled. Keep this protocol rather than holding an HTTP request open or masking ambiguous launch failures. A20-minute active-poll integration test now verifies the same candidate remains matching and later travels. Actual client loading-screen presentation still requires an in-game test.

CapacityTurns now includes CITY as well as ISLAND, using separate region/world-mode lanes. Unresolved allocation attempts block newer candidates in that lane; original queue age and a sequence tie-break survive retries. Other regions and city/hunt lanes progress independently. Priority applies to candidates presented for allocation; not-yet-eligible public groups still follow existing group assembly. Serialization includes allocation response time, so throughput must be observed after deployment. It does not add physical capacity.

Regression found during testing: private solo capacity retries entered the public map and merged waiting public players. Marked queue privacy explicitly and excluded private retries from public reinsertion/merge. The failing test observed private2 and public in the same allocation roster; after repair both private allocations remain single-player.

Validation: TypeScript builds and69 focused matchmaking tests pass, including20-minute CITY waiting, city FIFO despite newer-first polling, independent hunt lane, cancellation, delayed allocations and roster isolation. Only matchmaking.js and capacityturns.js staged at C:/DauntlessRevived/staging/fair-queues-20261017 with actual-live before hashes and backup/restart script. Not activated yet; needs backend-only restart, potentially interrupting login/chat. Hunt processes need not restart. No new custom client queue screen has been implemented.

## Activated

User approved immediate activation. Hash-checked script applied both modules, backup C:/DauntlessRevived/backups/fair-queues-20261018-020915. Backend-only restart recovered as PID3468 on61000; deploy PID5976 and hunt processes stayed running. Verification returned publicHTTP200, dashboard error:null, fivehosts reporting,213players and huntcounts9/32/21/34 on gamehosts. This supersedes staged-only status above. Client waiting-screen presentation and live saturated-queue fairness still require gameplay observation; automated69-test coverage remains the behavioral evidence.

## Party expiry follow-up
A party candidate still expired after five minutes when capacity waiting cleared LaunchDeadline. Its retry could silently finish while MATCHING entries kept touching FIFO priority. Added a CapacityDeadline renewed only by matchmaking status polling, plus explicit failure/release for orphaned candidates. Social polling alone cannot keep an abandoned queue alive.

Validation: TypeScript build and 112 targeted tests passed, including a 20-minute active party wait, idle expiry, and orphan recovery allowing the next hunt. Backend-only deployment backup: C:/DauntlessRevived/backups/party-queue-fix-20261018-025709. This explains a possible Preparing Hunt deadlock; the exact live DragoneerLaila candidate was not proven to be the orphan.
