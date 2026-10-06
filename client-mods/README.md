# Client mods (UE4SS)

Optional client-side mods, installed automatically next to the game exe (`Archon/Binaries/Win64`):

- **UE4SS 3.0.1** (`dwmapi.dll`, `ue4ss/UE4SS.dll`; MIT, see `ue4ss/LICENSE`): the Lua mod loader.
- **Behemoth Health Bars**: a fixed HP and shield bar at the bottom of the screen (two bars when two behemoths are up).
- **Behemoth Tracker**: an arrow and distance to the behemoth in the top right.
- **Mod Menu**: Home opens it, Up/Down (or PgUp/PgDn) choose, End flips the chosen switch. MODS turns
  whole mods on or off (applied on Ctrl+R); SETTINGS changes the mods live (shield bar, HP numbers,
  two bars in escalations, tracker at any distance). Settings are saved in
  `ue4ss/Mods/shared/ModSettings/settings.txt` on each PC and never shipped or overwritten.
- **ZFX Status**: the ZFX logo in the top right, outlined blue while the mods run and red if one stalls.

They only change what you see on your own screen. The game works without them.

## How they get installed

- **Launcher**: on install, repair and before every launch (`UndauntedLauncher/src/main/client-mods.ts`).
- **Friend kit**: `friend-kit/setup.ps1` (skip with `-NoMods`).

Both install only files whose SHA-256 matches `manifest.json`, and check them again after copying.
`ue4ss/Mods/mods.txt` and `ue4ss/UE4SS-settings.ini` are written only when missing, so a player's own
settings are kept. Mods are Windows only: under Wine/Proton UE4SS is not loaded.

The launcher puts deleted files back before the next launch. To turn a mod off, use the Mod Menu or
set it to 0 in `ue4ss/Mods/mods.txt` (that file is kept).

## Changing a mod

Edit the files here, then rebuild the manifest and commit both:

    powershell -ExecutionPolicy Bypass -File client-mods\update-manifest.ps1

`.gitattributes` keeps every file byte-for-byte, so the hashes stay valid on every checkout.
