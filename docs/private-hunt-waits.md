# Private hunt handoff

Private solo hunts allocate immediately and are never added to the public hunt queue. Party candidates also launch without waiting for public players. Native listening readiness and capacity checks still apply; skipping those can send players to an unopened socket or overload the host.

The join and status replies now advertise a one-second `candidateStatusPeriodMillis` for private and party candidates, instead of ten seconds. This reduces the delay between a server becoming ready and the client's next status request; it does not make cold startup or a full server instantaneous. Public queues retain their existing polling interval.

`matchmakingfailure.test.ts` covers immediate private allocation while a public player waits for the same hunt, one-second polling, no connection before readiness, and exclusion of the public player from the private allocation.
