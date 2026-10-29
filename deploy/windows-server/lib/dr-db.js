// Dauntless Revived - database helpers for the Windows Server kit.
//
//   node dr-db.js <command> <UndauntedMetagame folder> <database> [args]
//
//   integrity  <meta> <db>                  read-only integrity check; prints "ok, <n> users"
//   backup     <meta> <db> <dest>           SQLite online backup (safe while the metagame runs), then
//                                           checks the copy
//   add-invite <meta> <db> <code>           one-use invite code (the installer's bootstrap for the owner)
//   del-invite <meta> <db> <code>
//   make-admin <meta> <db> <userId>
//   gs-key     <meta> <db> <keyFile>        makes sure the game-server key's SHA-256 is registered
//
// better-sqlite3 is loaded from the metagame's own node_modules. Keys are read from files and never
// printed; the metagame stores only SHA-256 hashes of them.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { backupProgress } = require("./backup-policy.cjs");

function fail(message) {
    throw new Error(message);
}

function open(Database, file, readonly) {
    if (!fs.existsSync(file)) fail(`no database at ${file}`);
    return new Database(file, { readonly, fileMustExist: true });
}

function check(Database, file) {
    const db = open(Database, file, true);
    try {
        const result = db.pragma("integrity_check", { simple: true });
        if (result !== "ok") fail(`integrity_check says: ${result}`);
        const users = db.prepare("SELECT count(*) AS n FROM users").get().n;
        return `ok, ${users} users`;
    } finally {
        db.close();
    }
}

const LIVE_BACKUP_TIMEOUT_MS = 905000;

// POST JSON to the metagame's live-backup endpoint. node:http is used instead of fetch because
// fetch (undici) gives up after 300 s without response headers and reports only "fetch failed";
// the metagame answers only when the whole multi-gigabyte copy is done. Errors keep their code
// and cause in the message.
function postLiveBackup(url, headers, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = http.request(url, {
            method: 'POST',
            headers: {...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body)}
        }, (res) => {
            res.resume();
            res.on('end', () => { clearTimeout(timer); resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode}); });
            res.on('error', fail);
        });
        const timer = setTimeout(() => {
            const e = new Error(`live backup request timed out after ${Math.round(timeoutMs / 1000)}s; the metagame may still be copying`);
            e.code = 'ETIMEDOUT';
            req.destroy(e);
        }, timeoutMs);
        function fail(error) {
            clearTimeout(timer);
            const detail = [error.code, error.cause?.code, error.cause?.message].filter(Boolean).join(' / ');
            const e = new Error(`live backup request failed: ${error.message}${detail && !error.message.includes(detail) ? ` (${detail})` : ''}`);
            e.code = error.code;
            reject(e);
        }
        req.on('error', fail);
        req.end(body);
    });
}

async function main(args = process.argv.slice(2)) {
    const [command, metaDir, dbFile, ...rest] = args;
    if (!command || !metaDir || !dbFile) fail("usage: dr-db.js <command> <metagame dir> <db> [args]");
    let Database;
    try {
        Database = require(path.join(path.resolve(metaDir), "node_modules", "better-sqlite3"));
    } catch (e) {
        fail(`better-sqlite3 not found under ${metaDir} (run npm ci there first): ${e.message}`);
    }
    switch (command) {
        case "integrity": {
            console.log(check(Database, dbFile));
            return;
        }
        case "backup": {
            const dest = rest[0];
            if (!dest) fail("backup needs a destination file");
            if (rest[1] === '--online' && rest[2]) {
                const env = require(path.join(path.resolve(metaDir), 'node_modules', 'dotenv')).parse(fs.readFileSync(rest[2]));
                let response;
                try {
                    response = await postLiveBackup('http://127.0.0.1:61000/internal/backup', {
                        'x-undaunted-gameserver-apikey': env.METAGAME_API_KEY
                    }, {name: path.basename(path.dirname(dest))}, LIVE_BACKUP_TIMEOUT_MS);
                } catch (error) {
                    // Only a refused connection proves the metagame is stopped. A timeout
                    // may still be copying; do not start another backup in that case.
                    if (error.code !== 'ECONNREFUSED') throw error;
                }
                if (response?.ok) { console.log(`db ${check(Database, dest)}`); return; }
                if (response && response.status === 409) throw new Error('Live backup refused (409): another live backup is still running or the folder already holds a copy');
                if (response && response.status !== 404) throw new Error(`Live backup failed (${response.status})`);
            }
            const db = open(Database, dbFile, true);
            try {
                await db.backup(dest, { progress: backupProgress() });
            } finally {
                db.close();
            }
            console.log(`db ${check(Database, dest)}`);
            return;
        }
        case "add-invite":
        case "del-invite": {
            const code = rest[0];
            if (!code || !/^[A-Za-z0-9-]{4,64}$/.test(code)) fail("bad invite code");
            const db = open(Database, dbFile, false);
            try {
                if (command === "add-invite") {
                    db.prepare("INSERT OR REPLACE INTO invitecodes (invitecode, usesRemaining, infiniteUses) VALUES (?, 1, 0)").run(code);
                } else {
                    db.prepare("DELETE FROM invitecodes WHERE invitecode = ?").run(code);
                }
            } finally {
                db.close();
            }
            console.log(command === "add-invite" ? "invite added" : "invite removed");
            return;
        }
        case "make-admin": {
            const userId = rest[0];
            if (!userId) fail("make-admin needs a user id");
            const db = open(Database, dbFile, false);
            try {
                const r = db.prepare("UPDATE users SET isAdmin = 1 WHERE userId = ?").run(userId);
                if (r.changes !== 1) fail("no such user");
            } finally {
                db.close();
            }
            console.log("admin flag set");
            return;
        }
        case "gs-key": {
            const keyFile = rest[0];
            if (!keyFile || !fs.existsSync(keyFile)) fail("gs-key needs the key file");
            const key = fs.readFileSync(keyFile, "utf8").trim();
            if (key.length < 32) fail("the game-server key file looks empty or truncated");
            const hash = crypto.createHash("sha256").update(key, "utf8").digest("hex");
            const db = open(Database, dbFile, false);
            try {
                const present = db.prepare("SELECT count(*) AS n FROM gameserverapikeys WHERE keyHash = ?").get(hash).n > 0;
                if (present) {
                    console.log("game-server key already registered");
                } else {
                    db.prepare("INSERT INTO gameserverapikeys (keyHash) VALUES (?)").run(hash);
                    console.log("game-server key registered");
                }
            } finally {
                db.close();
            }
            return;
        }
        default:
            fail(`unknown command ${command}`);
    }
}

module.exports = main;
module.exports.postLiveBackup = postLiveBackup;
if (require.main === module) main().catch((e) => {
    console.error(`dr-db: ${e.message}`);
    process.exitCode = 1;
});
