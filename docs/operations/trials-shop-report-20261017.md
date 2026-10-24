# Trials shop report — 2026-10-17

Report: Executioner's Spearhead and Avenging Overdrive purchases appear to do nothing. Reporter identity and whether marks were deducted are still unknown.

Read-only production audit of the most recent5000storepurchases found2 matching receipts, both redeemed; both characters currently retain the corresponding PART_MS_PASSIVE_TRIALS_02 or PART_EB_SPECIAL_PARRY stacked item with positive quantity. Latest matching receipt2026-10-17T23:12:27.240Z. This is not proof the unnamed reporter received/equipped their item, nor proof the client refreshes correctly.

All26LadyLuck/Trials tests passed, including marked-currency debits and one-time grants. TRIALS_STORE=1 live. Need the reporting account and purchase time to distinguish no request, rejected purchase, successful stored grant with stale UI, and a catalog/unlock mismatch. No production writes or refunds made.
