import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePorts, summarize, fetchStats, DEFAULT_PORTS, AlertTracker, boxInfo, isFull, statusEmbed, ALERT_AFTER_POLLS} from './gamestats.mjs';

const mk=(running,limit,blocked=false)=>boxInfo(61041,{servers:[],capacity:{running,limit,cpu:{percent:50,blocked}}});

test('parsePorts falls back to the defaults', () => {
  assert.deepEqual(parsePorts(''), DEFAULT_PORTS);
  assert.deepEqual(parsePorts('61001, 61041,abc'), [61001, 61041]);
});
test('summarize counts connected players and each server running hunts, with maximums', () => {
  const a={servers:[{kind:'city',connectedPlayers:6},{kind:'hunt',connectedPlayers:2},{kind:'hunt'}],capacity:{running:1,limit:10}};
  const b={servers:[{kind:'hunt',connectedPlayers:0}],capacity:{running:4,limit:5}};
  assert.deepEqual(summarize([a,b]), {Players:8,Hunts:5,PlayersMax:60,HuntsMax:15});
});
test('fetchStats skips boxes that do not answer and returns null when none do', async () => {
  const ok=async url=>url.includes(':61041/') ? {ok:true,json:async()=>({servers:[{kind:'hunt',connectedPlayers:3}],capacity:{running:1,limit:2}})} : Promise.reject(new Error('down'));
  assert.deepEqual(await fetchStats([61001,61041],ok), {Players:3,Hunts:1,PlayersMax:8,HuntsMax:2});
  assert.equal(await fetchStats([61001],async()=>Promise.reject(new Error('down'))), null);
});
test('alerts after a sustained full period, then recovers once', () => {
  const t=new AlertTracker(); const ev=[];
  for(let i=0;i<ALERT_AFTER_POLLS-1;i++) ev.push(...t.update([mk(30,30)]));
  assert.equal(ev.length,0);
  assert.deepEqual(t.update([mk(30,30)]).map(e=>e.type+':'+e.kind),['alert:full']);
  assert.equal(t.update([mk(30,30)]).length,0);
  assert.deepEqual(t.update([mk(5,30)]).map(e=>e.type),['recovered']);
});
test('a box that stops answering alerts after three polls', () => {
  const t=new AlertTracker(); const down=boxInfo(61042,null);
  assert.equal(t.update([down]).length+t.update([down]).length,0);
  assert.deepEqual(t.update([down]).map(e=>e.kind),['down']);
});
test('full means at the limit or held back by the CPU guard', () => {
  assert.equal(isFull(mk(30,30)),true); assert.equal(isFull(mk(10,30,true)),true); assert.equal(isFull(mk(10,30)),false);
});
test('status embed has a field per server plus a total', () => {
  assert.equal(statusEmbed([mk(1,5),boxInfo(61042,null)]).data.fields.length,3);
});
