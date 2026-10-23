import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivity, decodeFrames, DiscordPresence, encodeFrame, pipePaths } from "../src/main/presence";
import type { Snapshot } from "../src/shared/types";

function snap(over: Partial<Snapshot> & { running?: boolean; streamer?: boolean; presence?: boolean } = {}): Snapshot {
  return {
    phase: "ready",
    server: { mode: "public", host: "h", port: 443, name: "Main", hasShare: false, hasPendingInvite: false, loopback: false, fingerprint: null },
    status: { name: "Main", online: true, version: "1", commit: "", sourceUrl: null, registration: "OPEN", playersOnline: 12, players: [], instances: [], contentPort: null, uptimeSeconds: 0, limited: false },
    game: { running: over.running === true, relayPort: null },
    settings: { graphics: 4, exposure: "game", windowed: false, language: "en", gameLanguage: "auto", showConsole: false, streamerMode: over.streamer === true, discordPresence: over.presence },
    ...over,
  } as Snapshot;
}

test("presence says what the player is doing, and hides the server in streamer mode", () => {
  assert.equal(buildActivity(snap(), null)?.details, "In the launcher");
  const playing = buildActivity(snap({ running: true }), 1000);
  assert.equal(playing?.state, "Main · 12 online");
  assert.deepEqual(playing?.timestamps, { start: 1000 });
  const hidden = buildActivity(snap({ running: true, streamer: true }), 1000);
  assert.equal(hidden?.state, undefined);
  assert.equal(buildActivity(snap({ phase: "installing" }), null)?.details, "Installing the game");
  assert.deepEqual(buildActivity(snap(), null)?.buttons, [{ label: "Join the Discord", url: "https://discord.gg/dauntlessrevived" }]);
  assert.equal(hidden?.buttons?.length, 1, "the invite stays in streamer mode");
});

test("presence is off when the player turned it off", () => {
  assert.equal(buildActivity(snap({ presence: false }), null), null);
});

test("frames round-trip, also when split across reads", () => {
  const a = encodeFrame(1, { evt: "READY" });
  const b = encodeFrame(1, { n: 2 });
  const joined = Buffer.concat([a, b]);
  const first = decodeFrames(joined.subarray(0, a.length + 5));
  assert.equal(first.frames.length, 1);
  const second = decodeFrames(Buffer.concat([first.rest, joined.subarray(a.length + 5)]));
  assert.deepEqual(second.frames[0].data, { n: 2 });
  assert.equal(decodeFrames(Buffer.from([0, 0, 0, 0, 255, 255, 255, 127])).frames.length, 0);
});

test("pipe paths follow the platform", () => {
  assert.equal(pipePaths("win32")[0], String.raw`\\?\pipe\discord-ipc-0`);
  assert.equal(pipePaths("linux", { XDG_RUNTIME_DIR: "/run/user/1000" })[3], "/run/user/1000/discord-ipc-3");
});

test("without a valid client id nothing connects", () => {
  let tried = 0;
  const p = new DiscordPresence("", () => {
    tried++;
    throw new Error("no");
  });
  p.set({ details: "x" });
  assert.equal(p.enabled, false);
  assert.equal(tried, 0);
});
