import {openSync,closeSync,fstatSync,readSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

export function ParseNativeOccupancy(text:string):number|undefined {
    const matches=[...text.matchAll(/^net driver=IpNetDriver[^\r\n]* connections=(\d+) owned=(\d+) open=(\d+)\r?$/gm)];
    const last=matches.at(-1);
    return last ? Number(last[1]) : undefined;
}

// Under Wine (the Linux workers) the game writes its files under its own Windows process id, which is not
// the id of the process the deploy server started. Each game creates its native-fault-<id>.log shortly
// after it starts, so a game is matched to the oldest unclaimed log created at or after its start.
export type WineLogFile = {winePid:number, bornAt:number};
export type WineCandidate = {pid:number, startedAt:number};
const WINE_START_SLACK_MS = 2000;
const WINE_START_WINDOW_MS = 3*60000;
export function AssignWinePids(servers:WineCandidate[], files:WineLogFile[], claimed:Set<number>):Map<number,number> {
    const taken = new Set(claimed);
    const assigned = new Map<number,number>();
    const order = servers.slice().sort((a,b) => a.startedAt-b.startedAt || a.pid-b.pid);
    const pool = files.slice().sort((a,b) => a.bornAt-b.bornAt || a.winePid-b.winePid);
    for (const server of order) {
        const hit = pool.find(f => !taken.has(f.winePid) && f.bornAt >= server.startedAt-WINE_START_SLACK_MS && f.bornAt <= server.startedAt+WINE_START_WINDOW_MS);
        if (!hit) continue;
        taken.add(hit.winePid);
        assigned.set(server.pid, hit.winePid);
    }
    return assigned;
}
const Registered = new Map<number,number>();   // process id -> start time (ms)
const WinePids = new Map<number,number>();     // process id -> the game's own id
function ReadyDir():string|undefined { return process.env.GAMESERVER_READY_DIR || undefined; }
function ListWineLogs(dir:string):WineLogFile[] {
    const files:WineLogFile[] = [];
    try {
        for (const name of readdirSync(dir)) {
            const m = /^native-fault-(\d+)\.log$/.exec(name);
            if (!m) continue;
            try { files.push({winePid:Number(m[1]), bornAt:statSync(path.join(dir,name)).birthtimeMs}); } catch {}
        }
    } catch {}
    return files;
}
// The id the game uses in its own file names. Native Windows hosts: the process id itself.
export function GameProcessId(pid:number, startedAt:Date):number|undefined {
    if (process.platform !== 'linux') return pid;
    const dir = ReadyDir();
    if (!dir || !Number.isSafeInteger(pid) || pid < 1) return undefined;
    Registered.set(pid, startedAt.getTime());
    const known = WinePids.get(pid);
    if (known !== undefined) return known;
    const unresolved = [...Registered].filter(([p]) => !WinePids.has(p)).map(([p,s]) => ({pid:p, startedAt:s}));
    const found = AssignWinePids(unresolved, ListWineLogs(dir), new Set(WinePids.values()));
    for (const [p,w] of found) WinePids.set(p,w);
    // Forget games started more than a day ago so the maps cannot grow without end.
    const stale = Date.now()-24*3600000;
    for (const [p,s] of Registered) if (s < stale) { Registered.delete(p); WinePids.delete(p); }
    return WinePids.get(pid);
}

function ReadOccupancy(id:number, startedAt:Date):number|undefined {
    const dir = ReadyDir();
    if(!dir || !Number.isSafeInteger(id) || id<1)return undefined;
    let fd:number|undefined;
    try {
        fd=openSync(path.join(dir,`native-fault-${id}.log`),'r');
        const stat=fstatSync(fd);
        if(stat.mtimeMs<startedAt.getTime() || Date.now()-stat.mtimeMs>90000)return undefined;
        const buffer=Buffer.alloc(Math.min(stat.size,8192));
        const read=readSync(fd,buffer,0,buffer.length,stat.size-buffer.length);
        return ParseNativeOccupancy(buffer.subarray(0,read).toString());
    }catch{return undefined;}finally{if(fd!==undefined)closeSync(fd);}
}
// Only read the bounded tail of our own process's count-only diagnostic log.
// The idle-hunt watchdog uses this one, by process id exactly as before.
export function NativeOccupancy(pid:number, startedAt:Date):number|undefined {
    return ReadOccupancy(pid, startedAt);
}
// The same count found through the game's own id, for reporting and the city pool. A game that cannot be
// matched with certainty reports nothing, as before.
export function NativeReportedOccupancy(pid:number, startedAt:Date):number|undefined {
    const id = GameProcessId(pid, startedAt);
    return id === undefined ? undefined : ReadOccupancy(id, startedAt);
}

// Atomic, bounded snapshots from pooled cities; stale counts never prove free seats.
export function NativeCityOccupancy(pid:number, startedAt:Date):number|undefined {
    const dir = ReadyDir();
    const id = GameProcessId(pid, startedAt);
    if (!dir || id === undefined || !Number.isSafeInteger(id) || id < 1) return undefined;
    let fd:number|undefined;
    try {
        fd=openSync(path.join(dir,`city-occupancy-${id}.txt`),'r');
        const stat=fstatSync(fd);
        if (stat.size > 64 || stat.mtimeMs < startedAt.getTime() || Date.now()-stat.mtimeMs > 2500) return undefined;
        const buffer=Buffer.alloc(64);
        const read=readSync(fd,buffer,0,64,0);
        const match=/^(\d+) (\d+)\s*$/.exec(buffer.subarray(0,read).toString());
        if (!match || Number(match[1]) !== id) return undefined;
        const count=Number(match[2]);
        return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
    } catch { return undefined; } finally { if(fd!==undefined)closeSync(fd); }
}
