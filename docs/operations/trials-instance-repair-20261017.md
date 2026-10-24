# Trials weapon-part inventory repair — 2026-10-17

Root cause: Lady Luck's17weapon specials/mods were configured as stacked grants. Fresh extraction of Archon_16-WindowsClient.pak, Archon/Content/Gameplay/Backend/Catalogs/Gear_Catalogs/weapon_part_catalog.uasset/.uexp, shows all117weapon parts explicitly serialize IsStackable=false. PART_EB_SPECIAL_PARRY and PART_MS_PASSIVE_TRIALS_02 also serialize bIsAccountItem=true. Existing tests checked the erroneous stack and therefore passed despite unusable client unlocks.

Changed those17catalog grant kinds to instanced. Added a regression buying/replaying both reported items, checking one instance with instanceId, zero stacks, ownership and exact750total Steel Marks debit. All27LadyLuck/Trials tests pass.

Production repair selected only parts backed by redeemed purchase receipts, re-read inventories within one immediate SQLite transaction, preserved existing instances and all currency, removed invalid part stacks and inserted missing deterministic instances. Recorded inventorylog entries and wrote before/after backups. Repeating repair does nothing; fixture also verifies an unpaid stack is untouched and existing instance is not duplicated. Converted23parts for22characters.

Catalog backup: C:/DauntlessRevived/backups/trials-catalog-20261018-011230.json.
Inventory backup: C:/DauntlessRevived/backups/trials-instance-repair-1792282374135.json.
Repair script staged at C:/DauntlessRevived/staging/shop-prices-20261017/Repair-Trials.cjs.
Restarted only metagame to load corrected catalog; hunt processes were not restarted. Actual client equip verification remains pending after reconnect.
