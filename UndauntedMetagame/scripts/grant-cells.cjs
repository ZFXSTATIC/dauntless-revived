// Gives one account stacked cells through the inventory core (the ledger, receipts and revision checks all apply).
// Run only on the box that holds the database, from the metagame folder, with the metagame env loaded:
//   node --env-file=.env scripts/grant-cells.cjs <userId> CELL_LOWHP_BASEDMG_E[=<qty>] [...]            (preview, writes nothing)
//   node --env-file=.env scripts/grant-cells.cjs <userId> CELL_LOWHP_BASEDMG_E --apply --backup-dir <dir>
// Cell ids are CELL_<family>_<UC|R|E>: UC is +1, R is +2, E is +3. The family must be in src/vendor/store_middleman_cells.json.
// Apply: saves the account's inventory row to <backup-dir> first, grants in one immediate transaction under a fixed
// transaction id (running it twice for the same cell and day does nothing), then reads the quantity back.
const fs = require('node:fs');
const path = require('node:path');
const {GetDb} = require('../dist/db');
const {ApplyInventoryTransactionInTx} = require('../dist/controllers/inventory');
const {GetActiveCharacter} = require('../dist/controllers/activecharacter');
// LANTERN_TAP_EFFECTIVENESS (Zeal) is not in the middleman list but live DR players already hold CELL_LANTERN_TAP_EFFECTIVENESS_UC/R/E.
const Families = new Set([...require('../src/vendor/store_middleman_cells.json').families.map((F) => F.id), 'LANTERN_TAP_EFFECTIVENESS']);
const Args = process.argv.slice(2);
const Apply = Args.includes('--apply');
const BackupAt = Args.indexOf('--backup-dir');
const BackupDir = BackupAt >= 0 ? Args[BackupAt + 1] : undefined;
const [UserId, ...Specs] = Args.filter((A, I) => !A.startsWith('--') && Args[I - 1] !== '--backup-dir');
if (!UserId || !/^UID-[0-9a-f-]{36}$/.test(UserId) || Specs.length === 0) { console.error('usage: grant-cells.cjs <UID-...> <CELL_...>[=qty] [...] [--apply --backup-dir <dir>]'); process.exit(2); }
const Grants = Specs.map((Spec) => {
  const [Id, Qty] = Spec.split('=');
  const Quantity = Qty === undefined ? 1 : Number(Qty);
  const Orb = ['ORB_FLAME', 'ORB_FROST', 'ORB_SHOCK', 'ORB_TERRA', 'ORB_PHYSICAL', 'GEM_ALPHA', 'GEM_HEROIC', 'GEM_HEROICPLUS'].includes(Id);
  const M = /^CELL_([A-Z0-9_]+)_(UC|R|E)$/.exec(Id);
  if (!Orb && (!M || !Families.has(M[1]))) throw new Error(`not a known cell or orb id: ${Id}`);
  if (!Number.isInteger(Quantity) || Quantity < 1 || Quantity > (Orb ? 1000 : 10)) throw new Error(`bad quantity for ${Id}`);
  return {catalogId: Id, quantity: Quantity};
});
if (Apply && !BackupDir) { console.error('--apply needs --backup-dir'); process.exit(2); }
const Db = GetDb();
const Raw = Db.$client;
const Character = Db.transaction((tx) => GetActiveCharacter(tx, UserId), {behavior: 'deferred'});
if (!Character) { console.error('no character for that account'); process.exit(1); }
const Row = () => Raw.prepare('SELECT * FROM inventories WHERE characterId = ?').get(Character.characterId);
const Held = (Id) => { const R = Row(); const S = R && JSON.parse(R.stackedItems ?? '[]').find((X) => X.catalogId === Id); return S ? S.quantity : 0; };
const Before = Grants.map((G) => Held(G.catalogId));
console.log(JSON.stringify({mode: Apply ? 'apply' : 'preview', userId: UserId, characterId: Character.characterId, name: Character.name, grants: Grants, held: Before}));
if (!Apply) process.exit(0);
fs.mkdirSync(BackupDir, {recursive: true});
const Stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(BackupDir, `inventory-${Character.characterId}-${Stamp}.json`), JSON.stringify(Row() ?? null));
const Day = new Date().toISOString().slice(0, 10);
Db.transaction((tx) => {
  for (const G of Grants) {
    ApplyInventoryTransactionInTx(tx, {UserId, CharacterId: Character.characterId, TransactionId: `admin-grant:${G.catalogId}:${Day}:${UserId}${Args.includes('--again') ? ':' + Date.now() : ''}`, StackedItemsToAdd: [G]}, {Caller: 'admin', Source: 'admin:grant-cells'});
  }
}, {behavior: 'immediate'});
const After = Grants.map((G) => Held(G.catalogId));
console.log(JSON.stringify({mode: 'applied', held: After}));
if (After.some((N, I) => N !== Before[I] + Grants[I].quantity)) { console.error('WARNING: quantity did not rise by exactly the granted amount (a repeat of the same grant today does nothing)'); process.exit(1); }
