# Backend connection refusal recovery — 2026-10-17

At approximately 22:38 UTC, the main backend PID 10724 remained alive and had recently reported listening on 61000/61099, but repeated local Node fetches failed immediately with ECONNREFUSED on 61000. Deploy61001 and dashboard61110 still responded. About7GB RAM was free, and supervisor had not restarted backend since the earlier scheduled clock deployment. A live process/listening-port snapshot was therefore insufficient evidence of HTTP health.

Ran Stack.ps1 restart -Only metagame -NoBackup through the existing supervisor. No hunt process restart was requested. Subsequent authenticated backend status, account listing, server status and moderation history returned200 in17–47ms. Public HTTPS /dauntless-status returned200. Dashboard reported no error and five hosts reporting; sample listed267 players, NA29 hunts, Germany23, EUoverflow36. Main hunt count was unavailable.

This is recovery evidence, not a verified root cause. Earlier slow responses and this connection refusal may have separate causes; do not describe the incident as fixed permanently or attribute it to dashboard changes without further evidence.
