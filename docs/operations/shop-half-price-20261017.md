# Half-price cosmetic shop — 2026-10-17

Owner selected50percent off: full armour kits and dyes5000Rams, weapon skins2500, small cosmetics750, flares/sigils250. Mixed bundles sum their discounted components, capped at5000. Changed canonical PriceInRams; the native transport continues to carry the same canonical charge and description. No weekly rotation or account balances were changed.

58pricing, storefront and layout tests passed, covering actual currency debit, insufficient funds, concurrent competing purchases, duplicates, retries, and price-change rejection. Existing pending tokens whose price no longer matches are rejected rather than charged at the old price; reopen shop to obtain the current offer.

Verified deployed ramspricing.js matched the original compiled source before replacing only that module. Backed up under C:/DauntlessRevived/backups/shop-prices-20261018-001231 (host-local timestamp), verified hashes, and restarted only metagame through the supervisor.
