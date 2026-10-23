// Discord Rich Presence: tells the Discord app running on this PC what the player is doing ("Hunting in
// Dauntless Revived", "In the launcher"). It speaks Discord's local IPC (a named pipe or Unix socket on
// this PC) directly, so nothing goes over the network from here and no extra package is needed. With no
// Discord running, or no client id set, it does nothing.

import net from "node:net";
import path from "node:path";
import type { Snapshot } from "../shared/types";

export interface Activity {
  details: string;
  state?: string;
  timestamps?: { start: number };
  assets?: { large_image: string; large_text: string };
}

// Discord limits a presence update to one every 15 seconds.
export const MIN_UPDATE_MS = 15000;
const RETRY_MS = 30000;

// What the player is doing, from the launcher's own Snapshot. Streamer mode keeps the server and the
// player count out of it, and the Settings switch turns the whole thing off.
export function buildActivity(snap: Snapshot, gameStartedAt: number | null): Activity | null {
  if (snap.settings.discordPresence === false) return null;
  const hide = snap.settings.streamerMode === true;
  const server = snap.server && !hide ? (snap.status?.name ?? snap.server.name) : null;
  const online = snap.status && !hide && !snap.status.limited ? snap.status.playersOnline : null;
  const where = [server, online !== null ? `${online} online` : null].filter(Boolean).join(" · ");
  const assets = { large_image: "logo", large_text: "Dauntless Revived" };
  if (snap.game.running) {
    return { details: "Hunting in Dauntless Revived", ...(where ? { state: where } : {}), ...(gameStartedAt ? { timestamps: { start: gameStartedAt } } : {}), assets };
  }
  if (snap.phase === "installing") return { details: "Installing the game", assets };
  if (snap.phase === "ready") return { details: "In the launcher", state: "Ready to play", assets };
  return { details: "In the launcher", assets };
}

// Discord's frame: a 32-bit opcode and a 32-bit length (little endian), then JSON.
export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const out = Buffer.alloc(8 + body.length);
  out.writeInt32LE(op, 0);
  out.writeInt32LE(body.length, 4);
  body.copy(out, 8);
  return out;
}

export function decodeFrames(buf: Buffer): { frames: { op: number; data: unknown }[]; rest: Buffer } {
  const frames: { op: number; data: unknown }[] = [];
  let at = 0;
  while (buf.length - at >= 8) {
    const op = buf.readInt32LE(at);
    const len = buf.readInt32LE(at + 4);
    if (len < 0 || len > 1 << 20) return { frames, rest: Buffer.alloc(0) };
    if (buf.length - at - 8 < len) break;
    try {
      frames.push({ op, data: JSON.parse(buf.subarray(at + 8, at + 8 + len).toString("utf8")) });
    } catch {
      // A frame that is not JSON is skipped.
    }
    at += 8 + len;
  }
  return { frames, rest: buf.subarray(at) };
}

export function pipePaths(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    if (platform === "win32") out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    else out.push(path.posix.join(env.XDG_RUNTIME_DIR ?? env.TMPDIR ?? "/tmp", `discord-ipc-${i}`));
  }
  return out;
}

type Connect = (p: string) => net.Socket;

export class DiscordPresence {
  private sock: net.Socket | null = null;
  private ready = false;
  private buffer: Buffer = Buffer.alloc(0);
  private wanted: Activity | null = null;
  private sent = "";
  private lastSendAt = 0;
  private lastTryAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private connecting = false;

  constructor(
    private readonly clientId: string,
    private readonly connect: Connect = (p) => net.createConnection(p),
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return /^[0-9]{15,25}$/.test(this.clientId);
  }

  // The latest wanted activity (null clears it). Cheap to call on every snapshot.
  set(activity: Activity | null): void {
    if (!this.enabled) return;
    this.wanted = activity;
    this.flush();
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wanted = null;
    this.sock?.destroy();
    this.sock = null;
    this.ready = false;
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
    this.timer.unref?.();
  }

  private flush(): void {
    const sig = JSON.stringify(this.wanted);
    if (this.ready && this.sock) {
      if (sig === this.sent) return;
      const wait = this.lastSendAt + MIN_UPDATE_MS - this.now();
      if (wait > 0) return this.schedule(wait);
      this.sent = sig;
      this.lastSendAt = this.now();
      this.sock.write(encodeFrame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: this.wanted }, nonce: String(this.lastSendAt) }));
      return;
    }
    if (this.wanted === null || this.connecting) return;
    const wait = this.lastTryAt + RETRY_MS - this.now();
    if (wait > 0) return this.schedule(wait);
    this.lastTryAt = this.now();
    void this.open();
  }

  private async open(): Promise<void> {
    this.connecting = true;
    try {
      for (const p of pipePaths()) {
        const s = await this.tryPipe(p);
        if (s) {
          this.attach(s);
          return;
        }
      }
    } finally {
      this.connecting = false;
    }
    this.schedule(RETRY_MS);
  }

  private tryPipe(p: string): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      let s: net.Socket;
      try {
        s = this.connect(p);
      } catch {
        resolve(null);
        return;
      }
      s.once("error", () => resolve(null));
      s.once("connect", () => {
        s.removeAllListeners("error");
        resolve(s);
      });
    });
  }

  private attach(s: net.Socket): void {
    this.sock = s;
    this.ready = false;
    this.sent = "";
    this.buffer = Buffer.alloc(0);
    s.on("data", (d) => {
      const { frames, rest } = decodeFrames(Buffer.concat([this.buffer, d]));
      this.buffer = rest;
      for (const f of frames) {
        const data = f.data as { evt?: string } | null;
        if (f.op === 1 && data?.evt === "READY") {
          this.ready = true;
          this.flush();
        }
        if (f.op === 2) s.destroy();
        if (f.op === 3) s.write(encodeFrame(4, f.data));
      }
    });
    const gone = (): void => {
      if (this.sock === s) {
        this.sock = null;
        this.ready = false;
        this.schedule(RETRY_MS);
      }
    };
    s.on("close", gone);
    s.on("error", gone);
    s.write(encodeFrame(0, { v: 1, client_id: this.clientId }));
  }
}
