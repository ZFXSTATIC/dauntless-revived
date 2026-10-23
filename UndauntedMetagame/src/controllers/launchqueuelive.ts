// The live launch queue: the deploy server's fleet, the players online and the last "no room"
// answer, read when a launcher polls. The queue and gate themselves are in launchqueue.ts.

import { LaunchGate, LaunchQueue, type FleetReport, type FleetState, type GateSettings } from "./launchqueue";
import { LastCapacityRefusal } from "./capacitysignal";
import { ClassifyPlace } from "./serverstatus";
import { GetOnlinePlayerActivity } from "./undauntedapi";

// LAUNCH_RESERVE_HUNTS: spare hunt slots kept even when nobody is online (default 2).
// LAUNCH_PLAYERS_PER_HUNT: online players outside hunts per spare slot (default 2).
// LAUNCH_REFUSAL_LOCK_SECONDS: how long one "no room" answer holds new launchers (default 60).
function ReadGateSettings(): GateSettings {
    const read = (name: string, fallback: number, min: number) => {
        const value = Number(process.env[name] ?? fallback);
        if (!Number.isSafeInteger(value) || value < min) throw new Error(`Invalid ${name}`);
        return value;
    };
    return {
        reserveMin: read("LAUNCH_RESERVE_HUNTS", 2, 0),
        playersPerHunt: read("LAUNCH_PLAYERS_PER_HUNT", 2, 1),
        refusalMs: read("LAUNCH_REFUSAL_LOCK_SECONDS", 60, 0) * 1000
    };
}

let Instance: LaunchQueue | undefined;
let Gate: LaunchGate | undefined;
let FleetCache: { at: number, state: FleetState | undefined } | undefined;

// Online players in the city, menus or the Dojo: the ones who may start a hunt next.
function PlayersOutsideHunts() {
    return GetOnlinePlayerActivity().filter((Entry) => !["hunt", "tutorial"].includes(ClassifyPlace(Entry.Map, Entry.State))).length;
}

async function FetchFleet(): Promise<FleetReport | undefined> {
    const DeployServer = process.env.DEPLOYSERVER_URL;
    if (!DeployServer) return undefined;
    try {
        const Reply = await fetch(`http://${DeployServer}/gameservers`, { signal: AbortSignal.timeout(2000) });
        const fleet = Reply.status === 200 ? (await Reply.json() as any)?.fleet : undefined;
        if (typeof fleet?.locked === "boolean") return { locked: fleet.locked, free: Number.isFinite(fleet.free) ? fleet.free : null };
    } catch {}
    return undefined;
}

async function GateState(): Promise<FleetState | undefined> {
    if (FleetCache && Date.now() - FleetCache.at < 3000) return FleetCache.state;
    Gate ??= new LaunchGate(ReadGateSettings());
    const state = Gate.update(await FetchFleet(), PlayersOutsideHunts(), LastCapacityRefusal(), Date.now());
    FleetCache = { at: Date.now(), state };
    return state;
}

export function GetLaunchQueue() {
    return Instance ??= new LaunchQueue(() => process.env.LAUNCH_QUEUE === "0" ? Promise.resolve(undefined) : GateState());
}
