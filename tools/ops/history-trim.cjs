#!/usr/bin/env node
// Trims old rows from the metagame's history tables so the database (and every backup of it) gets smaller.
// Runbook: docs/operations/history-trim.md
//
//   node tools/ops/history-trim.cjs --db <path>                          dry run (default): what would go, nothing written
//   node tools/ops/history-trim.cjs --db <path> --execute --archive-dir <dir>
//                                                                        archive the rows to gzip NDJSON, verify, then delete
//   node tools/ops/history-trim.cjs --db <path> --restore --archive-dir <dir>
//                                                                        put archived rows back (INSERT OR IGNORE, safe to repeat)
//   node tools/ops/history-trim.cjs --verify-archive --archive-dir <dir> check every archive file against its manifest
//
// Options
//   --tables a,b          tables to work on (default: characterhistory,loadouthistory)
//   --keep-days N         keep everything newer than N days (default 30; the minimum per table is enforced)
//   --keep-per-key N      history tables: always keep the newest N versions of each character (default 100,
//                         the same as SAVE_HISTORY_KEEP); progression_events: the newest N rows of each account (1)
//   --hourly-hours N      history tables: also keep the last version of each hour for N hours (default 48,
//                         SAVE_HISTORY_HOURLY)
//   --daily-days N        history tables: also keep the last version of each day for N days (default 30,
//                         SAVE_HISTORY_DAILY)
//   --include-audit       allow progression_events and inventorylog (append-only audit logs; see the runbook)
//   --batch N             rows per delete transaction (default 2000)
//   --scan N              ids read per archive window (default 20000)
//   --pause-ms N          pause between delete batches (default 200)
//   --max-wal-mb N        stop when the -wal file grows past this (default 512)
//   --max-rows N          stop after deleting this many rows in total (for a careful first run)
//   --exact-bytes         dry run: sum the real row sizes instead of estimating from a sample (reads the rows)
//   --check               run PRAGMA quick_check before --execute (reads the whole file; for copies)
//   --i-am-on-main        required to touch a database under C:\DauntlessRevived
//
// Rollback: --restore with the same --archive-dir puts every archived row back with its original id.
// This script never runs VACUUM: the file only shrinks when a compacted copy is made (see the runbook).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

function LoadSqlite(){
    const Tries = [process.env.HISTORY_TRIM_BSQL, 'better-sqlite3', path.join(__dirname, '../../UndauntedMetagame/node_modules/better-sqlite3')];
    for(const Try of Tries){
        if(!Try) continue;
        try { return require(Try); } catch {}
    }
    throw new Error('better-sqlite3 not found: run npm ci in UndauntedMetagame or set HISTORY_TRIM_BSQL');
}

// What each table may lose. key: the column whose newest rows are always kept. date: ISO text column
// (ids grow with it). minDays: the smallest keep window the code that reads the table allows.
const TABLES = {
    // Rollback (admin /RollbackCharacter) and the save history list read any kept version. The app
    // itself keeps the newest SAVE_HISTORY_KEEP + one per hour for 48 h + one per day for 30 days,
    // pruned on each save; rows older than 30 days beyond the newest 100 are what it would prune anyway.
    // GetActiveCharacter uses max(id) per character, so the newest rows of a character must stay.
    // So this applies the app's own prune rule (savehistory.ts PruneBeyondRetention), with the numbers
    // given here, to every character at once, including characters that never save again.
    characterhistory: {date: 'savedDate', key: 'characterId', minDays: 3, keepPerKey: 100, history: true},
    loadouthistory: {date: 'savedDate', key: 'characterId', minDays: 3, keepPerKey: 100, history: true},
    // The app deletes receipts older than 30 days on every inventory transaction; younger ones are the
    // retry (idempotency) guard and must never go.
    inventorytransactions: {date: 'createdDate', key: null, minDays: 30, keepPerKey: 0},
    // Append-only audit logs (triggers refuse DELETE). Only with --include-audit.
    progression_events: {date: 'time', key: 'accountId', minDays: 90, keepPerKey: 1, audit: true, trigger: 'progression_events_no_delete'},
    // Store revocation looks up store grants and revoke markers by transactionId with no time limit: never trimmed.
    inventorylog: {date: 'time', key: null, minDays: 90, keepPerKey: 0, audit: true, trigger: 'inventorylog_no_delete',
        extra: "NOT (caller IN ('store','admin') OR operation = 'store_revoke' OR transactionId LIKE 'store%')"}
};
const DEFAULT_TABLES = ['characterhistory', 'loadouthistory'];

function ParseArgs(Argv){
    const A = {tables: DEFAULT_TABLES.join(','), 'keep-days': '30', batch: '2000', scan: '20000', 'pause-ms': '200', 'max-wal-mb': '512'};
    for(let i = 0; i < Argv.length; i++){
        const M = /^--([a-z-]+)(?:=(.*))?$/.exec(Argv[i]);
        if(!M) throw new Error(`Unknown argument ${Argv[i]}`);
        const Flag = ['execute', 'restore', 'verify-archive', 'include-audit', 'exact-bytes', 'i-am-on-main', 'check', 'help'].includes(M[1]);
        A[M[1]] = Flag ? true : (M[2] ?? Argv[++i]);
        if(M[1] === 'tables') A.tablesGiven = true;
    }
    return A;
}

const Sleep = (Ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Ms);
const Log = (...X) => console.log(new Date().toISOString(), ...X);
const Mb = (B) => `${(B / 1048576).toFixed(1)} MB`;
const Sha = (Buf) => crypto.createHash('sha256').update(Buf).digest('hex');

function CheckDbPath(Db, A){
    const Full = path.resolve(Db);
    if(/^[a-z]:[\\/]dauntlessrevived([\\/]|$)/i.test(Full) && !A['i-am-on-main']){
        throw new Error(`${Full} is under C:\\DauntlessRevived (the live server). Refusing without --i-am-on-main.`);
    }
    if(!fs.existsSync(Full)) throw new Error(`No database at ${Full}`);
    return Full;
}

function Open(Sqlite, File, ReadOnly){
    const Db = new Sqlite(File, {readonly: ReadOnly, fileMustExist: true});
    Db.pragma('busy_timeout = 2000');
    return Db;
}

// First id whose date is >= Iso (ids grow with the date column); binary search over the rowid
function CutoffId(Db, T, Cfg, Iso){
    const MM = Db.prepare(`SELECT min(id) a, max(id) b FROM ${T}`).get();
    if(MM.a == null) return 0;
    const At = Db.prepare(`SELECT id, ${Cfg.date} d FROM ${T} WHERE id >= ? ORDER BY id LIMIT 1`);
    let Lo = MM.a, Hi = MM.b + 1;
    while(Lo < Hi){
        const Mid = Math.floor((Lo + Hi) / 2);
        const R = At.get(Mid);
        if(!R || R.d >= Iso) Hi = Mid; else Lo = R.id + 1;
    }
    return Lo;
}

// Per key: the lowest id among its newest N rows. Rows of that key below it may go.
// Taken once at the start: later writes only add newer rows, so this stays on the safe side.
function KeepThresholds(Db, T, Cfg, N){
    if(!Cfg.key || N <= 0) return null;
    const Map_ = new Map();
    const Keys = Db.prepare(`SELECT DISTINCT ${Cfg.key} k FROM ${T}`).pluck().all();
    const Nth = Db.prepare(`SELECT id FROM ${T} WHERE ${Cfg.key} = ? ORDER BY id DESC LIMIT 1 OFFSET ?`).pluck();
    for(const K of Keys){
        const Id = Nth.get(K, N - 1);
        Map_.set(K, Id ?? -1); // fewer than N rows: keep all of them
    }
    return Map_;
}

function Plan(Db, A, T){
    const Cfg = TABLES[T];
    if(!Cfg) throw new Error(`Unknown table ${T}. Known: ${Object.keys(TABLES).join(', ')}`);
    if(Cfg.audit && !A['include-audit']) throw new Error(`${T} is an append-only audit log; pass --include-audit to trim it (read the runbook first)`);
    if(T === 'inventorylog') throw new Error('inventorylog is never trimmed: store revocation needs its old rows (controllers/storerevocation.ts)');
    const Days = Number(A['keep-days']);
    if(!(Days >= Cfg.minDays)) throw new Error(`${T}: --keep-days must be at least ${Cfg.minDays}`);
    const KeepPerKey = A['keep-per-key'] != null ? Number(A['keep-per-key']) : Cfg.keepPerKey;
    if(Cfg.key && !(Number.isInteger(KeepPerKey) && KeepPerKey >= 1)) throw new Error(`${T}: --keep-per-key must be at least 1`);
    const Iso = new Date(Date.now() - Days * 864e5).toISOString();
    const CutId = CutoffId(Db, T, Cfg, Iso);
    if(Cfg.history && KeepPerKey < 10) throw new Error(`${T}: --keep-per-key must be at least 10`);
    const Hourly = Number(A['hourly-hours'] ?? 48), Daily = Number(A['daily-days'] ?? 30);
    if(!(Hourly >= 0 && Daily >= 0)) throw new Error('--hourly-hours and --daily-days must be >= 0');
    const HourlySince = new Date(Date.now() - Hourly * 36e5).toISOString();
    const DailySince = new Date(Date.now() - Daily * 864e5).toISOString();
    const Thr = KeepThresholds(Db, T, Cfg, KeepPerKey);
    const MinId = Db.prepare(`SELECT min(id) FROM ${T}`).pluck().get() ?? 0;
    return {T, Cfg, Iso, CutId, Thr, MinId, KeepPerKey, Hourly, Daily, HourlySince, DailySince};
}

function Describe(P){
    let D = `${P.Cfg.date} < ${P.Iso}`;
    if(P.Thr) D += `, beyond the newest ${P.KeepPerKey} per ${P.Cfg.key}`;
    if(P.Cfg.history) D += `, not the last of an hour in the last ${P.Hourly} h or of a day in the last ${P.Daily} days`;
    return D;
}

function Keep(P, Row){
    if(!P.Thr) return false;
    const Thr = P.Thr.get(Row[P.Cfg.key]);
    return Thr === undefined || Thr === -1 || Row.id >= Thr; // unknown key (new since the plan): keep
}

// Yields the rows to remove in chunks of about Scan rows. History tables go character by character with
// the app's own prune query (newest N, last of each hour / day inside the windows are kept); the others
// walk the rowid in windows.
function* Candidates(Db, P, Columns, Scan){
    if(P.Cfg.history){
        const T = P.T;
        const Q = Db.prepare(`SELECT ${Columns} FROM ${T} WHERE characterId = @k AND id < @thr AND savedDate < @cut
            AND id NOT IN (SELECT max(id) FROM ${T} WHERE characterId = @k AND savedDate >= @hs GROUP BY substr(savedDate, 1, 13))
            AND id NOT IN (SELECT max(id) FROM ${T} WHERE characterId = @k AND savedDate >= @ds GROUP BY substr(savedDate, 1, 10))
            ORDER BY id`);
        let Buf = [];
        for(const [K, Thr] of P.Thr){
            if(Thr === -1) continue;
            Buf.push(...Q.all({k: K, thr: Thr, cut: P.Iso, hs: P.HourlySince, ds: P.DailySince}));
            if(Buf.length >= Scan){ yield Buf; Buf = []; }
        }
        if(Buf.length) yield Buf;
        return;
    }
    const Extra = P.Cfg.extra ? ` AND ${P.Cfg.extra}` : '';
    const Q = Db.prepare(`SELECT ${Columns} FROM ${P.T} WHERE id >= ? AND id < ? AND ${P.Cfg.date} < ?${Extra} ORDER BY id`);
    for(let Lo = P.MinId; Lo < P.CutId; Lo += Scan){
        const Rows = Q.all(Lo, Math.min(Lo + Scan, P.CutId), P.Iso).filter((Row) => !Keep(P, Row));
        if(Rows.length) yield Rows;
    }
}

function Count(Db, P, A){
    const Cols = Db.prepare(`SELECT name FROM pragma_table_info('${P.T}')`).pluck().all();
    const Len = Cols.map((C) => `coalesce(length(${C}),0)`).join('+');
    // length() of a big text value reads its overflow pages, so without --exact-bytes only every 50th row is sized
    let Rows = 0, Sized = 0, SizedBytes = 0;
    const SizeOf = Db.prepare(`SELECT ${Len} FROM ${P.T} WHERE id = ?`).pluck();
    const KeyCol = P.Cfg.key ? `, ${P.Cfg.key}` : '';
    for(const Chunk of Candidates(Db, P, `id${KeyCol}`, Number(A.scan))){
        for(const R of Chunk){
            if(A['exact-bytes'] || Rows % 50 === 0){ Sized++; SizedBytes += SizeOf.get(R.id); }
            Rows++;
        }
    }
    return {Rows, Bytes: Sized ? Math.round(SizedBytes / Sized * Rows) : 0, Exact: !!A['exact-bytes']};
}

function WalBytes(File){
    try { return fs.statSync(`${File}-wal`).size; } catch { return 0; }
}

function IsBusy(Error_){
    return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(`${Error_?.code} ${Error_?.message}`);
}

// One gzip member per window, appended to <archive>/<table>/<day>.ndjson.gz; the manifest lists each
// member's offset, length, row count, first/last id and sha256 of its uncompressed NDJSON.
function ArchiveWindow(Dir, T, Rows){
    const ByDay = new Map();
    for(const R of Rows){
        const Day = String(R[TABLES[T].date]).slice(0, 10).replace(/[^0-9-]/g, '_') || 'unknown';
        if(!ByDay.has(Day)) ByDay.set(Day, []);
        ByDay.get(Day).push(R);
    }
    const Written = [];
    for(const [Day, DayRows] of ByDay){
        const Text = Buffer.from(DayRows.map((R) => JSON.stringify(R)).join('\n') + '\n');
        const Gz = zlib.gzipSync(Text, {level: 6});
        const File = path.join(Dir, T, `${Day}.ndjson.gz`);
        const ManifestFile = path.join(Dir, T, `${Day}.manifest.json`);
        fs.mkdirSync(path.dirname(File), {recursive: true});
        const Offset = fs.existsSync(File) ? fs.statSync(File).size : 0;
        const Fd = fs.openSync(File, 'a');
        fs.writeSync(Fd, Gz); fs.fsyncSync(Fd); fs.closeSync(Fd);
        const Manifest = fs.existsSync(ManifestFile) ? JSON.parse(fs.readFileSync(ManifestFile, 'utf8')) : {table: T, day: Day, members: []};
        const Member = {offset: Offset, length: Gz.length, rows: DayRows.length, firstId: DayRows[0].id, lastId: DayRows[DayRows.length - 1].id, sha256: Sha(Text)};
        Manifest.members.push(Member);
        fs.writeFileSync(`${ManifestFile}.tmp`, JSON.stringify(Manifest, null, 1));
        fs.renameSync(`${ManifestFile}.tmp`, ManifestFile);
        Written.push({File, Member, Ids: DayRows.map((R) => R.id)});
    }
    return Written;
}

// Re-reads a member from disk and checks it against the manifest entry; returns its rows
function ReadMember(File, Member){
    const Fd = fs.openSync(File, 'r');
    const Buf = Buffer.alloc(Member.length);
    fs.readSync(Fd, Buf, 0, Member.length, Member.offset);
    fs.closeSync(Fd);
    const Text = zlib.gunzipSync(Buf);
    if(Sha(Text) !== Member.sha256) throw new Error(`${File} @${Member.offset}: checksum mismatch`);
    const Rows = Text.toString('utf8').split('\n').filter(Boolean).map((L) => JSON.parse(L));
    if(Rows.length !== Member.rows) throw new Error(`${File} @${Member.offset}: ${Rows.length} rows, manifest says ${Member.rows}`);
    return Rows;
}

function* ArchiveMembers(Dir){
    for(const T of fs.existsSync(Dir) ? fs.readdirSync(Dir).sort() : []){
        const TDir = path.join(Dir, T);
        if(!TABLES[T] || !fs.statSync(TDir).isDirectory()) continue;
        for(const F of fs.readdirSync(TDir).filter((F) => F.endsWith('.manifest.json')).sort()){
            const Manifest = JSON.parse(fs.readFileSync(path.join(TDir, F), 'utf8'));
            const File = path.join(TDir, F.replace('.manifest.json', '.ndjson.gz'));
            for(const Member of Manifest.members) yield {T, File, Member};
        }
    }
}

// Deletes Ids (already archived and verified) in batches. Audit tables: the no-delete trigger is
// dropped and recreated with its exact original SQL inside the same transaction.
function DeleteIds(Db, File, P, Ids, A, State){
    const Batch = Number(A.batch), Pause = Number(A['pause-ms']), MaxWal = Number(A['max-wal-mb']) * 1048576;
    const TriggerSql = P.Cfg.trigger ? Db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).pluck().get(P.Cfg.trigger) : null;
    const Del = Db.prepare(`DELETE FROM ${P.T} WHERE id IN (SELECT value FROM json_each(?)) AND ${P.Cfg.date} < ?`);
    const Run = Db.transaction((Chunk) => {
        if(TriggerSql) Db.exec(`DROP TRIGGER ${P.Cfg.trigger}`);
        const Changes = Del.run(JSON.stringify(Chunk), P.Iso).changes;
        if(TriggerSql) Db.exec(TriggerSql);
        return Changes;
    });
    for(let i = 0; i < Ids.length; i += Batch){
        if(A['max-rows'] && State.Deleted >= Number(A['max-rows'])){ State.Stop = `--max-rows ${A['max-rows']} reached`; return; }
        if(WalBytes(File) > MaxWal){
            Db.pragma('wal_checkpoint(PASSIVE)');
            if(WalBytes(File) > MaxWal){ State.Stop = `WAL is ${Mb(WalBytes(File))}, over --max-wal-mb`; return; }
        }
        try {
            State.Deleted += Run(Ids.slice(i, i + Batch));
        } catch(E){
            if(IsBusy(E)){ State.Stop = `database busy/locked (${E.message})`; return; }
            throw E;
        }
        if(Pause > 0) Sleep(Pause);
    }
}

function Execute(Sqlite, File, A){
    const Dir = A['archive-dir'];
    if(!Dir) throw new Error('--execute needs --archive-dir');
    fs.mkdirSync(Dir, {recursive: true});
    const Db = Open(Sqlite, File, false);
    // quick_check reads the whole file: opt-in (--check), meant for copies, not the live 35 GB database
    if(A.check && !String(Db.pragma('quick_check', {simple: true})).startsWith('ok')) throw new Error('quick_check failed: not touching this database');
    const State = {Deleted: 0, Archived: 0, Stop: null};
    for(const T of A.tables.split(',')){
        const P = Plan(Db, A, T);
        Log(`${T}: removing ${Describe(P)}`);
        for(const Rows of Candidates(Db, P, '*', Number(A.scan))){
            if(State.Stop) break;
            const Written = ArchiveWindow(Dir, T, Rows);
            // Verify every member just written before deleting anything of this window
            let Verified = 0;
            for(const W of Written){
                const Back = ReadMember(W.File, W.Member);
                if(Back.some((R, j) => R.id !== W.Ids[j])) throw new Error(`${W.File}: ids differ after re-read`);
                Verified += Back.length;
            }
            if(Verified !== Rows.length) throw new Error(`${T}: archived ${Verified} rows, selected ${Rows.length}`);
            State.Archived += Verified;
            DeleteIds(Db, File, P, Rows.map((R) => R.id), A, State);
            Log(`${T}: ids ${Rows[0].id}..${Rows[Rows.length - 1].id}: archived ${Verified}, deleted so far ${State.Deleted}, WAL ${Mb(WalBytes(File))}`);
        }
        if(State.Stop) break;
    }
    Db.pragma('wal_checkpoint(PASSIVE)');
    Db.close();
    Log(State.Stop ? `STOPPED: ${State.Stop}. Safe to run again later: it picks up the rows still there.` : 'done');
    Log(`archived ${State.Archived}, deleted ${State.Deleted}. The file does not shrink by itself; see the runbook.`);
    return State.Stop ? 2 : 0;
}

function Restore(Sqlite, File, A){
    const Dir = A['archive-dir'];
    if(!Dir) throw new Error('--restore needs --archive-dir');
    const Db = Open(Sqlite, File, false);
    const Only = A.tablesGiven ? new Set(A.tables.split(',')) : null; // default: everything in the archive
    let Inserted = 0, Seen = 0;
    for(const {T, File: F, Member} of ArchiveMembers(Dir)){
        if(Only && !Only.has(T)) continue;
        const Rows = ReadMember(F, Member);
        const Cols = Object.keys(Rows[0]);
        const Ins = Db.prepare(`INSERT OR IGNORE INTO ${T} (${Cols.join(',')}) VALUES (${Cols.map((C) => '@' + C).join(',')})`);
        const Batch = Number(A.batch);
        for(let i = 0; i < Rows.length; i += Batch){
            try {
                Inserted += Db.transaction((Chunk) => Chunk.reduce((n, R) => n + Ins.run(R).changes, 0))(Rows.slice(i, i + Batch));
            } catch(E){
                if(IsBusy(E)){ Log(`STOPPED: busy/locked (${E.message}); run --restore again, it skips rows already back`); Db.close(); return 2; }
                throw E;
            }
            Seen += Math.min(Batch, Rows.length - i);
        }
    }
    Db.close();
    Log(`restore: ${Seen} archived rows read, ${Inserted} inserted (${Seen - Inserted} were already there)`);
    return 0;
}

function VerifyArchive(A){
    let Rows = 0, Members = 0;
    for(const {File, Member} of ArchiveMembers(A['archive-dir'])){ Rows += ReadMember(File, Member).length; Members++; }
    Log(`archive ok: ${Members} members, ${Rows} rows`);
    return 0;
}

function DryRun(Sqlite, File, A){
    const Db = Open(Sqlite, File, true);
    let TotalRows = 0, TotalBytes = 0;
    for(const T of A.tables.split(',')){
        const P = Plan(Db, A, T);
        const All = Db.prepare(`SELECT count(*) FROM ${T}`).pluck().get();
        const C = Count(Db, P, A);
        TotalRows += C.Rows; TotalBytes += C.Bytes;
        Log(`${T}: ${All} rows; would archive+delete ${C.Rows} (${Describe(P)}), ~${Mb(C.Bytes)} of row data${C.Exact ? '' : ' (estimated)'}`);
    }
    Db.close();
    Log(`DRY RUN total: ${TotalRows} rows, ~${Mb(TotalBytes)}. Nothing was changed. Add --execute --archive-dir <dir> to do it.`);
    return 0;
}

function Main(){
    const A = ParseArgs(process.argv.slice(2));
    if(A.help){ const Lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1); console.log(Lines.slice(0, Lines.findIndex((L) => !L.startsWith('//'))).join('\n')); return 0; }
    if(A['verify-archive']) return VerifyArchive(A);
    if(!A.db) throw new Error('--db <path> is required');
    const File = CheckDbPath(A.db, A);
    const Sqlite = LoadSqlite();
    if(A.restore) return Restore(Sqlite, File, A);
    if(A.execute) return Execute(Sqlite, File, A);
    return DryRun(Sqlite, File, A);
}

if(require.main === module){
    try { process.exitCode = Main(); }
    catch(E){ console.error(`history-trim: ${E.message}`); process.exitCode = 1; }
}
module.exports = {TABLES, ParseArgs, CheckDbPath};
