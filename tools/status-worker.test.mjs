import test from 'node:test';
import assert from 'node:assert/strict';
import {boxRow, parseFleet, payload, sampleFleet, publishPublic, FLEET} from './status-worker.mjs';

const json=(running,limit,servers=[],cpu={percent:40,blocked:false})=>({servers,capacity:{running,pending:0,limit,cpu}});

test('boxRow reads hunts, CPU and the players in its own games only', () => {
  const row=boxRow({name:'Main'},json(3,12,[{connectedPlayers:4},{expectedPlayers:['a','b']},{connectedPlayers:9,host:'us'}]));
  assert.deepEqual(row,{name:'Main',up:true,running:3,limit:12,players:6,cpu:40,blocked:false});
});
test('a box with no usable capacity is shown as not answering', () => {
  assert.equal(boxRow({name:'Canada'},null).up,false);
  assert.equal(boxRow({name:'Canada'},{capacity:{running:'x'}}).up,false);
});
test('parseFleet falls back to the built-in four servers', () => {
  assert.equal(parseFleet(''),FLEET);
  assert.deepEqual(parseFleet('61001=Main, 61042=Canada'),[{port:61001,name:'Main'},{port:61042,name:'Canada'}]);
  assert.equal(FLEET.find(f=>f.port===61051).name,'UK (London)');
});
test('sampleFleet keeps going when one server does not answer', async () => {
  const fetcher=async url=>url.includes(':61041/') ? {ok:true,json:async()=>json(5,30)} : Promise.reject(new Error('down'));
  const {rows}=await sampleFleet([{port:61001,name:'Main'},{port:61041,name:'North America'}],fetcher);
  assert.deepEqual(rows.map(r=>r.up),[false,true]);
});
test('the embed names the current regions and totals the servers that answer', () => {
  const rows=[boxRow({name:'Main'},json(12,12)),boxRow({name:'North America'},json(20,30)),boxRow({name:'UK (London)'},null)];
  const body=payload({players:120,uptime:3600,ms:12},1e12,{rows});
  const e=body.embeds[0];
  assert.match(e.description,/Main, UK \(London\) and US/);
  assert.equal(e.fields.find(f=>f.name==='⚔️ Active hunts').value,'32 / 42');
  assert.equal(e.fields.find(f=>f.name==='🌐 Servers up').value,'2 / 3');
  assert.match(e.fields.find(f=>f.name==='Main').value,/Busy/);
  assert.match(e.fields.find(f=>f.name==='UK (London)').value,/Not answering/);
  assert.doesNotMatch(JSON.stringify(body),/Germany|EU/);
});
test('a failed backend check says so', () => {
  assert.match(payload(null,1e12,{rows:[]}).embeds[0].description,/check failed/);
});
test('the public feed sends only online and the player count', async () => {
  let seen;
  const ok = await publishPublic('https://relay.example/status', 'k', {players: 7, uptime: 5, ms: 3}, 5000, async (url, init) => { seen = {url: String(url), init}; return {ok: true, body: null}; });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(seen.init.body), {online: true, playersOnline: 7, at: 5});
  assert.equal(seen.init.headers.authorization, 'Bearer k');
});
test('the public feed reports a failed backend as offline and survives network errors', async () => {
  let body;
  await publishPublic('https://relay.example/status', 'k', null, 1000, async (u, init) => { body = JSON.parse(init.body); return {ok: true, body: null}; });
  assert.deepEqual(body, {online: false, playersOnline: 0, at: 1});
  assert.equal(await publishPublic('https://relay.example/status', 'k', null, 1000, async () => { throw new Error('down'); }), false);
});
test('the public feed refuses a non-https relay', async () => {
  await assert.rejects(() => publishPublic('http://relay.example/status', 'k', null), /https/);
});
