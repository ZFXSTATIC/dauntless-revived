import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FleetState, LaunchQueue } from '../src/controllers/launchqueue';

function Setup(initial: FleetState | undefined){
    const clock = { now: 0, fleet: initial };
    const queue = new LaunchQueue(async () => clock.fleet, () => clock.now);
    return { clock, queue };
}

test('an open fleet lets everyone straight in without a ticket', async () => {
    const { queue } = Setup({ locked: false, free: 10 });
    assert.deepEqual(await queue.poll('a'), { state: 'open' });
    assert.equal(queue.length(), 0);
});

test('an unreadable fleet never blocks a launch', async () => {
    const { queue } = Setup(undefined);
    assert.deepEqual(await queue.poll('a'), { state: 'open' });
});

test('a locked fleet queues in arrival order and admits as slots free up', async () => {
    const { clock, queue } = Setup({ locked: true, free: 0 });
    assert.deepEqual(await queue.poll('a'), { state: 'queued', position: 1, length: 1 });
    assert.deepEqual(await queue.poll('b'), { state: 'queued', position: 2, length: 2 });
    assert.deepEqual(await queue.poll('a'), { state: 'queued', position: 1, length: 2 });

    clock.fleet = { locked: false, free: 1 };
    assert.equal((await queue.poll('b')).state, 'queued');
    assert.equal((await queue.poll('a')).state, 'ready');

    // A newcomer goes behind b while the line is not empty, even though the fleet is open.
    assert.deepEqual(await queue.poll('c'), { state: 'queued', position: 2, length: 2 });
});

test('a ticket holds its slot until it expires', async () => {
    const { clock, queue } = Setup({ locked: true, free: 0 });
    await queue.poll('a'); await queue.poll('b');
    clock.fleet = { locked: false, free: 1 };
    assert.equal((await queue.poll('a')).state, 'ready');
    assert.equal((await queue.poll('b')).state, 'queued');
    for (let i = 0; i < 18; i++) { clock.now += 10000; assert.equal((await queue.poll('b')).state, i < 17 ? 'queued' : 'ready'); }
});

test('players who stop polling or leave lose their place', async () => {
    const { clock, queue } = Setup({ locked: true, free: 0 });
    await queue.poll('a'); await queue.poll('b');
    queue.leave('a');
    assert.deepEqual(await queue.poll('b'), { state: 'queued', position: 1, length: 1 });
    await queue.poll('c');
    clock.now += 15000; await queue.poll('c');
    clock.now += 15000;
    assert.deepEqual(await queue.poll('c'), { state: 'queued', position: 1, length: 1 });
});

test('the gate keeps spare hunt slots for players already online', async () => {
    const { LaunchGate } = await import('../src/controllers/launchqueue');
    const gate = new LaunchGate({ reserveMin: 2, playersPerHunt: 2, refusalMs: 60000 });
    // 10 players outside hunts need 5 spare slots: 6 free leaves one to give out.
    assert.deepEqual(gate.update({ locked: false, free: 6 }, 10, 0, 1000), { locked: false, free: 1 });
    // 4 free is below the spare: locked, nothing to give out.
    assert.deepEqual(gate.update({ locked: false, free: 4 }, 10, 0, 2000), { locked: true, free: 0 });
    // Exactly the spare is not enough to unlock again.
    assert.equal(gate.update({ locked: false, free: 5 }, 10, 0, 3000)?.locked, true);
    assert.equal(gate.update({ locked: false, free: 6 }, 10, 0, 4000)?.locked, false);
    // A quiet server still keeps the minimum spare.
    assert.deepEqual(gate.update({ locked: false, free: 3 }, 0, 0, 5000), { locked: false, free: 1 });
});

test('any "no room" answer locks new launchers at once, for the whole window', async () => {
    const { LaunchGate } = await import('../src/controllers/launchqueue');
    const gate = new LaunchGate({ reserveMin: 2, playersPerHunt: 2, refusalMs: 60000 });
    assert.equal(gate.update({ locked: false, free: 50 }, 0, 10000, 10001)?.locked, true);
    assert.equal(gate.update({ locked: false, free: 50 }, 0, 10000, 69999)?.locked, true);
    assert.equal(gate.update({ locked: false, free: 50 }, 0, 10000, 70000)?.locked, false);
});

test('the deploy server lock, an unknown slot count and an unreadable fleet', async () => {
    const { LaunchGate } = await import('../src/controllers/launchqueue');
    const gate = new LaunchGate({ reserveMin: 2, playersPerHunt: 2, refusalMs: 60000 });
    assert.equal(gate.update({ locked: true, free: 50 }, 0, 0, 1)?.locked, true);
    assert.deepEqual(gate.update({ locked: false, free: null }, 30, 0, 2), { locked: false, free: null });
    assert.equal(gate.update(undefined, 30, 0, 3), undefined);
});
