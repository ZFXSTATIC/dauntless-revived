import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePorts, summarize, fetchStats, DEFAULT_PORTS} from './gamestats.mjs';

test('parsePorts falls back to the defaults', () => {
  assert.deepEqual(parsePorts(''), DEFAULT_PORTS);
  assert.deepEqual(parsePorts('61001, 61041,abc'), [61001, 61041]);
});
test('summarize counts connected players on every server and hunts only', () => {
  const a={servers:[{kind:'city',connectedPlayers:6},{kind:'hunt',connectedPlayers:2},{kind:'hunt'}],capacity:{running:1}};
  const b={servers:[{kind:'hunt',connectedPlayers:0}],capacity:{running:4}};
  assert.deepEqual(summarize([a,b]), {Players:8,Hunts:5});
});
test('fetchStats skips boxes that do not answer and returns null when none do', async () => {
  const ok=async url=>url.includes(':61041/') ? {ok:true,json:async()=>({servers:[{kind:'hunt',connectedPlayers:3}],capacity:{running:1}})} : Promise.reject(new Error('down'));
  assert.deepEqual(await fetchStats([61001,61041],ok), {Players:3,Hunts:1});
  assert.equal(await fetchStats([61001],async()=>Promise.reject(new Error('down'))), null);
});
