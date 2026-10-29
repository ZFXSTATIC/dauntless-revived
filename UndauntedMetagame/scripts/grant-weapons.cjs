// Gives one account every weapon in scripts/grant-weapons.ids.json and raises each to level 10, never lowering one.
// Run only on the box that holds the database, from the metagame folder, with the metagame env loaded:
//   node --env-file=<metagame.env> scripts/grant-weapons.cjs <userId> [--level 10]                       (preview, writes nothing)
//   node --env-file=<metagame.env> scripts/grant-weapons.cjs <userId> [--level 10] --apply --backup-dir <dir>
// A weapon is an instanced item whose itemData holds {"CurrentLevel": n}; no itemData means level 1 and updateVersion 0.
// - not held: added at the target level (instanceId = catalogId, like the client's own weapons), updateVersion 1
// - held below the target: CurrentLevel raised to the target, the rest of itemData kept, updateVersion + 1
// - held at or above the target: left alone (a weapon above the target is never lowered)
// - itemData that does not parse: left alone and reported
// Apply: saves the account's inventory row to <backup-dir> first, writes in one immediate transaction through the inventory
// core under a transaction id fixed by account, level and plan (a repeat is answered from the ledger), then reads every
// weapon back and checks that nothing else in the row changed. Reads and writes only that account's character and its one
// inventories row.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const Args = process.argv.slice(2);
const Value = (Flag) => { const I = Args.indexOf(Flag); return I >= 0 ? Args[I + 1] : undefined; };
const Apply = Args.includes('--apply');
const BackupDir = Value('--backup-dir');
const Level = Value('--level') === undefined ? 10 : Number(Value('--level'));
const [UserId, ...Extra] = Args.filter((A, I) => !A.startsWith('--') && !['--backup-dir', '--level'].includes(Args[I - 1]));
if (!UserId || !/^UID-[0-9a-f-]{36}$/.test(UserId) || Extra.length > 0 || !Number.isInteger(Level) || Level < 1 || Level > 15) { console.error('usage: grant-weapons.cjs <UID-...> [--level 1-15] [--apply --backup-dir <dir>]'); process.exit(2); }
if (Apply && !BackupDir) { console.error('--apply needs --backup-dir'); process.exit(2); }
const DbFile = process.env.DB_FILENAME;
if (!DbFile || !fs.existsSync(DbFile) || !fs.statSync(DbFile).isFile()) { console.error('refusing: DB_FILENAME is not set to the existing metagame database (run with --env-file from the metagame folder)'); process.exit(2); }

const Weapons = require('./grant-weapons.ids.json').weapons;
const {GetDb} = require('../dist/db');
const {ApplyInventoryTransactionInTx} = require('../dist/controllers/inventory');
const {GetActiveCharacter} = require('../dist/controllers/activecharacter');
const Db = GetDb();
if (path.resolve(Db.$client.name) !== path.resolve(DbFile)) { console.error('refusing: the opened database is not DB_FILENAME'); process.exit(2); }
const Raw = Db.$client;
const Character = Db.transaction((tx) => GetActiveCharacter(tx, UserId), {behavior: 'deferred'});
if (!Character) { console.error('no character for that account'); process.exit(1); }
const Row = () => Raw.prepare('SELECT * FROM inventories WHERE characterId = ?').get(Character.characterId);

const LevelOf = (Item) => {
  if (Item.itemData === undefined || Item.itemData === null || Item.itemData === '') return {level: 1, data: undefined};
  try {
    const Data = JSON.parse(Item.itemData);
    if (!Data || typeof Data !== 'object' || Array.isArray(Data)) return {level: undefined};
    if (Data.CurrentLevel === undefined) return {level: 1, data: Data};
    if (!Number.isInteger(Data.CurrentLevel) || Data.CurrentLevel < 1) return {level: undefined};
    return {level: Data.CurrentLevel, data: Data};
  } catch { return {level: undefined}; }
};
const NewData = (Data) => JSON.stringify({TransmogCatalogID: 'None', UnlockedAsTransmog: false, DataVersion: 1, EquippedCells: [], EquippedWeaponParts: [], CurrentXP: 0, ...(Data ?? {}), CurrentLevel: Level});

const Before = Row();
const Held = JSON.parse(Before?.instancedItems ?? '[]');
const Plan = [];
const Stat = {added: 0, raised: 0, at_target: 0, above_target: 0, unreadable: 0};
const Left = [];
for (const Id of Weapons) {
  const Mine = Held.filter((I) => I.catalogId === Id);
  if (Mine.length === 0) {
    Plan.push({op: 'add', catalogId: Id, from: null, to: Level, save: {catalogId: Id, instanceId: Id, updateVersion: 1, itemData: NewData()}});
    Stat.added++;
    continue;
  }
  for (const Item of Mine) {
    const {level, data} = LevelOf(Item);
    if (level === undefined) { Stat.unreadable++; Left.push(`${Id} (itemData not readable)`); continue; }
    if (level > Level) { Stat.above_target++; continue; }
    if (level === Level) { Stat.at_target++; continue; }
    const Version = typeof Item.updateVersion === 'number' ? Item.updateVersion + 1 : 1;
    Plan.push({op: 'raise', catalogId: Id, from: level, to: Level, save: {catalogId: Id, instanceId: Item.instanceId, updateVersion: Version, itemData: NewData(data)}});
    Stat.raised++;
  }
}
// Safety: only listed weapons, never a lower level, one entry per instance
if (Plan.some((P) => !Weapons.includes(P.catalogId) || (P.from !== null && P.from >= P.to))) { console.error('internal check failed: plan touches a non-listed weapon or lowers a level'); process.exit(1); }
if (new Set(Plan.map((P) => P.save.instanceId)).size !== Plan.length) { console.error('internal check failed: duplicate instance in plan'); process.exit(1); }

console.log(JSON.stringify({mode: Apply ? 'apply' : 'preview', userId: UserId, characterId: Character.characterId, name: Character.name, level: Level, listed: Weapons.length, instancedRows: Held.length, ...Stat, writes: Plan.length}));
const Hist = {};
for (const P of Plan) { const K = `${P.op} ${P.from ?? '-'}->${P.to}`; Hist[K] = (Hist[K] ?? 0) + 1; }
console.log(JSON.stringify(Hist));
if (!Apply) { for (const P of Plan) console.log(`${P.op.padEnd(5)} ${P.catalogId} ${P.from ?? '-'} -> ${P.to}`); }
if (Left.length) console.log('left alone, unreadable:', Left.join(', '));
if (!Apply) process.exit(0);
if (Plan.length === 0) { console.log('nothing to do: every listed weapon is already held at or above the target level'); process.exit(0); }

fs.mkdirSync(BackupDir, {recursive: true});
const Stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BackupFile = path.join(BackupDir, `inventory-${Character.characterId}-${Stamp}.json`);
fs.writeFileSync(BackupFile, JSON.stringify(Before ?? null));
console.log(`backup: ${BackupFile}`);
const Hash = (S) => createHash('sha256').update(S).digest('hex');
const TransactionId = `admin-grant-weapons:${UserId}:${Level}:${Hash(JSON.stringify(Plan.map((P) => P.save))).slice(0, 16)}`;
Db.transaction((tx) => {
  ApplyInventoryTransactionInTx(tx, {UserId, CharacterId: Character.characterId, TransactionId, InstancedItemsToSave: Plan.map((P) => P.save)}, {Caller: 'admin', Source: 'admin:grant-weapons'});
}, {behavior: 'immediate'});

// Read back
const After = Row();
const AfterItems = JSON.parse(After.instancedItems);
const Touched = new Set(Plan.map((P) => P.save.instanceId));
const Bad = [];
for (const P of Plan) {
  const Item = AfterItems.find((I) => I.instanceId === P.save.instanceId && I.catalogId === P.catalogId);
  const L = Item ? LevelOf(Item).level : undefined;
  if (L !== Level) Bad.push(`${P.catalogId}: ${L}`);
}
const Others = (Items) => JSON.stringify(Items.filter((I) => !Touched.has(I.instanceId)));
const OthersSame = Others(AfterItems) === Others(Held);
const StackedSame = After.stackedItems === (Before?.stackedItems ?? '[]');
const Lowered = Held.filter((I) => Weapons.includes(I.catalogId)).filter((I) => { const A = AfterItems.find((X) => X.instanceId === I.instanceId); const Lb = LevelOf(I).level; const La = A ? LevelOf(A).level : undefined; return Lb !== undefined && (La === undefined || La < Lb); }).map((I) => I.catalogId);
console.log(JSON.stringify({mode: 'applied', transactionId: TransactionId, instancedRowsBefore: Held.length, instancedRowsAfter: AfterItems.length, notAtTarget: Bad, otherItemsUnchanged: OthersSame, stackedUnchanged: StackedSame, lowered: Lowered}));
if (Bad.length > 0 || !OthersSame || !StackedSame || Lowered.length > 0) { console.error(`WARNING: read-back check failed; restore from ${BackupFile} if needed`); process.exit(1); }
