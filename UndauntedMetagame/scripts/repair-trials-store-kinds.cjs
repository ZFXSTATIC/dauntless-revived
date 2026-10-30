// Delivers Trials (Lady Luck) store purchases that were paid for but granted in the wrong form before
// 3cb1f7e (crowns and dyes written to instancedItems, the cooldown lantern to stackedItems). The client
// never shows those copies. This grants each one again in the form freestore.GrantKind gives today.
//
// Input: a JSON list of {accountId, characterId, catalogId, storeTransactionId} (affected.json from the
// read-only analysis). Every entry is re-checked against the database before anything is granted:
//   - the store transaction must exist for that character, have SPENT currency and ADDED that item in the
//     wrong form (so nothing is ever granted that was not paid for);
//   - the character must not already hold the item in the correct form (one unlock per item, never more);
//   - the character must be idle: no inventory activity for --idle-minutes (default 30).
// Apply: backs up the inventories row to --backup-dir, then grants in one immediate transaction that first
// re-reads the row and aborts if it changed since the backup (revision guard). The transaction id is fixed
// per store purchase, so a second run grants nothing. Every grant, skip and refusal is appended as one JSON
// line to --log (keep it in the repo under scripts/repair-logs/).
//
// Dry run (default, opens the database read-only, writes nothing but the log):
//   DB_FILENAME=<db> node scripts/repair-trials-store-kinds.cjs <affected.json> --log <file>
// Apply (on MAIN, with the metagame env loaded, only on the owner's go):
//   node --env-file=.env scripts/repair-trials-store-kinds.cjs <affected.json> --apply --backup-dir <dir> --log <file>
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const Args = process.argv.slice(2);
const Opt = (Name) => { const I = Args.indexOf(Name); return I >= 0 ? Args[I + 1] : undefined; };
const Apply = Args.includes('--apply');
const ListFile = Args.find((A, I) => !A.startsWith('--') && !['--backup-dir', '--log', '--idle-minutes'].includes(Args[I - 1]));
const BackupDir = Opt('--backup-dir');
const LogFile = Opt('--log');
const IdleMinutes = Number(Opt('--idle-minutes') ?? 30);
const Now = Opt('--now') ? new Date(Opt('--now')) : new Date();
if (!ListFile || !LogFile || (Apply && !BackupDir) || !process.env.DB_FILENAME) {
  console.error('usage: DB_FILENAME=<db> repair-trials-store-kinds.cjs <affected.json> --log <file> [--apply --backup-dir <dir>] [--idle-minutes N] [--now ISO]');
  process.exit(2);
}

// The kinds the store grants today (same source as freestore.GrantKind for Lady Luck items)
const Kinds = require('../src/vendor/store_ladyluck.json').itemKinds;
const Entries = JSON.parse(fs.readFileSync(ListFile, 'utf8'));
fs.mkdirSync(path.dirname(LogFile), {recursive: true});
const Log = (Record) => { const Line = JSON.stringify({at: new Date().toISOString(), mode: Apply ? 'apply' : 'dry-run', ...Record}); fs.appendFileSync(LogFile, Line + '\n'); console.log(Line); };

const Raw = Apply ? require('../dist/db').GetDb().$client : new (require('better-sqlite3'))(process.env.DB_FILENAME, {readonly: true, fileMustExist: true});
const ReadRow = (CharacterId) => Raw.prepare('SELECT * FROM inventories WHERE characterId = ?').get(CharacterId);
const Parse = (Text) => { try { const V = JSON.parse(Text ?? '[]'); return Array.isArray(V) ? V : []; } catch { return []; } };
const HeldCorrect = (Row, CatalogId, Kind) => Kind === 'stacked'
  ? Parse(Row?.stackedItems).some((S) => S?.catalogId === CatalogId && Number(S.quantity) > 0)
  : Parse(Row?.instancedItems).some((I) => I?.catalogId === CatalogId);

const Seen = new Set();
const Summary = {grant: 0, skip: 0, refuse: 0};
for (const E of Entries) {
  const Base = {accountId: E.accountId, characterId: E.characterId, catalogId: E.catalogId, storeTransactionId: E.storeTransactionId};
  const Refuse = (Reason) => { Summary.refuse++; Log({...Base, result: 'refused', reason: Reason}); };
  const Kind = Kinds[E.catalogId];
  if (Kind !== 'stacked' && Kind !== 'instanced') { Refuse('item is not a Lady Luck item with a known grant kind'); continue; }
  if (typeof E.storeTransactionId !== 'string' || !/^store:[0-9a-f]{64}$/.test(E.storeTransactionId)) { Refuse('bad store transaction id'); continue; }

  const Char = Raw.prepare('SELECT userId FROM characters WHERE characterId = ?').get(E.characterId);
  if (!Char || Char.userId !== E.accountId) { Refuse('character is not this account'); continue; }

  // Paid and wrongly delivered, from this purchase's own ledger lines (characterId index)
  const Lines = Raw.prepare('SELECT catalogId, instanceId, quantityChange FROM inventorylog WHERE characterId = ? AND transactionId = ?').all(E.characterId, E.storeTransactionId);
  const Spent = Lines.some((L) => /^CURRENCY_MARKS_/.test(L.catalogId ?? '') && L.quantityChange < 0);
  const Added = Lines.find((L) => L.catalogId === E.catalogId && L.quantityChange > 0);
  if (!Spent) { Refuse('no currency spend on this purchase'); continue; }
  if (!Added) { Refuse('purchase did not add this item'); continue; }
  if ((Added.instanceId ? 'instanced' : 'stacked') === Kind) { Refuse('purchase was delivered in the correct form'); continue; }

  // One unlock per character and item, however many times it was paid for
  const Key = `${E.characterId}:${E.catalogId}`;
  const Row = ReadRow(E.characterId);
  if (Seen.has(Key) || HeldCorrect(Row, E.catalogId, Kind)) { Summary.skip++; Log({...Base, result: 'skipped', reason: 'already held in the correct form'}); continue; }
  Seen.add(Key);

  const Last = Raw.prepare('SELECT time FROM inventorylog WHERE characterId = ? ORDER BY id DESC LIMIT 1').get(E.characterId)?.time;
  if (Last && Now.getTime() - Date.parse(Last) < IdleMinutes * 60000) { Refuse(`not idle: inventory activity at ${Last}`); Seen.delete(Key); continue; }

  const TransactionId = `repair:trials-kind:${E.storeTransactionId.slice(6)}`;
  const Item = Kind === 'stacked'
    ? {catalogId: E.catalogId, quantity: 1}
    : {catalogId: E.catalogId, instanceId: createHash('sha256').update(`${TransactionId}:${E.catalogId}`).digest('hex').slice(0, 32), updateVersion: 0};

  if (!Apply) { Summary.grant++; Log({...Base, result: 'would-grant', kind: Kind, item: Item, transactionId: TransactionId, lastActivity: Last ?? null}); continue; }

  fs.mkdirSync(BackupDir, {recursive: true});
  const Backup = path.join(BackupDir, `inventory-${E.characterId}-${Date.now()}.json`);
  fs.writeFileSync(Backup, JSON.stringify(Row ?? null));
  const {GetDb} = require('../dist/db');
  const {ApplyInventoryTransactionInTx} = require('../dist/controllers/inventory');
  try {
    GetDb().transaction((tx) => {
      const Current = ReadRow(E.characterId);
      if (JSON.stringify(Current ?? null) !== JSON.stringify(Row ?? null)) throw new Error('revision guard: inventory row changed since backup');
      ApplyInventoryTransactionInTx(tx, {
        UserId: E.accountId, CharacterId: E.characterId, TransactionId,
        StackedItemsToAdd: Kind === 'stacked' ? [Item] : [], InstancedItemsToAdd: Kind === 'instanced' ? [Item] : []
      }, {Caller: 'admin', Source: 'repair:trials-store-kind-20261030'});
    }, {behavior: 'immediate'});
  } catch (error) { Refuse(`grant failed: ${error.message}`); continue; }
  const Ok = HeldCorrect(ReadRow(E.characterId), E.catalogId, Kind);
  if (Ok) Summary.grant++; else Summary.refuse++;
  Log({...Base, result: Ok ? 'granted' : 'verify-failed', kind: Kind, item: Item, transactionId: TransactionId, backup: Backup});
}
console.log(JSON.stringify({summary: Summary, entries: Entries.length}));
