// The launch queue module on its own (src/main/launch-queue.ts), against a plain HTTP host.
// Port: 62460.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { LaunchQueueClient, type QueuePlace } from "../src/main/launch-queue";

const PORT = 62460;
const KEY = `UUK_${"a".repeat(48)}`;
const ep = { host: "127.0.0.1", port: PORT, pin: null };

let answers: unknown[] = [];
const calls: { leave: boolean; key: boolean }[] = [];
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const leave = body.includes('"leave":true');
      calls.push({ leave, key: req.headers["x-undaunted-user-api-key"] === KEY });
      const answer = leave ? { state: "open" } : answers.shift();
      res.writeHead(answer === undefined ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("switched off, it never asks the host", async () => {
  calls.length = 0;
  answers = [{ state: "queued", position: 1, length: 1 }];
  const queue = new LaunchQueueClient({ enabled: false });
  assert.equal(queue.enabled, false);
  assert.equal(await queue.wait(ep, KEY), true);
  assert.equal(calls.length, 0);
});

test("waits while queued, reports each place, and goes when the host lets it", async () => {
  calls.length = 0;
  answers = [{ state: "queued", position: 3, length: 5 }, { state: "queued", position: 1, length: 4 }, { state: "ready", expiresInSeconds: 180 }];
  const seen: (QueuePlace | null)[] = [];
  const queue = new LaunchQueueClient({ pollMs: 10, onChange: (place) => seen.push(place) });
  assert.equal(await queue.wait(ep, KEY), true);
  assert.deepEqual(seen, [{ position: 3, length: 5 }, { position: 1, length: 4 }, null]);
  assert.equal(queue.place, null);
  assert.ok(calls.every((c) => c.key), "the key goes along on the private-mode host");
});

test("an older host without the queue lets the game start", async () => {
  answers = [];
  assert.equal(await new LaunchQueueClient({ pollMs: 10 }).wait(ep, KEY), true);
});

test("leaving stops the wait and frees the place on the host", async () => {
  calls.length = 0;
  answers = Array.from({ length: 50 }, () => ({ state: "queued", position: 2, length: 2 }));
  const queue = new LaunchQueueClient({ pollMs: 10 });
  const waiting = queue.wait(ep, KEY);
  for (let i = 0; i < 50 && !queue.place; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(queue.place, { position: 2, length: 2 });
  queue.leave();
  assert.equal(await waiting, false);
  assert.equal(calls.at(-1)?.leave, true);
  assert.equal(queue.place, null);
});
