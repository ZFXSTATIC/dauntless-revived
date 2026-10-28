import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CapacityUnavailable } from './capacity';
import { RemoteLaunch, ReadWorkerSnapshot, GameserverSnapshot, OverflowUrl } from './overflow';
import { SetUrlKeyResolver } from './huntlimits';

export type RegionChoice = 'main' | 'aus' | 'ger' | 'us' | 'sg' | 'mixed';
type Request = Parameters<typeof RemoteLaunch>[1];
type Load = {running:number,pending:number,limit:number|null};
type WorkerRegion = 'aus' | 'ger' | 'us' | 'sg';
type WorkerEntry = {urls: string[], hosts: string[]};
// workers.json: {"us": {"urls": ["http://127.0.0.1:61041", "http://127.0.0.1:61042"], "hosts": ["1.2.3.4", "5.6.7.8"]}, "ger": {...}}
// It is looked at on every call (stat first, parsed only when it changed), so a worker is added by editing
// this file and the deploy server does not restart. Missing or unreadable: the last good copy, then the
// *_DEPLOYSERVER_URL and *_PUBLIC_HOST settings below. Only us, ger and sg may list several workers.
let WorkersCache: {mtimeMs: number, data: any} = {mtimeMs: -1, data: undefined};
function WorkersFile() {
    return process.env.WORKERS_FILE || resolve(process.cwd(), '..', '..', 'data', 'config', 'workers.json');
}
function FileWorkers(region: WorkerRegion): WorkerEntry | undefined {
    try {
        const file = WorkersFile();
        const mtimeMs = statSync(file).mtimeMs;
        if (mtimeMs !== WorkersCache.mtimeMs) {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            WorkersCache = {mtimeMs, data: parsed && typeof parsed === 'object' ? parsed : undefined};
        }
    } catch {
        // keep the last good copy
    }
    const entry = WorkersCache.data?.[region];
    if (!entry || !Array.isArray(entry.urls) || !entry.urls.length) return undefined;
    return {urls: entry.urls.map(String), hosts: Array.isArray(entry.hosts) ? entry.hosts.map(String) : []};
}
export function WorkerHosts(region: WorkerRegion): string[] {
    const file = region === 'aus' ? undefined : FileWorkers(region);
    if (file && file.hosts.length) return file.hosts;
    const setting = region === 'us' ? 'US_PUBLIC_HOST' : region === 'ger' ? 'GERMANY_PUBLIC_HOST' : region === 'sg' ? 'SG_PUBLIC_HOST' : 'AUS_PUBLIC_HOST';
    return (process.env[setting] ?? '').split(',').map(host => host.trim()).filter(Boolean);
}
export function AusUrls(region: WorkerRegion = 'aus'): URL[] {
    // Retired permanently, including when an old environment file is restored.
    if (region === 'aus') return [];
    const setting = region === 'us' ? 'US_DEPLOYSERVER_URL' : region === 'sg' ? 'SG_DEPLOYSERVER_URL' : 'GERMANY_DEPLOYSERVER_URL';
    const fromFile = FileWorkers(region);
    const raw = fromFile ? fromFile.urls.join(',') : process.env[setting];
    if (!raw) return [];
    return raw.split(',').map(item => item.trim()).filter(Boolean).map(item => {
        const url = new URL(item);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
            throw new Error(`${setting} must be an HTTP loopback tunnel`);
        return url;
    });
}
export function AusUrl(region: WorkerRegion = 'aus') {
    return AusUrls(region)[0];
}
SetUrlKeyResolver(url => {
    for (const region of ['us', 'ger', 'sg'] as const) {
        try { if (AusUrls(region).some(worker => worker.origin === url.origin)) return region; } catch { /* bad setting: not this region */ }
    }
    try { if (OverflowUrl()?.origin === url.origin) return 'overflow'; } catch { /* ignore */ }
    return undefined;
});
export function Utilization(load: Load) {
    return load.limit && load.limit > 0 ? (load.running + load.pending) / load.limit : Infinity;
}
export async function DescribeAusSnapshot(region: WorkerRegion = 'aus'): Promise<GameserverSnapshot> {
    const urls = AusUrls(region);
    if (!urls.length) return {servers: [], complete: true};
    const parts = await Promise.all(urls.map(url => ReadWorkerSnapshot(url)));
    return {
        ...parts[0],
        complete: parts.every(part => part.complete !== false),
        servers: parts.flatMap(part => part.servers.map(server => ({...server, host: region, region})))
    };
}
export async function DescribeAus(region: 'aus' | 'ger' | 'us' | 'sg' = 'aus'): Promise<any[]> {
    return (await DescribeAusSnapshot(region)).servers;
}
export class RegionalRouter {
    constructor(private mainLoad: () => Promise<Load>, private remote = RemoteLaunch,
        private ausLoad = async (url: URL): Promise<Load> => {
            const response = await fetch(new URL('/gameservers', url), {signal:AbortSignal.timeout(2000),redirect:'error'});
            if (!response.ok) throw new Error('AUS capacity unavailable');
            const body = await response.json() as {capacity:Load};
            if (!body.capacity || !Number.isFinite(body.capacity.running) || !Number.isFinite(body.capacity.pending)) throw new Error('Invalid AUS capacity');
            return body.capacity;
        }) {}
    async launch<T>(body: Request, choice: RegionChoice, main: () => Promise<T>): Promise<T | NonNullable<Awaited<ReturnType<typeof RemoteLaunch>>>> {
        if (choice === 'ger' || choice === 'us' || choice === 'sg') {
            const workers = AusUrls(choice);
            if (!workers.length) throw new CapacityUnavailable('hunts');
            const hosts = WorkerHosts(choice);
            // Only hunts move on to the next worker. Ramsgate and Training run on the first worker alone: an extra
            // worker is usually hunts-only and answers any world with an error, which would fail the whole launch.
            // An ambiguous failure (timeout, reset) throws out of remote() and is never retried on another worker.
            const candidates = body.GameMode === 'ISLAND' ? workers : workers.slice(0, 1);
            for (const worker of candidates) {
                const connection = await this.remote(worker, body);
                if (!connection) continue;
                if (hosts.length && !hosts.includes(connection.host))
                    throw new Error('Regional worker returned a destination outside the selected region');
                return connection;
            }
            throw new CapacityUnavailable('hunts');
        }
        const primary = main;
        main = async () => {
            try { return await primary(); }
            catch (error) {
                if (!(error instanceof CapacityUnavailable)) throw error;
                const germany = AusUrl('ger');
                const connection = germany && await this.remote(germany, {...body, Overflow:true});
                if (connection) return connection as T;
                throw error;
            }
        };
        if (choice === 'aus') throw new CapacityUnavailable('hunts');
        const url = AusUrl('us');
        if (!['ISLAND','CITY','SHARED'].includes(body.GameMode)) return main();
        if (!url) return main();
        let ausFirst = false;
        if (choice === 'mixed') {
            try {
                const [primary, aus] = await Promise.all([this.mainLoad(), this.ausLoad(url)]);
                ausFirst = Utilization(aus) < Utilization(primary);
            } catch { ausFirst = false; }
        }
        if (ausFirst) {
            const connection = await this.remote(url, body);
            if (connection) {
                return connection;
            }
            return main();
        }
        try { return await main(); }
        catch (error) {
            if (!(error instanceof CapacityUnavailable)) throw error;
            // Overflow must leave slots for players who explicitly selected US.
            const reserve=Number(process.env.US_RESERVED_HUNTS??0);
            if(!Number.isSafeInteger(reserve)||reserve<0)throw new Error('Invalid US_RESERVED_HUNTS');
            if(reserve>0 && body.GameMode==='ISLAND') {
                try {const load=await this.ausLoad(url);if(load.limit===null||load.limit-load.running-load.pending<=reserve)throw error;}
                catch {throw error;}
            }
            const connection = await this.remote(url, {...body, Overflow:true});
            if (connection) return connection;
            throw error;
        }
    }
}
