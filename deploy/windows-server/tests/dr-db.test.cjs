const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const helper = path.resolve(__dirname, "../lib/dr-db.js");

test("import is inert and library usage rejects errors without terminating the caller", async () => {
    const child = spawnSync(process.execPath, ["-e", `const main=require(${JSON.stringify(helper)});main([]).catch(()=>console.log("caller survived"));`], { encoding: "utf8" });
    assert.equal(child.status, 0);
    assert.equal(child.stdout.trim(), "caller survived");
    assert.equal(child.stderr, "");
    const cli = spawnSync(process.execPath, [helper], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /^dr-db: usage:/);
});

test("gs-key retains hash-only, idempotent registration and closes handles on success and failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-db-unit-"));
    const moduleDir = path.join(root, "node_modules", "better-sqlite3");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, "index.js"), `
const state = { hashes: [], active: 0, fail: false };
module.exports = class Database {
    static state = state;
    constructor() { state.active++; }
    prepare() { return {
        get: hash => ({ n: state.hashes.includes(hash) ? 1 : 0 }),
        run: hash => { if (state.fail) throw new Error("database write failed"); state.hashes.push(hash); }
    }; }
    close() { state.active--; }
};`);
    const db = path.join(root, "test.db");
    const keyFile = path.join(root, "gameserver.key");
    fs.writeFileSync(db, "fixture");
    const key = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(keyFile, key);
    const Database = require(moduleDir);
    const main = require(helper);
    try {
        await main(["gs-key", root, db, keyFile]);
        await main(["gs-key", root, db, keyFile]);
        assert.deepEqual(Database.state.hashes, [crypto.createHash("sha256").update(key).digest("hex")]);
        assert.equal(Database.state.active, 0);
        const cli = spawnSync(process.execPath, [helper, "gs-key", root, db, keyFile], { encoding: "utf8" });
        assert.equal(cli.status, 0);
        assert.equal(cli.stdout.trim(), "game-server key registered");
        assert.ok(!cli.stdout.includes(key) && !cli.stderr.includes(key));
        Database.state.fail = true;
        fs.writeFileSync(keyFile, crypto.randomBytes(24).toString("hex"));
        await assert.rejects(main(["gs-key", root, db, keyFile]), /database write failed/);
        assert.equal(Database.state.active, 0);
        await assert.rejects(main(["gs-key", root, db, path.join(root, "missing.key")]), /needs the key file/);
        assert.equal(Database.state.active, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
