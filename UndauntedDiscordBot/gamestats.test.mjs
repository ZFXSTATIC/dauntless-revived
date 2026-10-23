import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveLimit, isLocal, serverPlayers, fetchLoggedIn, parsePorts, summarize, fetchStats, DEFAULT_PORTS, boxInfo, isFull, statusEmbed} from './gamestats.mjs';

const mk=(running,limit,blocked=false)=>boxInfo(61041,{servers:[],capacity:{running,limit,cpu:{percent:50,blocked}}});

test('parsePorts falls back to the defaults', () => {
  assert.deepEqual(parsePorts(''), DEFAULT_PORTS);
  assert.deepEqual(parsePorts('61001, 61041,abc'), [61001, 61041]);
});
test('summarize counts connected players and each server running hunts, with maximums', () => {
  const a={servers:[{kind:'city',connectedPlayers:6},{kind:'hunt',connectedPlayers:2},{kind:'hunt'}],capacity:{running:1,limit:10}};
  const b={servers:[{kind:'hunt',connectedPlayers:0}],capacity:{running:4,limit:5}};
  assert.deepEqual(summarize([a,b]), {Players:8,Hunts:5,HuntsMax:15});
});
test('fetchStats skips boxes that do not answer and returns null when none do', async () => {
  const ok=async url=>url.includes(':61041/') ? {ok:true,json:async()=>({servers:[{kind:'hunt',connectedPlayers:3}],capacity:{running:1,limit:2}})} : Promise.reject(new Error('down'));
  assert.deepEqual(await fetchStats([61001,61041],ok), {Players:3,Hunts:1,HuntsMax:2});
  assert.equal(await fetchStats([61001],async()=>Promise.reject(new Error('down'))), null);
});
test('full means at the limit or held back by the CPU guard', () => {
  assert.equal(isFull(mk(30,30)),true); assert.equal(isFull(mk(10,30,true)),true); assert.equal(isFull(mk(10,30)),false);
});
test('status embed has a field per server plus a total', () => {
  assert.equal(statusEmbed([mk(1,5),boxInfo(61042,null)]).data.fields.length,3);
});

test('a worker that does not report connected players falls back to the expected players', () => {
  assert.equal(serverPlayers({connectedPlayers:3,expectedPlayers:['a','b']}),3);
  assert.equal(serverPlayers({expectedPlayers:['a','b']}),2);
  assert.equal(serverPlayers({}),0);
});
test('logged-in count comes from the metagame ServerStatus and is null when limited or unreachable', async () => {
  const env={METAGAME_ADMIN_KEY:'k'};
  const ok=async(url,o)=>{assert.equal(o.headers['x-undaunted-user-api-key'],'k');return {ok:true,json:async()=>({playersOnline:118})};};
  assert.equal(await fetchLoggedIn(env,ok),118);
  assert.equal(await fetchLoggedIn(env,async()=>({ok:true,json:async()=>({playersOnline:0,limited:true})})),null);
  assert.equal(await fetchLoggedIn(env,async()=>Promise.reject(new Error('down'))),null);
  assert.equal(await fetchLoggedIn({},ok),null);
});

test('servers that carry a host or region are the remote workers copies and are not counted twice', () => {
  const j={servers:[{connectedPlayers:4},{connectedPlayers:9,host:'us',region:'us'}],capacity:{running:1,limit:12}};
  assert.equal(boxInfo(61001,j).players,4);
  assert.equal(isLocal({host:'ger'}),false);
});
test('the real hunt maximum is lowered when the CPU guard would stop the box first', () => {
  assert.equal(effectiveLimit(7,16,55,80),10);
  assert.equal(effectiveLimit(30,30,60,70),30);
  assert.equal(effectiveLimit(12,12,90,80),12);
  assert.equal(effectiveLimit(0,16,5,80),16);
});
