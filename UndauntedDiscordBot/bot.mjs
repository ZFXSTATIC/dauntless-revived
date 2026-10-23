import { Client, Events, GatewayIntentBits, MessageFlags, REST } from 'discord.js';
import { resolve, dirname, join } from 'node:path';
import {createCounters, syncCounterCommand} from './counter.mjs';
import {acquireInstance} from './instance.mjs';
import {GameStats, parsePorts} from './gamestats.mjs';
import { backend, Keys, loadState, saveState } from './keys.mjs';
import { loadInviteConfig, inviteMessage } from './invite.mjs';
import { syncKeyCommands } from './commands.mjs';
import { keyInstructions } from './link-input.mjs';

const token = process.env.DISCORD_BOT_TOKEN;
const adminKey = process.env.METAGAME_ADMIN_KEY;
if (!token || !adminKey) throw new Error('Configure DISCORD_BOT_TOKEN and METAGAME_ADMIN_KEY');
const stateFile = resolve(process.env.KEY_STATE_FILE || './data/keys.json');
await acquireInstance(stateFile);
const inviteConfig = await loadInviteConfig(process.env.SERVER_CONFIG_FILE);
const keys = new Keys(await loadState(stateFile), state => saveState(stateFile, state), backend(process.env.METAGAME_URL || 'http://127.0.0.1:61000', adminKey));
await keys.migrateLinks();

const rest = new REST({version: '10'}).setToken(token);
const appInfo = await rest.get('/oauth2/applications/@me');
const memberIntentEnabled = !!(appInfo.flags & ((1 << 14) | (1 << 15)));
const client = new Client({intents: [GatewayIntentBits.Guilds, ...(memberIntentEnabled ? [GatewayIntentBits.GuildMembers] : [])]});
const counters=await createCounters(client,process.env.COUNTER_STATE_FILE || join(dirname(stateFile),'counters.json'));
if (!memberIntentEnabled) {
  console.error('Counter unavailable: enable Server Members Intent in Discord Developer Portal. Key commands remain online.');
  setInterval(async()=>{
    try {const app=await rest.get('/oauth2/applications/@me');if(app.flags & ((1<<14)|(1<<15))) {await client.destroy();process.exit(0);}}
    catch {console.error('Could not recheck Server Members Intent');}
  },60000).unref();
}

client.once(Events.ClientReady, async () => {
  try {
    const guilds = process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : [...client.guilds.cache.keys()];
    const changed = await syncKeyCommands(rest, client.application.id, guilds);
    await syncCounterCommand(rest,client.application.id);
    if(memberIntentEnabled) await counters.start();
    new GameStats(client,counters,parsePorts(process.env.GAME_STATS_PORTS)).start();
    console.log(`Key command registration: ${changed} scopes updated`);
    console.log('Revived key bot ready');
  } catch { console.error('Could not register /key'); await client.destroy(); process.exitCode = 1; }
});
const active = new Set();
client.on(Events.GuildMemberAdd,member=>counters.schedule(member.guild));
client.on(Events.GuildMemberRemove,member=>counters.schedule(member.guild));
setInterval(()=>{if(memberIntentEnabled) for(const guild of client.guilds.cache.values()) counters.schedule(guild);},300000).unref();
const cooldown = new Map();
setInterval(() => { const now = Date.now(); for (const [id, until] of cooldown) if (until <= now) cooldown.delete(id); }, 60000).unref();
client.on(Events.InteractionCreate, async interaction => {
  if(interaction.isChatInputCommand() && interaction.commandName==='counter') {
    if(!memberIntentEnabled) {await interaction.reply({content:'Enable Server Members Intent for this bot in Discord Developer Portal. The bot will reconnect automatically within a minute.',flags:MessageFlags.Ephemeral});return;}
    await counters.configure(interaction).catch(()=>console.error('Counter interaction failed')); return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'key') return;
  const id = interaction.user.id;
  try {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    if (process.env.DISCORD_GUILD_ID && interaction.guildId && interaction.guildId !== process.env.DISCORD_GUILD_ID) {
      await interaction.editReply('Use this command in the Revived server or in a DM with me.'); return;
    }
    if (active.has(id) || Date.now() < (cooldown.get(id) || 0)) {
      await interaction.editReply('Your key request is being handled. Try again in a few seconds.'); return;
    }
    active.add(id); cooldown.set(id, Date.now() + 10000);
    try {
      const subcommand = interaction.options.getSubcommand();
      const claim = subcommand === 'claim';
      const result = subcommand === 'link'
        ? await keys.link(id, interaction.options.getString('key', true).trim())
        : claim ? await keys.deliverPrivate(id, code => interaction.editReply({content: inviteMessage(inviteConfig, code), allowedMentions: {parse: []}}))
        : await keys.run(id, false);
      if (result.status === 'private_sent') return;
      {
        const messages = {
          sent: '🔑 **Invite Sent**\nCheck your DMs. Paste the complete invite into the launcher’s Join box.\n**Clear skies, Slayer.**',
          already_sent: '🔑 **Already Claimed**\nYour invite has already been sent. Check your previous DMs; no additional key will be issued.',
          dm_disabled: 'Enable direct messages, then run `/key claim` again. Your existing code is saved.',
          no_mutual_guild: 'Join the Revived Discord server first, enable direct messages from server members, then run `/key claim` again. Discord cannot DM you without a shared server. Your existing invite is saved.',
          delivery_uncertain: 'Discord did not confirm delivery. Check your DMs, then contact the server team if missing. No replacement key will be issued.',
          linked: '🔑 **Key Accepted**\nYour Discord has been linked to your existing Revived account. Keep using the same launcher key—nothing to replace.\n**Clear skies, Slayer.**',
          invite_not_key: `🔑 **Use Your Saved Account Key**\nThat is a Join invite or registration code. It cannot identify your existing account.\n\n${keyInstructions}\n\nIf you have not registered yet, paste the complete invite into the launcher’s Join screen first.`,
          invalid_key_format: `🔑 **Copy Your Saved Account Key**\n${keyInstructions}`,
          invalid_key: `🔑 **Account Key Not Recognized**\nThis server did not recognize that account key.\n\n${keyInstructions}\n\nIf the saved key still fails, contact the server team with your launcher username and this message, not your key.`,
          discord_already_linked: 'Your Discord is already linked to another account. Contact the server team to change it.',
          account_already_linked: 'This account is already linked to another Discord. Contact the server team to change it.',
          ready: '🔑 **Key Ready**\nYour code has not been redeemed. Run `/key claim` to view your existing invite privately.',
          redeemed: '🔑 **Key Accepted**\nYour Revived code has been redeemed successfully.\n**Clear skies, Slayer.**',
          none: '🔑 **No Key Yet**\nRun `/key claim` to receive an invite in a message only you can see.',
          pending: 'Your code is being prepared. Try `/key claim` again shortly.',
          revoked: 'Your code is unavailable. Contact the server team.',
        };
        await interaction.editReply(messages[result.status]);
      }
    } finally { active.delete(id); }
  } catch (error) {
    console.error(JSON.stringify({event:'key_interaction_failed',at:new Date().toISOString(),discordId:id,code:Number.isInteger(error.code)?error.code:undefined})); // No tokens/codes/payloads.
    if (interaction.deferred) await interaction.editReply('The key service is unavailable. Please try again shortly.').catch(() => {});
  }
});
client.on(Events.Error, () => console.error('Discord connection error'));
process.on('SIGINT', () => client.destroy());
process.on('SIGTERM', () => client.destroy());
await client.login(token).catch(() => { console.error('Discord login failed'); process.exitCode = 1; });
