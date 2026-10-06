// UE4SS and the client mods (health bars, tracker, mod menu, ZFX status) from the repository's
// client-mods/ folder, shipped as the launcher resource "client-mods" (forge.config.ts extraResource).
// Installed next to the game exe on install, repair and before every launch, the same way as the
// pinned DLLs: every file must match client-mods/manifest.json before it is copied and after.
// Files marked "keep" (mods.txt, UE4SS-settings.ini) are only written when missing, so a player's
// own choices (mods switched off in the in-game menu) survive. Failures never block the game:
// the caller logs them and launches anyway.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { hashFile } from "./verify";
import { unblock, win64Dir } from "./dlls";

export interface ClientModFile {
  path: string;
  sha256: string;
  size: number;
  keep: boolean;
}

export interface ClientModsManifest {
  version: number;
  target: string;
  files: ClientModFile[];
}

export interface ClientModsResult {
  installed: number;
  kept: number;
  upToDate: number;
}

export class ClientModsError extends Error {
  constructor(public readonly file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "ClientModsError";
  }
}

export const CLIENT_MODS_RESOURCE = "client-mods";

// Only plain relative paths inside the bundle: no drive letters, no "..", no absolute paths.
function safeRelative(rel: string): string {
  const parts = rel.split("/");
  if (rel.length === 0 || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new ClientModsError(rel, "unsafe path in manifest.json");
  }
  return path.join(...parts);
}

export async function readClientModsManifest(resourcesDir: string): Promise<ClientModsManifest | null> {
  const file = path.join(resourcesDir, CLIENT_MODS_RESOURCE, "manifest.json");
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch {
    return null; // launcher built without client mods
  }
  const m = JSON.parse(text) as ClientModsManifest;
  if (m.version !== 1 || !Array.isArray(m.files)) throw new ClientModsError("manifest.json", "unknown format");
  return m;
}

export async function installClientMods(resourcesDir: string, installDir: string): Promise<ClientModsResult | null> {
  const manifest = await readClientModsManifest(resourcesDir);
  if (!manifest) return null;
  const srcRoot = path.join(resourcesDir, CLIENT_MODS_RESOURCE);
  const dstRoot = win64Dir(installDir);
  const result: ClientModsResult = { installed: 0, kept: 0, upToDate: 0 };

  for (const f of manifest.files) {
    const rel = safeRelative(f.path);
    const want = f.sha256.toLowerCase();
    const target = path.join(dstRoot, rel);

    let present = false;
    try {
      await fsp.access(target);
      present = true;
    } catch {
      /* missing: copy it */
    }
    if (present && f.keep) {
      result.kept++;
      continue;
    }
    if (present) {
      try {
        if ((await hashFile(target)) === want) {
          result.upToDate++;
          continue;
        }
      } catch {
        /* unreadable: replace it */
      }
    }

    const source = path.join(srcRoot, rel);
    let sourceHash: string;
    try {
      sourceHash = await hashFile(source);
    } catch {
      throw new ClientModsError(f.path, "missing from the launcher's resources");
    }
    if (sourceHash !== want) throw new ClientModsError(f.path, "the launcher's copy does not match manifest.json");

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.new`;
    await fsp.copyFile(source, tmp);
    if ((await hashFile(tmp)) !== want) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw new ClientModsError(f.path, "changed while copying (antivirus?)");
    }
    try {
      await fsp.rename(tmp, target);
    } catch (e) {
      await fsp.unlink(tmp).catch(() => undefined); // the target is in use (the game is running)
      throw e;
    }
    await unblock(target);
    result.installed++;
  }
  return result;
}
