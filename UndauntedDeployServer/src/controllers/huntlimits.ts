import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// hunt-limits.json: {"main": 16, "us": 10, "ger": 16, "sg": 10, "overflow": 8}
// Each key is a number of hunts. The owner dashboard edits this file, so a limit changes without a restart.
// It only gates NEW hunts: running ones are never touched. A missing key, a missing file or invalid JSON
// means "no override", and the MAX_HUNTS / MAX_LOCAL_HUNTS setting of that host applies as before.
// A worker still enforces its own MAX_HUNTS as a ceiling, so the file can lower a worker's share at any time but
// can only raise it up to that ceiling.
export const LIMIT_KEYS = ['main', 'us', 'ger', 'sg', 'overflow'] as const;
export type LimitKey = typeof LIMIT_KEYS[number];
export const MAX_LIMIT = 64;
const CACHE_MS = 3000;

let cache: {checkedAt: number, mtimeMs: number, limits: Partial<Record<LimitKey, number>>} = {checkedAt: 0, mtimeMs: -1, limits: {}};

export function HuntLimitsFile() {
    return process.env.HUNT_LIMITS_FILE || resolve(process.cwd(), '..', '..', 'data', 'config', 'hunt-limits.json');
}

export function ParseLimits(text: string): Partial<Record<LimitKey, number>> {
    const limits: Partial<Record<LimitKey, number>> = {};
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return limits;
    for (const key of LIMIT_KEYS) {
        const value = parsed[key];
        if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_LIMIT) limits[key] = value;
    }
    return limits;
}

export function ReadLimits(now = Date.now()): Partial<Record<LimitKey, number>> {
    if (now - cache.checkedAt < CACHE_MS) return cache.limits;
    cache.checkedAt = now;
    try {
        const file = HuntLimitsFile();
        const mtimeMs = statSync(file).mtimeMs;
        if (mtimeMs !== cache.mtimeMs) cache = {checkedAt: now, mtimeMs, limits: ParseLimits(readFileSync(file, 'utf8'))};
    } catch (error) {
        // No file: no override. Unreadable or half-written file: keep the last good copy.
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') cache = {checkedAt: now, mtimeMs: -1, limits: {}};
    }
    return cache.limits;
}

export function LimitOverride(key: LimitKey): number | null {
    return ReadLimits()[key] ?? null;
}

export function ResetLimitsCache() {
    cache = {checkedAt: 0, mtimeMs: -1, limits: {}};
}

// regions.ts registers how a worker tunnel URL maps to a key, so this file does not import it (it would be a cycle).
let keyForUrl: (url: URL) => LimitKey | undefined = () => undefined;
export function SetUrlKeyResolver(resolver: (url: URL) => LimitKey | undefined) { keyForUrl = resolver; }
export function LimitKeyForUrl(url: URL) { return keyForUrl(url); }
