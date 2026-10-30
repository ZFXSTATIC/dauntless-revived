import {readFile, writeFile, rename, appendFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Keeps one embed in the server-status channel up to date through a webhook: players online (from the metagame),
// and hunts / CPU for each game server (from each deploy server on loopback). It shares the webhook publisher with
// the earlier worker; the live copy on MAIN is C:\DauntlessRevived\discord-status\worker.mjs, run by Run-Status.ps1.

export const FLEET=[
  {port:61001,name:'Main'},
  {port:61041,name:'North America'},
  {port:61042,name:'Canada'},
  {port:61051,name:'UK (London)'},
  {port:61061,name:'Asia (Singapore)'},
  {port:61071,name:'Oceania (Australia)'}
];
export function parseFleet(value, fallback=FLEET) {
  // STATUS_FLEET="61001=Main,61041=North America,..." replaces the built-in list
  const rows=String(value||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{const [p,...n]=s.split('=');return {port:Number(p),name:n.join('=').trim()};})
    .filter(r=>Number.isInteger(r.port)&&r.port>0&&r.port<65536&&r.name&&r.name.length<=40);
  return rows.length?rows:fallback;
}

export function webhookUrl(value) {
  const u = new URL(value.trim());
  if (u.protocol !== 'https:' || u.hostname !== 'discord.com' || u.port || u.username || u.password || u.search || u.hash || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname)) throw new Error('Invalid webhook configuration');
  return u.href;
}

// A deliberate allowlist: never forward backend names, addresses, players or errors.
export function payload(sample, now = Date.now(), fleet = null) {
  const at=Math.floor(now/1000), online=sample!==null;
  const num=(v,suffix='')=>Number.isFinite(v)&&v>=0?Math.round(v)+suffix:'Unknown';
  const rows=fleet?.rows ?? [];
  const up=rows.filter(r=>r.up);
  const running=up.reduce((n,r)=>n+r.running,0), limit=up.reduce((n,r)=>n+r.limit,0);
  const fields=[
    {name:'👥 Slayers online',value:online?String(sample.players):'Unknown',inline:true},
    {name:'🌐 Servers up',value:rows.length?`${up.length} / ${rows.length}`:'Monitoring unavailable',inline:true},
    {name:'⚔️ Active hunts',value:rows.length?`${running} / ${limit}`:'Unknown',inline:true}
  ];
  for(const r of rows){
    const state=!r.up?'🔴 Not answering':r.blocked||r.running>=r.limit?'🟠 Busy · new hunts may wait':'🟢 Room available';
    fields.push({name:r.name,inline:true,value:r.up
      ? `${state}\nHunts: ${r.running} / ${r.limit}\nPlayers in game: ${r.players}\nCPU: ${num(r.cpu,'%')}`
      : state});
  }
  if(online){
    const seconds=Math.floor(sample.uptime);
    fields.push({name:'Shared backend',value:`🟢 Online · ${Math.round(sample.ms)} ms local check\nUptime: ${Math.floor(seconds/86400)}d ${Math.floor(seconds%86400/3600)}h ${Math.floor(seconds%3600/60)}m\nStarted <t:${at-seconds}:R>`});
  } else {
    fields.push({name:'Shared backend',value:'🟠 Check unavailable · player count and uptime unknown'});
  }
  fields.push({name:'Region guide',value:'Choose Main, UK (London), US, Asia (Singapore), Oceania (Australia) or Automatic in launcher Settings > World region. The US has a second server that joins in when the first is full. Parties follow their leader across regions. Hunts are server instances, not players.'});
  fields.push({name:'📥 Launcher · Cloudflare downloads',value:'[Latest launcher / release notes](https://github.com/mixutin/dauntless-revived/releases/latest). Game downloads use Cloudflare with resume support and file verification.'});
  fields.push({name:'Last checked',value:`<t:${at}:F> (<t:${at}:R>)`});
  const allUp=rows.length>0&&up.length===rows.length;
  return {allowed_mentions:{parse:[]},embeds:[{title:'Dauntless Revived · Live realm status',
    description:online?'Shared accounts and progression across **Main, UK (London), US, Asia (Singapore) and Oceania (Australia)**.':'The shared backend check failed. Please check again shortly.',
    color:online&&allUp?0x35bc84:0xe1a349,fields,
    footer:{text:'Host health and backend activity, not player ping or proof of hunt completion. Stale readings are unknown.'}}]};
}

export async function sampleBackend(backend, key, fetcher = fetch) {
  const url = new URL(backend);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Backend must use loopback HTTP');
  const start = performance.now();
  try {
    const res = await fetcher(new URL('/undaunted/api/ServerStatus', url), {headers: {'x-undaunted-user-api-key': key}, signal: AbortSignal.timeout(8000), redirect: 'error'});
    if (!res.ok) return null;
    const data = await res.json();
    if (data.online !== true || data.limited !== false || !Number.isInteger(data.playersOnline) || data.playersOnline < 0 || !Number.isFinite(data.uptimeSeconds) || data.uptimeSeconds < 0) return null;
    return {players: data.playersOnline, uptime: data.uptimeSeconds, ms: performance.now() - start};
  } catch { return null; }
}

// One deploy server: its hunts, CPU and the players in its own games (copies of other workers' games are skipped).
export function boxRow(entry, json) {
  const c=json?.capacity;
  if(!c || !Number.isSafeInteger(c.running) || c.running<0 || !Number.isSafeInteger(c.limit) || c.limit<0) return {name:entry.name,up:false,running:0,limit:0,players:0,cpu:null,blocked:false};
  const players=(json.servers||[]).filter(s=>!s.host && !s.region).reduce((n,s)=>{
    const v=Number(s.connectedPlayers);
    return n+(Number.isFinite(v)&&v>=0?v:Array.isArray(s.expectedPlayers)?s.expectedPlayers.length:0);
  },0);
  const cpu=Number(c.cpu?.percent);
  return {name:entry.name,up:true,running:c.running,limit:c.limit,players,cpu:Number.isFinite(cpu)&&cpu>=0?cpu:null,blocked:c.cpu?.blocked===true};
}
export async function sampleFleet(entries=FLEET, fetcher=fetch) {
  const rows=[];
  for(const entry of entries){
    let json=null;
    try {
      const res=await fetcher(`http://127.0.0.1:${entry.port}/gameservers`,{signal:AbortSignal.timeout(5000),redirect:'error'});
      if(res.ok) json=await res.json();
    } catch {}
    rows.push(boxRow(entry,json));
  }
  return {rows};
}

export class Publisher {
  constructor(url, state, save, fetcher = fetch) {
    this.url = webhookUrl(url); this.state = state; this.save = save; this.fetcher = fetcher;
    this.next = 0; this.failures = 0; this.disabled = false;
    if (state.id !== undefined && !/^\d+$/.test(state.id)) throw new Error('Invalid message ID');
    // An interrupted initial POST may have reached Discord. Never blindly duplicate it.
    if (state.creating && !state.id) this.disabled = true;
  }
  async send(body, now = Date.now()) {
    if (this.disabled || now < this.next) return;
    this.next = now + 15000;
    const editing = Boolean(this.state.id);
    if (!editing) { this.state.creating = true; await this.save(this.state); }
    let res;
    try {
      res = await this.fetcher(editing ? `${this.url}/messages/${this.state.id}` : `${this.url}?wait=true`, {
        method: editing ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch {
      if (!editing) this.disabled = true;
      this.next = now + Math.min(300000, 15000 * 2 ** Math.min(++this.failures, 5));
      console.error('Discord status delivery failed; backing off. Initial delivery uncertainty requires operator review.');
      return;
    }
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retry = Math.max(Number(data.retry_after) || 0, Number(res.headers.get('retry-after')) || 0, Number(res.headers.get('x-ratelimit-reset-after')) || 0, 15);
      this.next = now + Math.ceil(retry * 1000) + 1000;
      if (!editing) { delete this.state.creating; await this.save(this.state); }
      return;
    }
    if (!res.ok) {
      if (!editing) this.disabled = true;
      this.next = now + Math.min(300000, 15000 * 2 ** Math.min(++this.failures, 5));
      await res.body?.cancel();
      console.error(`Discord status rejected with HTTP ${res.status}; retaining message ID and backing off.`);
      return;
    }
    if (!editing) {
      const data = await res.json().catch(() => ({}));
      if (!/^\d+$/.test(data.id ?? '')) { this.disabled = true; return; }
      this.state = {id: data.id}; await this.save(this.state);
    } else { await res.body?.cancel(); }
    this.failures = 0;
    this.state.lastSuccess = new Date(now).toISOString();
    await this.save(this.state);
    if (res.headers.get('x-ratelimit-remaining') === '0') this.next = Math.max(this.next, now + (Number(res.headers.get('x-ratelimit-reset-after')) || 15) * 1000 + 1000);
  }
}

let logChain = Promise.resolve();
// Optional public feed: only whether the backend answered and how many players are online go to the website relay.
export async function publishPublic(url, secret, sample, now = Date.now(), fetcher = fetch) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Public status relay must use https');
  try {
    const res = await fetcher(target, {
      method: 'PUT', headers: {'content-type': 'application/json', authorization: `Bearer ${secret}`},
      body: JSON.stringify({online: sample !== null, playersOnline: sample ? sample.players : 0, at: Math.floor(now / 1000)}),
      signal: AbortSignal.timeout(5000), redirect: 'error'
    });
    await res.body?.cancel();
    return res.ok;
  } catch { return false; }
}

async function main() {
  if (process.env.STATUS_ERROR_FILE) {
    // Only static messages from this module; never exception objects or HTTP bodies.
    console.error = message => {
      logChain = logChain.then(async () => {
        const path = process.env.STATUS_ERROR_FILE;
        if ((await stat(path).catch(() => null))?.size > 262144) await writeFile(path, '');
        await appendFile(path, `${new Date().toISOString()} ${message}\n`, {mode: 0o600});
      }).catch(() => {});
    };
  }
  const webhook = await readFile(process.env.STATUS_WEBHOOK_FILE, 'utf8');
  const stateFile = process.env.STATUS_STATE_FILE;
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = {}; }
  const save = async value => { await writeFile(`${stateFile}.tmp`, JSON.stringify(value), {mode: 0o600}); await rename(`${stateFile}.tmp`, stateFile); };
  const publisher = new Publisher(webhook, state, save);
  if (publisher.disabled) console.error('Status delivery paused: review persisted initial-message state.');
  const fleetEntries = parseFleet(process.env.STATUS_FLEET);
  let nextPublic = 0, publicFailing = false;
  while (true) {
    try {
      // The key is read every cycle so a rotated owner key never leaves the check failing until a restart.
      const key = (await readFile(process.env.STATUS_OWNER_KEY_FILE, 'utf8')).trim();
      const [sample, fleet] = await Promise.all([
        sampleBackend(process.env.STATUS_BACKEND || 'http://127.0.0.1:61000', key),
        sampleFleet(fleetEntries)
      ]);
      await publisher.send(payload(sample, Date.now(), fleet));
      if (process.env.STATUS_PUBLIC_URL && process.env.STATUS_PUBLIC_KEY_FILE && Date.now() >= nextPublic) {
        nextPublic = Date.now() + 120000;
        const secret = (await readFile(process.env.STATUS_PUBLIC_KEY_FILE, 'utf8')).trim();
        const ok = await publishPublic(process.env.STATUS_PUBLIC_URL, secret, sample);
        if (!ok && !publicFailing) console.error('Public status feed is not accepting updates.');
        publicFailing = !ok;
      }
    } catch { console.error('Status cycle failed; retrying without creating another message.'); }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Status worker stopped: check private configuration and file permissions.'); process.exitCode = 1; });
}
