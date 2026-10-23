import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { AusUrls, DescribeAusSnapshot, RegionalRouter, WorkerHosts } from '../src/controllers/regions';
import { CapacityUnavailable } from '../src/controllers/capacity';

const dir = mkdtempSync(join(tmpdir(), 'workers-'));
const file = join(dir, 'workers.json');
const load = async () => ({running: 10, pending: 1, limit: 22});
const body = {GameMode: 'ISLAND', GameArgs: '', HuntId: 'hunt', ExpectedPlayers: ['one']};
const write = (value: unknown, newer = 0) => {
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    if (newer) utimesSync(file, new Date(), new Date(Date.now() + newer));
};
const reset = () => {
    try { unlinkSync(file); } catch {}
    process.env.WORKERS_FILE = file;
    process.env.US_DEPLOYSERVER_URL = 'http://127.0.0.1:61041';
    process.env.US_PUBLIC_HOST = 'na';
    process.env.GERMANY_DEPLOYSERVER_URL = 'http://127.0.0.1:61051';
    process.env.GERMANY_PUBLIC_HOST = 'old-germany';
};
beforeEach(reset);
after(() => {
    for (const name of ['WORKERS_FILE', 'US_DEPLOYSERVER_URL', 'US_PUBLIC_HOST', 'GERMANY_DEPLOYSERVER_URL', 'GERMANY_PUBLIC_HOST']) delete process.env[name];
    rmSync(dir, {recursive: true, force: true});
});

test('without a workers file the environment settings are used', () => {
    assert.deepEqual(AusUrls('us').map(url => url.port), ['61041']);
    assert.deepEqual(WorkerHosts('ger'), ['old-germany']);
    assert.deepEqual(AusUrls('aus'), []);
});

test('a workers file adds a worker with no restart, and changes to it are picked up', () => {
    write({us: {urls: ['http://127.0.0.1:61041', 'http://127.0.0.1:61042'], hosts: ['na', 'canada']}, ger: {urls: ['http://127.0.0.1:61051'], hosts: ['london']}});
    assert.deepEqual(AusUrls('us').map(url => url.port), ['61041', '61042']);
    assert.deepEqual(WorkerHosts('ger'), ['london']);
    write({us: {urls: ['http://127.0.0.1:61041', 'http://127.0.0.1:61042', 'http://127.0.0.1:61043'], hosts: ['na', 'canada', 'third']}}, 5000);
    assert.deepEqual(AusUrls('us').map(url => url.port), ['61041', '61042', '61043']);
    // germany is not in the file any more: the environment settings apply again
    assert.deepEqual(AusUrls('ger').map(url => url.port), ['61051']);
    assert.deepEqual(WorkerHosts('ger'), ['old-germany']);
});

test('a broken workers file keeps the last good copy', () => {
    write({us: {urls: ['http://127.0.0.1:61041', 'http://127.0.0.1:61042'], hosts: ['na', 'canada']}});
    assert.equal(AusUrls('us').length, 2);
    write('{ not json', 9000);
    assert.deepEqual(AusUrls('us').map(url => url.port), ['61041', '61042']);
});

test('a worker that is not an http loopback tunnel is refused', () => {
    write({us: {urls: ['http://10.0.0.5:61041'], hosts: ['na']}});
    assert.throws(() => AusUrls('us'), /HTTP loopback tunnel/);
});

test('US tries the next worker only after a capacity refusal, and keeps the host check', async () => {
    write({us: {urls: ['http://127.0.0.1:61041', 'http://127.0.0.1:61042'], hosts: ['na', 'canada']}});
    const calls: string[] = [];
    const router = new RegionalRouter(load, async url => { calls.push(url.port); return url.port === '61041' ? undefined : {host: 'canada', port: 8700}; });
    assert.deepEqual(await router.launch(body, 'us', async () => { throw Error('Must not reach EU'); }), {host: 'canada', port: 8700});
    assert.deepEqual(calls, ['61041', '61042']);

    const first: string[] = [];
    const roomy = new RegionalRouter(load, async url => { first.push(url.port); return {host: 'na', port: 8701}; });
    assert.deepEqual(await roomy.launch(body, 'us', async () => { throw Error('no'); }), {host: 'na', port: 8701});
    assert.deepEqual(first, ['61041']);

    await assert.rejects(new RegionalRouter(load, async () => undefined).launch(body, 'us', async () => { throw Error('no'); }), CapacityUnavailable);
    await assert.rejects(new RegionalRouter(load, async () => ({host: 'elsewhere', port: 1})).launch(body, 'us', async () => { throw Error('no'); }), /outside/);

    const timeouts: string[] = [];
    await assert.rejects(new RegionalRouter(load, async url => { timeouts.push(url.port); throw Error('timeout'); }).launch(body, 'us', async () => { throw Error('no'); }), /timeout/);
    assert.deepEqual(timeouts, ['61041'], 'an ambiguous failure is never retried on another worker');
});

test('Germany follows the host in the workers file, not the old one', async () => {
    write({ger: {urls: ['http://127.0.0.1:61051'], hosts: ['london']}});
    assert.deepEqual(await new RegionalRouter(load, async () => ({host: 'london', port: 8702})).launch(body, 'ger', async () => { throw Error('no'); }), {host: 'london', port: 8702});
    await assert.rejects(new RegionalRouter(load, async () => ({host: 'old-germany', port: 8702})).launch(body, 'ger', async () => { throw Error('no'); }), /outside/);
});

test('no workers at all refuses with a capacity error', async () => {
    delete process.env.US_DEPLOYSERVER_URL;
    await assert.rejects(new RegionalRouter(load, async () => ({host: 'na', port: 1})).launch(body, 'us', async () => { throw Error('no'); }), CapacityUnavailable);
    assert.deepEqual((await DescribeAusSnapshot('us')).servers, []);
});
