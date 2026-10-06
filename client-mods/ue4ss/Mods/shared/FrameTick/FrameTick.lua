-- FrameTick: run callbacks every N seconds on the GAME THREAD, driven by a per-frame hook,
-- instead of LoopAsync.
--
-- Why: Ctrl+R (hot reload) hung several times while stopping the mods that had fast
-- LoopAsync loops (the health bar pointer every 60 ms). LoopAsync runs on
-- its own thread, which UE4SS must stop on reload; hooks are simply unregistered (the log
-- shows that working cleanly), so hook-driven ticks avoid that.
--
-- Driver: the HUD compass widget's Tick, called every frame while the HUD is up (hunts and
-- town). Verified in UE4SS_ObjectDump.txt:
--   /Game/UI/HUD/Compass/Widgets/bpw_Compass.bpw_Compass_C:Tick (MyGeometry, InDeltaTime)
--   /Script/Engine.PlayerController:ClientRestart  (fires when the player pawn spawns)
--   /Script/Engine.GameplayStatics:GetRealTimeSeconds
-- If the compass class isn't loaded yet when a mod starts, the hook is retried on every
-- ClientRestart. No HUD (loading screens) = no ticks, which is fine: nothing to do then.
--
-- Usage (each mod has its own copy of this module):
--   local FrameTick = require("FrameTick")
--   FrameTick.Every(0.25, "main", function() ... end)
--   FrameTick.Start(log)

local M = {}

local TICK_FN = "/Game/UI/HUD/Compass/Widgets/bpw_Compass.bpw_Compass_C:Tick"
local RESTART_FN = "/Script/Engine.PlayerController:ClientRestart"

local tickers = {}
local hooked = false
local restartHooked = false
local lastT = nil
local GS = nil
local logf = print
local errOnce = {}

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

-- Real time in seconds (same clock for every tick), or nil.
function M.Now(ctx)
    if not valid(GS) then GS = StaticFindObject("/Script/Engine.Default__GameplayStatics") end
    local ok, t = pcall(function() return GS:GetRealTimeSeconds(ctx) end)
    if ok and type(t) == "number" then return t end
    return nil
end

local function OnFrame(self)
    local ctx = nil
    pcall(function() ctx = self:get() end)
    local t = M.Now(ctx)
    if not t then return end
    if t == lastT then return end      -- several compass widgets tick the same frame
    -- The engine's real-time clock restarts at 0 in every new world (map change, raid start).
    -- Without this, every ticker waited until the new clock passed its old "last run" time, so
    -- the mods stalled after a map change until Ctrl+R. Clock went backwards -> run everything now.
    if lastT and t < lastT - 0.5 then
        for _, tk in ipairs(tickers) do tk.last = -1e9 end
        logf(string.format("FrameTick: new map (clock %.1f -> %.1f), timers reset", lastT, t))
    end
    lastT = t
    for _, tk in ipairs(tickers) do
        if t - tk.last >= tk.interval then
            tk.last = t
            local ok, err = pcall(tk.fn, t)
            if not ok and not errOnce[tk.name] then
                errOnce[tk.name] = true
                logf("FrameTick '" .. tk.name .. "' error: " .. tostring(err))
            end
        end
    end
end

local function TryHook()
    if hooked then return true end
    if not valid(StaticFindObject(TICK_FN)) then return false end
    local ok, err = pcall(function()
        RegisterHook(TICK_FN, function(self) OnFrame(self) end)
    end)
    if ok then
        hooked = true
        logf("FrameTick: driven by the HUD compass Tick")
    else
        logf("FrameTick: hook failed: " .. tostring(err))
    end
    return hooked
end

-- Run fn about every `interval` seconds (0 = every frame). fn(nowSeconds).
function M.Every(interval, name, fn)
    tickers[#tickers + 1] = {interval = interval, name = name, fn = fn, last = -1e9}
end

-- Heartbeat: Start(log, "ModName") makes this mod write the current real time (seconds) to
-- shared\FrameTick\hb_<ModName>.txt every HEARTBEAT_SEC. The ZFXStatus mod reads these to show
-- blue (all mods alive) or red (a mod stopped updating = stalled / crashed).
local HEARTBEAT_SEC = 2
local function HeartbeatDir()
    local src = debug.getinfo(1, "S").source or ""
    src = src:gsub("^@", ""):gsub("/", "\\")
    return src:match("^(.*\\)[^\\]+$") or ""
end
M.HEARTBEAT_DIR = HeartbeatDir()

function M.Start(logFunction, modName)
    if logFunction then logf = logFunction end
    if modName then
        local file = M.HEARTBEAT_DIR .. "hb_" .. modName .. ".txt"
        M.Every(HEARTBEAT_SEC, "heartbeat", function(t)
            local f = io.open(file, "w")
            if f then f:write(string.format("%.3f", t)) f:close() end
        end)
    end
    if not TryHook() then
        logf("FrameTick: compass not loaded yet - will hook when the player spawns")
    end
    if not restartHooked then
        local ok, err = pcall(function()
            RegisterHook(RESTART_FN, function() pcall(TryHook) end)
        end)
        restartHooked = ok
        if not ok then logf("FrameTick: ClientRestart hook failed: " .. tostring(err)) end
    end
end

function M.IsRunning() return hooked end

return M
