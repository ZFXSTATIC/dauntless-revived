# Dashboard slow-backend handling — 2026-10-17

Live probes authenticated successfully but a BackendHealth response took 10,315 ms (HTTP 200). The dashboard previously aborted backend requests at 8 or 10 seconds, while browser reads aborted at 5 seconds. This can report an available, slow backend as unavailable and abandon moderation responses. It does not prove every historical disconnect has the same cause.

Raised bounded dashboard/backend requests to 30 seconds, browser reads to 35 seconds, and moderation writes to 65 seconds (optional observed-IP lookup plus write). Writes remain single-attempt; an ambiguous failure still tells moderators to refresh status before retrying. Account totals are cached for 60 seconds instead of fetching the full 620 KB account list each poll; account search/recovery remain uncached. Failure messages distinguish timeout, rejected credentials, HTTP status and connection failure.

All 16 dashboard tests passed, including a 10.5-second moderation response that completes once and account-cache reuse across polling intervals. Patched the actual production dashboard and client rather than overwriting fleet-specific deployed changes. Restarted only the dashboard task; backup: C:/DauntlessRevived/backups/dashboard-timeouts-20261017-233411. No account moderation state was changed during verification.
