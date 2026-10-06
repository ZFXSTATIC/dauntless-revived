print("[ZFX] ZFXStatus loading...")
local FrameTick = require("FrameTick")

-- ZFX logo in the top-right corner as a mod status light:
--   BLUE outline = every enabled mod is alive
--   RED  outline = an enabled mod stopped updating (stalled / script error / not loaded)
-- Each mod writes a heartbeat via Mods\shared\FrameTick (Start(log, "ModName") ->
-- hb_<ModName>.txt with the engine's real time every 2 s); this mod compares them to now.
--
-- Logo: zfx_logo.png next to this folder's Scripts (white letters, transparent background),
-- loaded at runtime with /Script/Engine.KismetRenderingLibrary:ImportFileAsTexture2D
-- (verified in the object dump). Outline = 8 tinted copies shifted around the white logo.
-- Widgets: StackableProgressBar_C's BoostIconBarImage (bar hidden), tagged RenderOpacity 0.995.

-- ---------------------------------------------------------------- settings

local WATCH = {"BehemothHealthBars", "BehemothTracker", "ModMenu"}
local STALE_SEC = 6            -- heartbeat older than this = stalled
local STARTUP_GRACE = 8        -- after loading, missing heartbeats are not counted yet
local CHECK_SEC = 1

local LOGO_W, LOGO_H = 120, 77 -- px (logo PNG is 458x295)
local ANCHOR = {X = 1.0, Y = 0.0}
local POS_X, POS_Y = -95, 66   -- px from the top-right corner (centre of the logo),
                               -- in the gap between the session id and the quest panel
local OUTLINE = 1.5            -- thin blue/red status outline
local BLACK_OUTLINE = 5        -- thicker black outline behind it
local BLACK = {R = 0, G = 0, B = 0, A = 1}
local BLUE = {R = 0.25, G = 0.60, B = 1.00, A = 1}
local RED = {R = 1.00, G = 0.12, B = 0.10, A = 1}
local WHITE = {R = 1, G = 1, B = 1, A = 1}
local TAG = 0.995

local IMG_PATH = "/Game/UI/EndOfHunt/StackableProgressBar.StackableProgressBar_C"
local VIS_SHOWN = 3

-- ---------------------------------------------------------------- state

local ui = nil         -- {outline = {img...}, logo = img, widgets = {...}}
local status = nil     -- "ok" | "stalled"
local startT = nil
local logoTex = nil
local errLogged = {}

local function log(m) print("[ZFX] " .. tostring(m)) end
local function logOnce(k, m) if not errLogged[k] then errLogged[k] = true log(m) end end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

local function ScriptDir()
    local src = debug.getinfo(1, "S").source or ""
    src = src:gsub("^@", ""):gsub("/", "\\")
    return src:match("^(.*\\)[^\\]+$") or ""
end
local MOD_DIR = ScriptDir():gsub("[Ss]cripts\\$", "")          -- ...\Mods\ZFXStatus\
local MODS_DIR = MOD_DIR:gsub("[^\\]+\\$", "")                   -- ...\Mods\
local LOGO_FILE = MOD_DIR .. "zfx_logo.png"

local function GetPC()
    local list = FindAllOf("ArchonPlayerController")
    local PC = list and list[1]
    if valid(PC) then return PC end
    return nil
end

-- ---------------------------------------------------------------- widgets

local function MakeImage(PC, Lib, cls, z)
    local w = Lib:Create(PC, cls, PC)
    if not valid(w) then return nil end
    local okI, img = pcall(function() return w.BoostIconBarImage end)
    if not (okI and valid(img)) then return nil end
    local okB, bar = pcall(function() return w.ProgressBarComponent end)
    w:AddToViewport(z)
    if okB and valid(bar) then pcall(function() bar:GetParent():SetVisibility(1) end) end
    local okS, slot = pcall(function() return img.Slot end)
    if okS and valid(slot) then
        pcall(function() slot:SetAnchors({Minimum = {X = 0, Y = 0}, Maximum = {X = 0, Y = 0}}) end)
        pcall(function() slot:SetAlignment({X = 0, Y = 0}) end)
        pcall(function() slot:SetAutoSize(false) end)
        pcall(function() slot:SetPosition({X = 0, Y = 0}) end)
        pcall(function() slot:SetSize({X = LOGO_W, Y = LOGO_H}) end)
    end
    pcall(function() img:SetVisibility(VIS_SHOWN) end)
    pcall(function() img:SetBrushResourceObject(logoTex) end)
    pcall(function() img:SetBrushSize({X = LOGO_W, Y = LOGO_H}) end)
    pcall(function()
        w:SetPositionInViewport({X = POS_X, Y = POS_Y}, true)
        w:SetDesiredSizeInViewport({X = LOGO_W, Y = LOGO_H})
        w:SetAnchorsInViewport({Minimum = {X = ANCHOR.X, Y = ANCHOR.Y}, Maximum = {X = ANCHOR.X, Y = ANCHOR.Y}})
        w:SetAlignmentInViewport({X = 0.5, Y = 0.5})
    end)
    pcall(function() w:SetRenderOpacity(TAG) end)
    return w, img
end

local function Destroy()
    if ui then
        for _, w in ipairs(ui.widgets) do
            if valid(w) then pcall(function() w:RemoveFromViewport() end) end
        end
    end
    ui = nil
end

local function SetColor(col)
    if not ui then return end
    for _, img in ipairs(ui.outline) do
        if valid(img) then pcall(function() img:SetColorAndOpacity(col) end) end
    end
end

local function Create()
    Destroy()
    local PC = GetPC()
    if not PC then return end
    if not valid(logoTex) then
        local K = StaticFindObject("/Script/Engine.Default__KismetRenderingLibrary")
        local ok, t = pcall(function() return K:ImportFileAsTexture2D(PC, LOGO_FILE) end)
        if ok and valid(t) then
            logoTex = t
            log("logo loaded: " .. LOGO_FILE)
        else
            logOnce("logo", "could not load logo " .. LOGO_FILE .. ": " .. tostring(t))
            return
        end
    end
    local cls = StaticFindObject(IMG_PATH)
    local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    if not (valid(cls) and valid(Lib)) then logOnce("cls", "widget classes not found") return end

    local u = {outline = {}, widgets = {}}
    -- 8 copies shifted around the centre by d, tinted col, at z; returns the images
    local function ring(d, z, col, list)
        local offs = {{-d, 0}, {d, 0}, {0, -d}, {0, d}, {-d, -d}, {d, -d}, {-d, d}, {d, d}}
        for _, o in ipairs(offs) do
            local w, img = MakeImage(PC, Lib, cls, z)
            if w then
                pcall(function() img:SetRenderTranslation({X = o[1], Y = o[2]}) end)
                if col then pcall(function() img:SetColorAndOpacity(col) end) end
                if list then list[#list + 1] = img end
                u.widgets[#u.widgets + 1] = w
            end
        end
    end
    ring(BLACK_OUTLINE, 1004, BLACK, nil)   -- outer black outline
    ring(OUTLINE, 1005, nil, u.outline)     -- thin blue/red status outline (tinted by SetColor)
    -- white logo on top
    local w, img = MakeImage(PC, Lib, cls, 1006)
    if w then
        pcall(function() img:SetColorAndOpacity(WHITE) end)
        u.logo = img
        u.widgets[#u.widgets + 1] = w
    end
    ui = u
    SetColor(status == "stalled" and RED or BLUE)
    log("logo ready (top-right)")
end

-- ---------------------------------------------------------------- status

local function EnabledMods()
    local on = {}
    local f = io.open(MODS_DIR .. "mods.txt", "r")
    if not f then return on end
    for line in f:lines() do
        local name, val = line:match("^%s*(.-)%s*:%s*([01])%s*$")
        if name and val == "1" then on[name] = true end
    end
    f:close()
    return on
end

local function ReadBeat(name)
    local f = io.open(FrameTick.HEARTBEAT_DIR .. "hb_" .. name .. ".txt", "r")
    if not f then return nil end
    local v = tonumber(f:read("*a"))
    f:close()
    return v
end

local lastNow = nil
local function Check(now)
    -- the engine's real-time clock restarts with each world (map change): restart the grace
    if not startT or (lastNow and now < lastNow - 1) then startT = now end
    lastNow = now
    local on = EnabledMods()
    local bad = {}
    for _, name in ipairs(WATCH) do
        if on[name] then
            local t = ReadBeat(name)
            if t == nil or t > now + 1 then     -- missing, or from an earlier game session
                if now - startT > STARTUP_GRACE then bad[#bad + 1] = name .. " (no heartbeat)" end
            elseif now - t > STALE_SEC then
                bad[#bad + 1] = string.format("%s (%.0fs silent)", name, now - t)
            end
        end
    end
    local new = (#bad == 0) and "ok" or "stalled"
    if new ~= status then
        status = new
        if new == "ok" then log("status: all mods running (blue)")
        else log("status: STALLED (red): " .. table.concat(bad, ", ")) end
        SetColor(new == "ok" and BLUE or RED)
    end
end

local function Tick(now)
    if not (ui and valid(ui.widgets[1])) then Create() end
    Check(now)
end

-- remove our widgets left over from a previous load (Ctrl+R)
local function RemoveOld()
    local list = FindAllOf("StackableProgressBar_C")
    if not list then return end
    for _, w in ipairs(list) do
        local okV, inVp = pcall(function() return w:IsInViewport() end)
        local okO, op = pcall(function() return w.RenderOpacity end)
        if okV and inVp and okO and op and math.abs(op - TAG) < 0.0004 then
            pcall(function() w:RemoveFromViewport() end)
        end
    end
end
pcall(function() ExecuteInGameThread(function() pcall(RemoveOld) end) end)

FrameTick.Every(CHECK_SEC, "status", function(now)
    local ok, err = pcall(Tick, now)
    if not ok then logOnce("tick", "ERROR: " .. tostring(err)) end
end)
FrameTick.Start(log)

-- Show the logo the moment the player spawns after a load, instead of waiting for the HUD
-- compass to start ticking. (Nothing can draw DURING the loading screen: the game's loading
-- screen module draws on its own layer above the viewport, and map changes clear all widgets.)
pcall(function()
    RegisterHook("/Script/Engine.PlayerController:ClientRestart", function()
        local ok, err = pcall(function()
            if not (ui and valid(ui.widgets[1])) then Create() end
        end)
        if not ok then logOnce("restart", "ERROR on spawn: " .. tostring(err)) end
    end)
end)

log("ZFXStatus loaded (logo: " .. LOGO_FILE .. ")")
