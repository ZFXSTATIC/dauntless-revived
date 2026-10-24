# Shared chat capacity, October 8

The realm exceeded the chat service's hardcoded 64 WebSocket connections.
Production logged `chat: refused a connection ... (too many connections)` while
the multi-region realm had over 100 players. All regions share this service.

The ceiling is now 512 connections; login deadlines, per-address unbound limits,
authentication and abuse controls remain. A regression test logs in and binds
100 distinct authenticated accounts. All 65 chat, friend and presence tests pass.
Live friends/eos/controller/presence file hashes match the tested build.

GOLLUM's friend-request UI failure has not been reproduced; no successful
in-game friend retry has yet been observed. Do not equate a successful backend
test or removal of chat saturation with proof that his friend UI is fixed.
