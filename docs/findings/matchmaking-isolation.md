# Matchmaking isolation and zone chat

The join handler honors either `isPrivate: true` or `privateMatch: true`. A solo
private join leaves its waiting public queue and starts an isolated roster immediately.
Public solo players selecting the same player-hunt ID continue to share batches of four.
Party candidates retain the existing party-only roster. Public parties are not yet
backfilled with strangers. The client exposes Skip Matchmaking through hunt selection;
private rejoin requests now bypass the public wait, but the in-game button still needs
a live check.

Deployment now returns the native process's session ID. Matchmaking uses that ID for
`serverInfo.gameSessionId`, while each request retains its own candidate ID. Previously,
players traveling to the same Ramsgate process received different game session IDs:
live chat logs showed separate `City-<id>` rooms with zero existing occupants. The
shared native ID also survives overflow forwarding. A replacement native process has
a new ID. Automated tests cover shared city sessions; two-player chat needs a live check.

Startup RAM reservations are released after the native listening marker, when the
loaded world is included in OS memory usage. The configured free-memory floor still
applies to every new launch. Legacy launches without a marker retain the timed reserve.
This avoids double-counting loaded worlds for the full reservation interval; it does
not create capacity when both hosts are actually full.

Native guards now reject missing worlds/net drivers, skip null connections/levels and
invoke player stamina only on the expected player-character class. These remove unsafe
dereferences and a known unchecked cast; no crash dump established them as the cause
of all reported native crashes. Full hunt/patrol/escalation completion remains a live
acceptance check, including inventory and escalation progress after reconnect.

The Discord bot persists a delivery reservation before sending an invite. Concurrent
claims, restarts and ambiguous Discord timeouts cannot send additional invitations.
An explicit Discord `50007` rejection permits retrying the same saved code. Existing
claim records without delivery history are treated as already sent; recovery requires
operator review of the existing code, never minting another one. `/key link` continues
to link the existing account without rotating its launcher key.
