import { readFile, writeFile, appendFile } from 'node:fs/promises';

// Same keys and range as UndauntedDeployServer/src/controllers/huntlimits.ts.
export const LIMIT_KEYS = ['main', 'us', 'ger', 'sg', 'overflow'];
export const MAX_LIMIT = 64;
const NAMES = {main: 'Main (EU)', us: 'US workers', ger: 'Germany workers', sg: 'Singapore workers', overflow: 'EU overflow worker'};

export async function readLimits(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const parsed = JSON.parse(text || '{}'), limits = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return limits;
  for (const key of LIMIT_KEYS) if (Number.isSafeInteger(parsed[key]) && parsed[key] >= 1 && parsed[key] <= MAX_LIMIT) limits[key] = parsed[key];
  return limits;
}

export function describeLimits(limits) {
  return {max: MAX_LIMIT, keys: LIMIT_KEYS.map(key => ({key, name: NAMES[key], limit: limits[key] ?? null}))};
}

// value null removes the override, so that host falls back to its own setting. Returns the new limits.
export async function changeLimit(file, auditFile, key, value, note, now = new Date()) {
  if (!LIMIT_KEYS.includes(key)) throw Object.assign(new Error('Unknown limit'), {status: 400});
  if (value !== null && !(Number.isSafeInteger(value) && value >= 1 && value <= MAX_LIMIT)) throw Object.assign(new Error(`Limit must be a whole number from 1 to ${MAX_LIMIT}`), {status: 400});
  const limits = await readLimits(file), before = limits[key] ?? null;
  if (value === null) delete limits[key]; else limits[key] = value;
  await writeFile(file, JSON.stringify(limits) + '\n');
  const cleanNote = typeof note === 'string' ? note.replace(/[^\x20-\x7e]/g, ' ').slice(0, 80) : '';
  await appendFile(auditFile, JSON.stringify({at: now.toISOString(), by: 'owner dashboard', key, from: before, to: value, note: cleanNote}) + '\n');
  return limits;
}
