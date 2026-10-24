# Black Cat hairstyle unlock (1.4.4)

The cooked `/Game/UI/Appearance/appearance_hair_asset_table` maps the display
name `Black Cat` to the entitlement `ent_cchs_blackcat`. Grant it permanently
through the account entitlement API (`Duration: 0`).

`CC_HAIR_DOUBLEBUN` is a different hairstyle. Adding that catalog item to the
inventory does not unlock Black Cat. Character-creator catalog display names
can contain misleading Warcrest placeholders; use the appearance table's
DisplayName and Entitlements fields instead.

Verified by parsing the installed 1.4.4 cooked appearance table on October 8,
2026. Inventory presence alone does not verify visibility in the appearance UI.
