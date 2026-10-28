// Gives one account every cosmetic in scripts/grant-cosmetics.ids.json (built by make-cosmetic-list.cjs: ids that are in
// our store/reward data or already held by 2+ real accounts) through the inventory core, skipping what it already holds.
// Run only on the box that holds the database, from the metagame folder, with the metagame env loaded:
//   node --env-file=.env scripts/grant-cosmetics.cjs <userId> [--only titles,AC_,...] [--list]       (preview, writes nothing)
//   node --env-file=.env scripts/grant-cosmetics.cjs <userId> [--only ...] --apply --backup-dir <dir>
// --only takes category names (armour, weapon_skins, lantern_skins, emotes, emoji, banners, flares, dyes, titles,
// accessories, appearance, special) and/or id prefixes. --list prints the ids to grant as JSON on stdout (summary on stderr).
// Apply: saves the account's inventory row to <backup-dir>, grants in one immediate transaction under a transaction id fixed
// by the account and the id list (a repeat with the same list is answered from the ledger), then reads every id back.
// Instanced items get the freestore shape {catalogId, instanceId, updateVersion: 0}, instanceId derived from account + id.
// Reads only the account's character and its one inventories row.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const Args = process.argv.slice(2);
const Value = (Flag) => { const I = Args.indexOf(Flag); return I >= 0 ? Args[I + 1] : undefined; };
const Apply = Args.includes('--apply');
const List = Args.includes('--list');
const BackupDir = Value('--backup-dir');
const Only = Value('--only')?.split(',').map((S) => S.trim()).filter(Boolean);
const [UserId, ...Extra] = Args.filter((A, I) => !A.startsWith('--') && !['--backup-dir', '--only'].includes(Args[I - 1]));
const Log = List ? console.error : console.log;
if (!UserId || !/^UID-[0-9a-f-]{36}$/.test(UserId) || Extra.length > 0) { console.error('usage: grant-cosmetics.cjs <UID-...> [--only <category|prefix,...>] [--list] [--apply --backup-dir <dir>]'); process.exit(2); }
if (Apply && !BackupDir) { console.error('--apply needs --backup-dir'); process.exit(2); }
if (Only && Only.length === 0) { console.error('--only needs a list'); process.exit(2); }
// The metagame's own database only: DB_FILENAME from its .env, and the file must already exist (never create an empty one)
const DbFile = process.env.DB_FILENAME;
if (!DbFile || !fs.existsSync(DbFile) || !fs.statSync(DbFile).isFile()) { console.error('refusing: DB_FILENAME is not set to the existing metagame database (run with --env-file=.env from the metagame folder)'); process.exit(2); }

const Ids = require('./grant-cosmetics.ids.json');
const Picked = (Id, Category) => !Only || Only.some((O) => O === Category || Id.startsWith(O));
const {GetDb} = require('../dist/db');
const {ApplyInventoryTransactionInTx} = require('../dist/controllers/inventory');
const {GetActiveCharacter} = require('../dist/controllers/activecharacter');
const Db = GetDb();
if (path.resolve(Db.$client.name) !== path.resolve(DbFile)) { console.error('refusing: the opened database is not DB_FILENAME'); process.exit(2); }
const Raw = Db.$client;
const Character = Db.transaction((tx) => GetActiveCharacter(tx, UserId), {behavior: 'deferred'});
if (!Character) { console.error('no character for that account'); process.exit(1); }
const Row = () => Raw.prepare('SELECT * FROM inventories WHERE characterId = ?').get(Character.characterId);
const HeldSet = (R) => {
  const Held = new Set();
  for (const S of JSON.parse(R?.stackedItems ?? '[]')) if (typeof S?.catalogId === 'string' && Number(S.quantity) >= 1) Held.add(S.catalogId);
  for (const I of JSON.parse(R?.instancedItems ?? '[]')) if (typeof I?.catalogId === 'string') Held.add(I.catalogId);
  return Held;
};
const Before = HeldSet(Row());
const Summary = {};
const Bump = (C, K) => { (Summary[C] ??= {to_grant: 0, already_held: 0, excluded: 0, unconfirmed: 0})[K]++; };
const ToGrant = [];
for (const [Id, [Category, Kind]] of Object.entries(Ids.grant)) {
  if (!Picked(Id, Category)) continue;
  if (Before.has(Id)) { Bump(Category, 'already_held'); continue; }
  Bump(Category, 'to_grant');
  ToGrant.push({catalogId: Id, kind: Kind, category: Category});
}
for (const [Id, [Category]] of Object.entries(Ids.excluded)) if (Picked(Id, Category)) Bump(Category, 'excluded');
for (const [Id, [Category]] of Object.entries(Ids.unconfirmed)) if (Picked(Id, Category)) Bump(Category, 'unconfirmed');
Log(JSON.stringify({mode: Apply ? 'apply' : 'preview', userId: UserId, characterId: Character.characterId, name: Character.name, only: Only ?? 'all', toGrant: ToGrant.length}));
for (const [Category, C] of Object.entries(Summary)) Log(`${Category.padEnd(15)} to grant ${String(C.to_grant).padStart(4)}  already held ${String(C.already_held).padStart(4)}  excluded ${String(C.excluded).padStart(4)}  unconfirmed ${String(C.unconfirmed).padStart(4)}`);
if (List) console.log(JSON.stringify(ToGrant.map((G) => G.catalogId)));
if (!Apply) process.exit(0);
if (ToGrant.length === 0) { Log('nothing to grant: the account already holds every selected cosmetic'); process.exit(0); }

fs.mkdirSync(BackupDir, {recursive: true});
const Stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BackupFile = path.join(BackupDir, `inventory-${Character.characterId}-${Stamp}.json`);
fs.writeFileSync(BackupFile, JSON.stringify(Row() ?? null));
Log(`backup: ${BackupFile}`);
const Hash = (S) => createHash('sha256').update(S).digest('hex');
const Stacked = ToGrant.filter((G) => G.kind === 'stacked').map((G) => ({catalogId: G.catalogId, quantity: 1}));
const Instanced = ToGrant.filter((G) => G.kind === 'instanced').map((G) => ({catalogId: G.catalogId, instanceId: Hash(`admin-grant-cosmetics:${UserId}:${G.catalogId}`).slice(0, 32), updateVersion: 0}));
// The core has no per-request item limit and the whole grant is one SQLite write, so it goes as one transaction.
const TransactionId = `admin-grant-cosmetics:${UserId}:${Hash(JSON.stringify(ToGrant.map((G) => G.catalogId))).slice(0, 16)}`;
Db.transaction((tx) => {
  ApplyInventoryTransactionInTx(tx, {UserId, CharacterId: Character.characterId, TransactionId, StackedItemsToAdd: Stacked, InstancedItemsToAdd: Instanced}, {Caller: 'admin', Source: 'admin:grant-cosmetics'});
}, {behavior: 'immediate'});
const After = Row();
const HeldAfter = HeldSet(After);
const Missing = ToGrant.filter((G) => !HeldAfter.has(G.catalogId)).map((G) => G.catalogId);
Log(JSON.stringify({mode: 'applied', transactionId: TransactionId, stacked: Stacked.length, instanced: Instanced.length,
  stackedRows: JSON.parse(After.stackedItems).length, instancedRows: JSON.parse(After.instancedItems).length, missing: Missing}));
if (Missing.length > 0) { console.error(`WARNING: ${Missing.length} id(s) not held after the grant; restore from ${BackupFile} if needed`); process.exit(1); }
