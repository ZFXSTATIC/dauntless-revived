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
