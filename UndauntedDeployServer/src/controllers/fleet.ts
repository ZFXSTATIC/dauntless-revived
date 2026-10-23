import { AusUrl } from './regions';
import { OverflowUrls } from './overflow';
import { huntAdmission } from './gameservers';
import { cpuAdmission } from './cpuadmission';

export type HostLoad = {running: number, pending: number, limit: number | null, cpuBlocked: boolean};

// Whole-fleet load with hysteresis: the fleet locks at LOCK percent of the summed hunt slots
// (or when every reachable host is CPU blocked) and unlocks again below RESUME percent.
// A host that cannot be read adds no capacity; with no readable host at all the fleet stays locked.
export class FleetLock {
    private locked = false;
    constructor(private lockPercent = 90, private resumePercent = 75) {
        if (!(lockPercent > 0 && lockPercent <= 100 && resumePercent >= 0 && resumePercent < lockPercent)) throw new Error('Invalid fleet lock thresholds');
    }
    update(hosts: (HostLoad | null)[]) {
        const known = hosts.filter((host): host is HostLoad => host !== null);
        const limited = known.filter(host => host.limit !== null && host.limit > 0);
        const running = known.reduce((sum, host) => sum + host.running, 0);
        const pending = known.reduce((sum, host) => sum + host.pending, 0);
        const limit = limited.length === known.length && known.length > 0 ? limited.reduce((sum, host) => sum + host.limit!, 0) : null;
        const percent = limit ? 100 * (running + pending) / limit : null;
        const cpuFull = known.length > 0 && known.every(host => host.cpuBlocked);
        if (known.length === 0 || cpuFull || (percent !== null && percent >= this.lockPercent)) this.locked = true;
        // Without a slot count only the CPU rule applies, and it has its own hysteresis.
        else if (percent === null || percent <= this.resumePercent) this.locked = false;
        return {locked: this.locked, running, pending, limit, percent, hosts: hosts.length, reachable: known.length,
            free: limit === null ? null : Math.max(0, limit - running - pending)};
    }
}

async function WorkerHost(url: URL): Promise<HostLoad | null> {
    try {
        const response = await fetch(new URL('/gameservers', url), {signal: AbortSignal.timeout(1500), redirect: 'error'});
        const body = await response.json() as any;
        const {running, pending, limit} = body.capacity ?? {};
        if (!response.ok || !Number.isFinite(running) || !Number.isFinite(pending)) return null;
        return {running, pending, limit: Number.isFinite(limit) ? limit : null, cpuBlocked: body.capacity?.cpu?.blocked === true};
    } catch { return null; }
}

const lock = new FleetLock(Number(process.env.FLEET_LOCK_PERCENT ?? 90), Number(process.env.FLEET_RESUME_PERCENT ?? 75));

export async function DescribeFleet() {
    const local = huntAdmission.status();
    const urls = [...OverflowUrls(), AusUrl('aus'), AusUrl('ger')].filter((url): url is URL => url !== undefined);
    const workers = await Promise.all(urls.map(WorkerHost));
    return lock.update([{...local, cpuBlocked: cpuAdmission.status().blocked}, ...workers]);
}
