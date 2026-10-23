import {ChannelType, EmbedBuilder, Events, PermissionFlagsBits, Routes, SlashCommandBuilder} from 'discord.js';

export const DEFAULT_PORTS=[61001,61041,61042,61051];
export const BOX_NAMES={61001:'MAIN',61041:'North America',61042:'Canada',61051:'London'};
export const DEFAULT_ALERT_CHANNELS=['1560031651747201104','1553104469774962919'];
export const ALERT_AFTER_POLLS=10, DOWN_AFTER_POLLS=3, RECOVER_AFTER_POLLS=5;
export const ALERT_COOLDOWN_MS=60*60*1000, MAX_ALERTS_PER_HOUR=6;
export const LABELS={Players:'Players',Hunts:'Hunts'};

export function parsePorts(value) {
  const ports=String(value||'').split(',').map(p=>Number(p.trim())).filter(p=>Number.isInteger(p) && p>0 && p<65536);
  return ports.length ? ports : DEFAULT_PORTS;
}
export function boxInfo(port,json) {
  const cap=json?.capacity||{};
  const players=(json?.servers||[]).reduce((n,s)=>n+(Number(s.connectedPlayers)||0),0);
  const cpu=Number(cap.cpu?.percent);
  return {port,name:BOX_NAMES[port]||`port ${port}`,up:!!json,running:Number(cap.running)||0,limit:Number(cap.limit)||0,
    players,cpu:Number.isFinite(cpu)?cpu:null,blocked:!!cap.cpu?.blocked};
}
export function summarize(boxes) {
  let players=0,hunts=0,huntLimit=0;
  for(const box of boxes) {
    for(const s of box.servers||[]) players+=Number(s.connectedPlayers)||0;
    hunts+=Number(box.capacity?.running)||0;
    huntLimit+=Number(box.capacity?.limit)||0;
  }
  return {Players:players,Hunts:hunts,PlayersMax:huntLimit*4,HuntsMax:huntLimit};
}
export async function fetchBoxes(ports,fetchImpl=fetch) {
  const out=[];
  for(const port of ports) {
    let json=null;
    try {
      const res=await fetchImpl(`http://127.0.0.1:${port}/gameservers`,{signal:AbortSignal.timeout(5000)});
      if(res.ok) json=await res.json();
    } catch {}
    out.push({port,json});
  }
  return out;
}
export async function fetchStats(ports,fetchImpl=fetch) {
  const boxes=(await fetchBoxes(ports,fetchImpl)).filter(b=>b.json).map(b=>b.json);
  return boxes.length ? summarize(boxes) : null;
}

// A box is full when it holds its hunt limit or the CPU guard is holding hunts back.
export const isFull=b=>b.up && b.limit>0 && (b.running>=b.limit || b.blocked);

export function statusEmbed(infos) {
  const full=infos.filter(isFull).length, down=infos.filter(b=>!b.up).length;
  const color=down||full===infos.length ? 0xe5484d : full ? 0xf2a33a : 0x4cc38a;
  const line=b=>!b.up ? '🔴 not answering' : `${isFull(b)?'🟠':'🟢'} ${b.running}/${b.limit} hunts, ${b.players} players`;
  const tot=infos.filter(b=>b.up).reduce((t,b)=>({r:t.r+b.running,l:t.l+b.limit,p:t.p+b.players}),{r:0,l:0,p:0});
  return new EmbedBuilder().setTitle('Dauntless Revived server status').setColor(color)
    .addFields(infos.map(b=>({name:b.name,value:line(b),inline:true})))
    .addFields({name:'Total',value:`${tot.r}/${tot.l} hunts, ${tot.p} players online`})
    .setFooter({text:'🟢 room available   🟠 busy, new hunts may wait   🔴 down'}).setTimestamp();
}
export const STATUS_COMMAND=new SlashCommandBuilder().setName('status').setDescription('Show how busy the Dauntless Revived servers are').toJSON();

// What counts as critical. Being full is normal (it means the servers are being used), so the alerts are only for:
//   down  - a deploy server stopped answering
//   hot   - a server's CPU stayed at or above HOT_CPU_PERCENT (players get rubber-banding)
//   full  - every server is full at once, so nobody can start a hunt
export const HOT_CPU_PERCENT=95;
export const FLEET_PORT=0;
export function fleetInfo(infos) {
  const up=infos.filter(b=>b.up);
  return {port:FLEET_PORT,name:'All servers',up:true,running:up.reduce((n,b)=>n+b.running,0),limit:up.reduce((n,b)=>n+b.limit,0),
    players:up.reduce((n,b)=>n+b.players,0),cpu:null,blocked:false,allFull:up.length>0 && up.every(isFull)};
}
export function badKind(b) {
  if(b.port===FLEET_PORT) return b.allFull?'full':null;
  if(!b.up) return 'down';
  return b.cpu!=null && b.cpu>=HOT_CPU_PERCENT ? 'hot' : null;
}
// Alerts are rate limited: a source alerts at most once per ALERT_COOLDOWN_MS, must look normal for
// RECOVER_AFTER_POLLS polls before it counts as recovered, and at most MAX_ALERTS_PER_HOUR messages go out in total.
export class AlertTracker {
  constructor() {this.state=new Map();this.sent=[];}
  update(infos,now=Date.now()) {
    const events=[];
    this.sent=this.sent.filter(t=>now-t<3600000);
    for(const b of [...infos,fleetInfo(infos)]) {
      const st=this.state.get(b.port)||{bad:0,ok:0,kind:null,alerted:null,lastAlert:0};
      const kind=badKind(b);
      if(kind && kind===st.kind) st.bad++; else st.bad=kind?1:0;
      st.kind=kind; st.ok=kind?0:st.ok+1;
      const need=kind==='down'?DOWN_AFTER_POLLS:ALERT_AFTER_POLLS;
      if(kind && st.alerted!==kind && st.bad>=need) {
        if(now-st.lastAlert>=ALERT_COOLDOWN_MS && this.sent.length<MAX_ALERTS_PER_HOUR) {
          events.push({type:'alert',kind,box:b});st.alerted=kind;st.lastAlert=now;this.sent.push(now);
        }
      } else if(!kind && st.alerted && st.ok>=RECOVER_AFTER_POLLS) {
        if(this.sent.length<MAX_ALERTS_PER_HOUR) {events.push({type:'recovered',kind:st.alerted,box:b});this.sent.push(now);}
        st.alerted=null;
      }
      this.state.set(b.port,st);
    }
    return events;
  }
}
export function alertEmbed(ev,infos) {
  const b=ev.box, cpu=b.cpu==null?'n/a':`${Math.round(b.cpu)}%`;
  if(ev.type==='recovered') return new EmbedBuilder().setColor(0x4cc38a).setTitle(`✅ ${b.name} is back to normal`)
    .setDescription(`${b.running}/${b.limit} hunts${b.cpu==null?'':`, CPU ${cpu}`}`).setTimestamp();
  const text=ev.kind==='down' ? 'The deploy server is not answering.'
    : ev.kind==='hot' ? `CPU has been at ${cpu} for ${ALERT_AFTER_POLLS}+ minutes (${b.running}/${b.limit} hunts). Players may see rubber-banding.`
    : `Every server has been full for ${ALERT_AFTER_POLLS}+ minutes (${b.running}/${b.limit} hunts), so new hunts are queueing.`;
  const others=infos.filter(x=>x.port!==b.port).map(x=>`${x.name}: ${!x.up?'down':x.running+'/'+x.limit}`).join(', ');
  const title=ev.kind==='down'?`${b.name} is down`:ev.kind==='hot'?`${b.name} is overloaded`:'All servers are full';
  return new EmbedBuilder().setColor(0xe5484d).setTitle(`🚨 ${title}`)
    .setDescription(ev.kind==='full'?text:`${text}\nOther servers: ${others}`).setTimestamp();
}

export class GameStats {
  constructor(client,counters,ports) {Object.assign(this,{client,counters,ports});this.tracker=new AlertTracker();}
  async infos() {return (await fetchBoxes(this.ports)).map(b=>boxInfo(b.port,b.json));}
  async registerStatus() {
    const route=Routes.applicationCommands(this.client.application.id);
    const old=(await this.client.rest.get(route)).find(c=>c.name==='status' && c.type===1);
    if(!old) await this.client.rest.post(route,{body:STATUS_COMMAND});
  }
  async poll() {
    const infos=await this.infos();
    const ids=(process.env.GAME_STATS_ALERT_CHANNELS||'').split(',').map(x=>x.trim()).filter(Boolean);
    for(const ev of this.tracker.update(infos)) for(const id of ids.length?ids:DEFAULT_ALERT_CHANNELS) {
      try {const ch=await this.client.channels.fetch(id); await ch.send({embeds:[alertEmbed(ev,infos)]});}
      catch(e) {console.error(`Could not post alert to ${id}: ${e.message}`);}
    }
  }
  async refresh(guild) {
    const cfg=this.counters.state.guilds[guild.id]; if(!cfg) {console.log(`game stats: guild ${guild.id} has no counter category`);return;}
    const stats=await fetchStats(this.ports); if(!stats) {console.log('game stats: no deploy server answered');return;}
    const categoryId=process.env.GAME_STATS_CATEGORY_ID || cfg.categoryId;
    const category=await guild.channels.fetch(categoryId);
    await this.counters.validate(guild,category);
    const channels=await guild.channels.fetch();
    cfg.stats ??= {};
    for(const key of Object.keys(LABELS)) {
      const name=`${LABELS[key]} : ${stats[key]}/${stats[key+'Max']}`;
      let channel=cfg.stats[key] ? channels.get(cfg.stats[key]) : undefined;
      if(!channel) channel=[...channels.values()].find(c=>c?.parentId===category.id && c.type===ChannelType.GuildVoice && c.name.startsWith(`${LABELS[key]} : `));
      if(!channel) channel=await guild.channels.create({name,type:ChannelType.GuildVoice,parent:category.id,permissionOverwrites:[
        {id:guild.id,deny:[PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]},
        {id:this.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]}
      ]});
      if(cfg.stats[key]!==channel.id) {cfg.stats[key]=channel.id;await this.counters.save(this.counters.state);}
      if(channel.name!==name) await channel.setName(name);
    }
    console.log(`game stats updated: ${JSON.stringify(stats)}`);
  }
  start(intervalMs=360000) {
    const run=()=>{for(const guild of this.client.guilds.cache.values())
      this.counters.serialize(()=>this.refresh(guild)).catch(e=>console.error(`Game stats refresh failed: ${e.message}`));};
    setTimeout(run,5000).unref();
    setInterval(run,intervalMs).unref();
    this.registerStatus().catch(e=>console.error(`Could not register /status: ${e.message}`));
    this.client.on(Events.InteractionCreate,async interaction=>{
      if(!interaction.isChatInputCommand() || interaction.commandName!=='status') return;
      try {await interaction.reply({embeds:[statusEmbed(await this.infos())]});}
      catch(e) {console.error(`/status failed: ${e.message}`);}
    });
    setInterval(()=>this.poll().catch(e=>console.error(`Alert poll failed: ${e.message}`)),60000).unref();
  }
}
