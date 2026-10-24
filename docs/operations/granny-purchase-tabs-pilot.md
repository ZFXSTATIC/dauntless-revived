# Granny purchase-tab pilot

The first UI-only pilot failed: a read-only snapshot of the open test screen showed Vendor=Potions, CachedVisibleTabsCount=1, CraftingMode=Craft. Its two visible tonics both had PurchaseItemId=CURRENCY_NOTES and PurchaseCost=350 but MaxCanPurchase=0, while the isolated database held 86000 Rams. Requiring two existing tabs could never restore a missing Purchase tab.

Native 1.4.4 analysis shows the purchase-affordability path queries PurchasesAtVendorFeature before setting purchase flags and calculating MaxCanPurchase. This feature's default object has bEnabled=true, so reading that bit alone is insufficient: the world-aware check also applies overrides/caching. Native IsFeatureEnabled body RVA0x14B0F70 is used in the tonic calculation at0x1777945.

The revised pilot hooks only that exact feature class when DR_GRANNY_TEST=1, passing every other feature check through. It lets the native screen construct the tab, preserves its normal handlers, and removes the first pilot's category-handler suppression and forced visibility. Both the isolated client and isolated hunt server receive the flag. All prices, inventory transactions and crafting recipes remain native. Release x64 build succeeds with MSVC14.44.35207.

Only C:/dr/anticheat-test receives the experimental DLL. No live rollout or release packaging. Runtime tab count, purchase/debit/grant/persistence and crafting still require validation. Enabling the underlying vendor feature may also expose priced options at other vendors inside the isolated test; check them before considering production use.

Native registration/disassembly resolves OnChargeButtonTabSelected bodies0x1765800 (category decoration) and0x17658e0 (screen mode switching). The former contains an unchecked SelectedImage dereference, but no runtime crash stack proves that it caused the reported crash. The revised pilot does not depend on that hypothesis.

## Runtime correction
The feature hook was verified installed by its patched entry bytes in PID27260, but the test character's CR19_S5_Q2C2_Bosun_PotionPurchase was still Unavailable (0), GUID677F72274A760FA35B29338D6E45AD79 in CR19_SERIES_4_HARD_PROGRESSION. Completing only existing serialized quests had missed newly initialized series. A read-only snapshot collected264 actual quest IDs across38 series; the isolated account was backed up and those quest records marked Redeemed. After reconnect, the quest was Status3 and all eight normal tonic models had MaxCanPurchase=10, with native prices200/275/350.

PID21628 then had two registered tabs, valid PurchaseTabButton DataModel and SelectedImage, but the container was Collapsed. The current pilot restores visibility only for the Potions vendor with two initialized tabs and valid purchase decoration references; native handlers remain unchanged. It does not relax the quest gate or invent prices. Native Release x64 build passes. The test account received100 each of the seven ingredients identified from native tonic recipes via the normal inventory endpoint (HTTP200), transaction granny-test-materials-v1. Baseline86000 Rams and stack counts are saved privately for comparison. Purchase/crafting acceptance remains pending.

Read-only UWidget visibility is at0xCB in this SDK; the initial screen probe mistakenly read0xB1, so its earlier visibility value was invalid. TabCount/quest/item offsets were checked separately.

## Accepted isolated gameplay test
User confirms both crafting and Rams purchases work in the reopened test build. Saved inventory audit confirms two purchases of10 QI_BOMBING_RUN at7000 Rams each, two purchases of10 QI_STAGGER_POTION at2000 Rams each, and one craft of10 QI_STAGGER_POTION consuming10 GATHER_DAMAGE_01 and10 GATHER_WEAPON_01. Rams86000->68000 exactly matches18000 of purchases; final relevant stacks are20 Airstrike Beacons and30 Assault Tonics. Each debit/material removal and item grant shares its inventory transaction ID. No crash dump was produced during this test.

Verified: normal purchase, bulk purchase, crafting, saved database persistence. Not yet verified: low-funds rejection, restart/reconnect UI persistence, other vendors, and whether the feature hook can be removed while retaining only the potion-tab visibility fix. Test-only rollout remains in force.
