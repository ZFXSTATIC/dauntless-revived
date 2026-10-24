# Windows local relay process guard (prototype)

The Windows public-mode launcher authorizes each HTTP/chat connection against the
PID of the game it launched. It matches the client-side TCP table row using both
addresses and ports, not the server-side row owned by the launcher. Other callers
receive 403 before credentials or save requests reach the upstream server. It does
not terminate PowerShell, the launcher, or the game when another process connects.

Checks use the Windows system netstat executable, with hidden windows, a two-second
timeout and a 4 MiB output limit. Concurrent new connections are batched (64 pending
maximum); a missing row gets one fresh retry. Only the verdict for the same socket
is reused for keep-alive requests. Game exit closes the relay and clears the game
PID. Unknown ownership is denied. Connection-state text is not matched because it
can be localized.

Validation on Windows: real sockets accept the approved PID and reject another PID;
a real PowerShell exchange-code request receives 403 without reaching the test
upstream. Approved HTTP keep-alive and WebSocket chat succeed. The relay suite also
covers 32-connection bursts, queue limits, lookup errors, missing-row retries and
localized output. A TCP table read measured approximately 44–52 ms on the test PC.

Not released: verify a packaged launcher with actual game login, Ramsgate, a hunt,
shop purchases, chat, game exit and relaunch before publishing. No live server or
existing installed launcher was changed by this prototype.

Scope: Windows public-mode local relay only. Linux/Wine/Proton retain their existing
behavior because wrapper PIDs do not identify the socket-owning game process.
Private/offline modes, old/modified launchers, direct authenticated gateway access,
and code running inside the approved game process are outside this boundary. This
blocks a separate exporter using the guarded relay, not all possible save exports.
