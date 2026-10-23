import {ChannelType, PermissionFlagsBits} from 'discord.js';

export const DEFAULT_PORTS=[61001,61041,61042,61051];
export function parsePorts(value) {
  const ports=String(value||'').split(',').map(p=>Number(p.trim())).filter(p=>Number.isInteger(p) && p>0 && p<65536);
  return ports.length ? ports : DEFAULT_PORTS;
}
export function summarize(lists) {
  let players=0,hunts=0;
  for(const servers of lists) for(const s of servers) {
    players+=Number(s.connectedPlayers)||0;
    if(s.kind==='hunt') hunts++;
  }
  return {Players:players,Hunts:hunts};
}
export async function fetchStats(ports,fetchImpl=fetch) {
  const lists=[];
  for(const port of ports) {
    try {
      const res=await fetchImpl(`http://127.0.0.1:${port}/gameservers`,{signal:AbortSignal.timeout(5000)});
      if(res.ok) lists.push((await res.json()).servers||[]);
    } catch {}
  }
  return lists.length ? summarize(lists) : null;
}
export const LABELS={Players:'Players Online',Hunts:'Hunts Running'};

export class GameStats {
  constructor(client,counters,ports) {Object.assign(this,{client,counters,ports});}
  async refresh(guild) {
    const cfg=this.counters.state.guilds[guild.id]; if(!cfg) return;
    const stats=await fetchStats(this.ports); if(!stats) return;
    const category=await guild.channels.fetch(cfg.categoryId);
    await this.counters.validate(guild,category);
    const channels=await guild.channels.fetch();
    cfg.stats ??= {};
    for(const key of Object.keys(LABELS)) {
      const name=`${LABELS[key]} : ${stats[key]}`;
      let channel=cfg.stats[key] ? channels.get(cfg.stats[key]) : undefined;
      if(!channel) channel=[...channels.values()].find(c=>c?.parentId===category.id && c.type===ChannelType.GuildVoice && c.name.startsWith(`${LABELS[key]} : `));
      if(!channel) channel=await guild.channels.create({name,type:ChannelType.GuildVoice,parent:category.id,permissionOverwrites:[
        {id:guild.id,deny:[PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]},
        {id:this.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]}
      ]});
      if(cfg.stats[key]!==channel.id) {cfg.stats[key]=channel.id;await this.counters.save(this.counters.state);}
      if(channel.name!==name) await channel.setName(name);
    }
  }
  start(intervalMs=360000) {
    const run=()=>{for(const guild of this.client.guilds.cache.values())
      this.counters.serialize(()=>this.refresh(guild)).catch(()=>console.error('Game stats refresh failed; will retry'));};
    setTimeout(run,5000).unref();
    setInterval(run,intervalMs).unref();
  }
}
