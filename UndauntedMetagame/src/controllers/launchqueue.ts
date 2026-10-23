// Launcher queue. While the whole fleet is locked for load, a launcher asks here before it
// starts the game; players get in first come, first served as hunt slots free up.
// In memory only: a metagame restart empties it and the launchers join again on their next poll.
// An unreadable fleet never blocks anyone.

export type FleetState = { locked: boolean, free: number | null };
export type QueueReply =
    | { state: "open" }
    | { state: "queued", position: number, length: number }
    | { state: "ready", expiresInSeconds: number };

const TICKET_MS = 3 * 60 * 1000;
const STALE_MS = 20 * 1000;
const MAX_QUEUE = 2000;

export class LaunchQueue {
    private waiting = new Map<string, number>();
    private tickets = new Map<string, number>();

    constructor(private fleet: () => Promise<FleetState | undefined>, private now = () => Date.now()) {}

    private sweep() {
        const now = this.now();
        for (const [id, seen] of this.waiting) if (now - seen > STALE_MS) this.waiting.delete(id);
        for (const [id, until] of this.tickets) if (until <= now) this.tickets.delete(id);
    }

    async poll(userId: string): Promise<QueueReply> {
        this.sweep();
        const now = this.now();
        const ticket = this.tickets.get(userId);
        if (ticket !== undefined) return {state: "ready", expiresInSeconds: Math.ceil((ticket - now) / 1000)};

        const fleet = await this.fleet();
        if (!fleet || (!fleet.locked && this.waiting.size === 0)) { this.waiting.delete(userId); return {state: "open"}; }

        // Setting an existing key refreshes its last-seen time and keeps its place in line.
        if (!this.waiting.has(userId) && this.waiting.size >= MAX_QUEUE) return {state: "queued", position: MAX_QUEUE, length: MAX_QUEUE};
        this.waiting.set(userId, now);

        if (!fleet.locked) {
            // Every ticket holds a slot until it is used or expires.
            let room = fleet.free === null ? 1 : Math.max(0, fleet.free - this.tickets.size);
            for (const id of this.waiting.keys()) {
                if (room-- <= 0) break;
                this.tickets.set(id, now + TICKET_MS);
            }
            for (const id of this.tickets.keys()) this.waiting.delete(id);
            const mine = this.tickets.get(userId);
            if (mine !== undefined) return {state: "ready", expiresInSeconds: Math.ceil((mine - now) / 1000)};
        }
        return {state: "queued", position: [...this.waiting.keys()].indexOf(userId) + 1, length: this.waiting.size};
    }

    leave(userId: string) { this.waiting.delete(userId); this.tickets.delete(userId); }
    length() { return this.waiting.size; }
}

let Instance: LaunchQueue | undefined;
let FleetCache: { at: number, state: FleetState | undefined } | undefined;

// The deploy server's GET /gameservers "fleet" (UndauntedDeployServer/src/controllers/fleet.ts)
async function FetchFleet(): Promise<FleetState | undefined> {
    if (FleetCache && Date.now() - FleetCache.at < 3000) return FleetCache.state;
    let state: FleetState | undefined;
    const DeployServer = process.env.DEPLOYSERVER_URL;
    if (DeployServer) {
        try {
            const Reply = await fetch(`http://${DeployServer}/gameservers`, { signal: AbortSignal.timeout(2000) });
            const fleet = Reply.status === 200 ? (await Reply.json() as any)?.fleet : undefined;
            if (typeof fleet?.locked === "boolean") state = { locked: fleet.locked, free: Number.isFinite(fleet.free) ? fleet.free : null };
        } catch {}
    }
    FleetCache = { at: Date.now(), state };
    return state;
}

export function GetLaunchQueue() {
    return Instance ??= new LaunchQueue(() => process.env.LAUNCH_QUEUE === "0" ? Promise.resolve(undefined) : FetchFleet());
}
