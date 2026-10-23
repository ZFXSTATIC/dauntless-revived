// The host's launch queue, as one module any launcher look can use.
//
// While the host is locked for load (it keeps spare hunt slots for players already online),
// PLAY waits in its queue instead of starting the game. To use it:
//   1. const queue = new LaunchQueueClient({ onChange: (place) => redraw() });
//   2. in play(), after the account check and before the game starts:
//        if (!(await queue.wait(endpoint, key))) return;   // false: the player left the queue
//   3. draw queue.place ({position, length} or null) however the page likes, with a button
//      that calls queue.leave().
// Turn it off with LAUNCH_QUEUE_ENABLED below, or { enabled: false } per launcher.
//
// Anything but a "queued" answer lets the game start: an older host without the queue, an
// unreachable one, or one that cannot read its fleet never blocks a player.

import { request, parseJsonBody, type Endpoint, type HttpResponse } from "./http";
import { isPlausibleAccountKey } from "../shared/username";
import { isPrivateModeHost } from "../shared/invite";

export const LAUNCH_QUEUE_ENABLED = true;
// How often a waiting launcher asks again. The host drops a place not asked about for 20 s.
export const QUEUE_POLL_MS = 5000;

export interface QueuePlace {
  position: number;
  length: number;
}

export type QueueAnswer = { kind: "go" } | ({ kind: "queued" } & QueuePlace);

const KEY_HEADER = "x-undaunted-user-api-key";

// The same rule as every other key-carrying request (hostapi.ts): the key goes only to the
// invite's host, over the pinned TLS connection or in private mode.
function keyHeaders(ep: Endpoint, key: string): Record<string, string> {
  if (!isPlausibleAccountKey(key)) return {};
  if (ep.pin === null && !isPrivateModeHost(ep.host)) return {};
  return { [KEY_HEADER]: key };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown, min: number): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min ? v : null;
}

export async function pollQueue(ep: Endpoint, key: string): Promise<QueueAnswer> {
  let res: HttpResponse;
  try {
    res = await request(ep, "/undaunted/api/Queue", { method: "POST", headers: keyHeaders(ep, key), body: "{}", timeoutMs: 10000, maxBytes: 4096 });
  } catch {
    return { kind: "go" };
  }
  const body = parseJsonBody(res);
  if (res.status !== 200 || !isObject(body) || body.state !== "queued") return { kind: "go" };
  const position = count(body.position, 1) ?? 1;
  const length = Math.max(position, count(body.length, 1) ?? position);
  return { kind: "queued", position, length };
}

export async function leaveQueue(ep: Endpoint, key: string): Promise<void> {
  try {
    await request(ep, "/undaunted/api/Queue", { method: "POST", headers: keyHeaders(ep, key), body: JSON.stringify({ leave: true }), timeoutMs: 5000, maxBytes: 4096 });
  } catch {}
}

export interface LaunchQueueOptions {
  enabled?: boolean;
  pollMs?: number;
  onChange?: (place: QueuePlace | null) => void;
  log?: (message: string) => void;
}

export class LaunchQueueClient {
  place: QueuePlace | null = null;
  private abort: AbortController | null = null;

  constructor(private opts: LaunchQueueOptions = {}) {}

  get enabled(): boolean {
    return this.opts.enabled ?? LAUNCH_QUEUE_ENABLED;
  }

  // Resolves true when the game may start, false when the player left the queue.
  async wait(ep: Endpoint, key: string): Promise<boolean> {
    if (!this.enabled) return true;
    const abort = new AbortController();
    this.abort = abort;
    try {
      for (;;) {
        const answer = await pollQueue(ep, key);
        if (abort.signal.aborted) break;
        if (answer.kind === "go") return true;
        if (this.place?.position !== answer.position || this.place?.length !== answer.length) {
          if (!this.place) this.opts.log?.("host is busy: waiting in its launch queue");
          this.set({ position: answer.position, length: answer.length });
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.opts.pollMs ?? QUEUE_POLL_MS);
          abort.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (abort.signal.aborted) break;
      }
      this.opts.log?.("left the launch queue");
      await leaveQueue(ep, key);
      return false;
    } finally {
      this.abort = null;
      if (this.place) this.set(null);
    }
  }

  leave(): void {
    this.abort?.abort();
  }

  private set(place: QueuePlace | null): void {
    this.place = place;
    this.opts.onChange?.(place);
  }
}
