import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParseLimits, ReadLimits, LimitOverride, ResetLimitsCache, SetUrlKeyResolver } from '../src/controllers/huntlimits';
import { HuntLimit } from '../src/controllers/capacity';
import { RemoteLaunch } from '../src/controllers/overflow';

function withFile(text: string | null, run: (file: string) => Promise<void> | void) {
    const dir = mkdtempSync(join(tmpdir(), 'huntlimits-')), file = join(dir, 'hunt-limits.json');
    if (text !== null) writeFileSync(file, text);
    process.env.HUNT_LIMITS_FILE = file; ResetLimitsCache();
    return Promise.resolve(run(file)).finally(() => { delete process.env.HUNT_LIMITS_FILE; ResetLimitsCache(); rmSync(dir, {recursive: true, force: true}); });
}

test('only whole numbers from 1 to 64 for known keys count as limits', () => {
    assert.deepEqual(ParseLimits('{"main":16,"sg":10,"us":0,"ger":65,"overflow":"8","other":5}'), {main: 16, sg: 10});
    assert.deepEqual(ParseLimits('[1,2]'), {});
    assert.throws(() => ParseLimits('{'));
});
test('a missing file means no override and a half-written file keeps the last good limits', () => withFile(null, file => {
    assert.equal(LimitOverride('main'), null);
    writeFileSync(file, '{"main":7}'); ResetLimitsCache();
    assert.equal(ReadLimits(10000).main, 7);
    writeFileSync(file, '{"main":'); // being written
    assert.equal(ReadLimits(20000).main, 7);
}));
test('the primary limit follows the file, workers keep their own setting', () => withFile('{"main":4}', () => {
    process.env.MAX_LOCAL_HUNTS = '9'; process.env.MAX_HUNTS = '12';
    try {
        assert.equal(HuntLimit(), 4);
        process.env.HUNT_WORKER = '1'; assert.equal(HuntLimit(), 12);
    } finally { delete process.env.HUNT_WORKER; delete process.env.MAX_LOCAL_HUNTS; delete process.env.MAX_HUNTS; }
}));
test('a worker at its owner limit gets no new hunt and nothing running is touched', () => withFile('{"sg":3}', async () => {
    SetUrlKeyResolver(() => 'sg');
    const real = globalThis.fetch; const calls: string[] = [];
    const answer = (running: number) => (async (input: any, init?: any) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
        if (init?.method === 'POST') return new Response(JSON.stringify({host: '5.6.7.8', port: 7777}), {headers: {'content-type': 'application/json'}});
        return new Response(JSON.stringify({servers: [], capacity: {running, pending: 0, limit: 16}}), {headers: {'content-type': 'application/json'}});
    }) as typeof fetch;
    const body = {GameMode: 'ISLAND', GameArgs: '', HuntId: 'h', ExpectedPlayers: undefined};
    try {
        globalThis.fetch = answer(3);
        assert.equal(await RemoteLaunch(new URL('http://127.0.0.1:61041'), body), undefined);
        assert.deepEqual(calls, ['GET /gameservers']);
        globalThis.fetch = answer(2);
        assert.deepEqual(await RemoteLaunch(new URL('http://127.0.0.1:61042'), body), {host: '5.6.7.8', port: 7777});
    } finally { globalThis.fetch = real; SetUrlKeyResolver(() => undefined); }
}));
