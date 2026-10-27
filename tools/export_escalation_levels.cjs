// Run ON the Revived host from UndauntedMetagame (needs better-sqlite3): node export_escalation_levels.cjs <outFile.json>
// Read-only: opens the database with readonly:true and runs SELECT only. Writes one JSON file:
// [{accountId, name, discordId|null, seasons:[{seasonId, level, xp, updatedDate}]}]
// Dauntless Revived stores one escalation level and xp per season (escalationprogression), not one per escalation type.
// discordId is only set for accounts linked with /key link (discordlinks).
const D = require("better-sqlite3");
const fs = require("fs");

const [, , Out] = process.argv;
if (!Out) { console.error("usage: export_escalation_levels.cjs <outFile.json>"); process.exit(1); }

const Db = new D(process.env.DR_DB || "C:/DauntlessRevived/data/undaunted.db", { readonly: true, fileMustExist: true });
const Rows = Db.prepare(
    "select p.accountId, u.name, l.discordId, p.seasonId, p.level, p.xp, p.updatedDate " +
    "from escalationprogression p " +
    "left join users u on u.userId = p.accountId " +
    "left join discordlinks l on l.userId = p.accountId " +
    "order by p.accountId, p.seasonId").all();

const ByAccount = new Map();
for (const R of Rows) {
    let A = ByAccount.get(R.accountId);
    if (!A) { A = { accountId: R.accountId, name: R.name ?? null, discordId: R.discordId ?? null, seasons: [] }; ByAccount.set(R.accountId, A); }
    A.seasons.push({ seasonId: R.seasonId, level: R.level, xp: R.xp, updatedDate: R.updatedDate });
}
const Doc = { exportedAt: new Date().toISOString(), accounts: [...ByAccount.values()] };
fs.writeFileSync(Out, JSON.stringify(Doc));
console.log(`done: ${Doc.accounts.length} accounts, ${Rows.length} season rows, ${Doc.accounts.filter(a => a.discordId).length} with a Discord link`);
