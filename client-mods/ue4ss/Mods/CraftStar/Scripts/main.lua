print("[CST] CraftStar loading...")

-- CraftStar: puts ">> " in front of the name of every weapon you have never crafted, in the
-- crafting list. Local only - nothing is sent to the server.
--
-- What we learned (UE4SS.log + screenshots):
--   * Plain edits to the row widgets (tint, text, font, added borders) are never redrawn.
--   * Calling the row's own blueprint event OnUpdatedViewModel DOES make the game redraw it,
--     but run outside the game's normal flow it fills both name lines with internal ids
--     ("McRollin_normal"). So: read the real texts, fire the refresh, write them straight back
--     with the marker - in the same frame, so the redraw picks up our texts.
--   * EquipmentItemViewModel.ItemName holds the behemoth name, not the weapon name: leave it.
-- rows = FindAllOf("WeaponCraftingListRowWidget"), row.WeaponWidget.EquipmentItem;
-- never crafted = no InventoryItem and no InstanceID; BP_PlayerCharacter_C:ReceiveTick keeps
-- running in the crafting screen. Never FindAllOf("TextBlock"/"Image") there: it crashed.

local MARK = ">> "
-- Name colour, chosen in the Mod Menu (SETTINGS, "cst_color": 1 red, 2 gold, 3 purple).
local ModSettings = require("ModSettings")
local COLORS = {
    {R = 1.00, G = 0.25, B = 0.25, A = 1},   -- red
    {R = 1.00, G = 0.78, B = 0.20, A = 1},   -- gold
    {R = 0.72, G = 0.42, B = 1.00, A = 1},   -- purple
}
local function ColorIndex()
    local n = ModSettings.GetNum("cst_color", 2)
    if COLORS[n] then return n end
    return 2
end
local STEP = 0.25
local TICK_FN = "/Game/Blueprints/BP_PlayerCharacter.BP_PlayerCharacter_C:ReceiveTick"

local function log(m) print("[CST] " .. tostring(m)) end
local logged = {}
local function logOnce(k, m) if not logged[k] then logged[k] = true log(m) end end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

local function Str(v)
    if v == nil then return "" end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and type(s) == "string" then return s end
    return ""
end

local function IsUncrafted(item)
    if not valid(item) then return false end
    local okW, isWeapon = pcall(function() return item:IsWeapon() end)
    if okW and isWeapon == false then return false end
    local okE, equipped = pcall(function() return item:IsEquipped() end)
    if okE and equipped then return false end
    local okI, inv = pcall(function() return item.InventoryItem end)
    if okI and valid(inv) then return false end
    local okG, got = pcall(function() return inv:Get() end)
    if okG and valid(got) then return false end
    local okS, inst = pcall(function() return Str(item.InstanceID) end)
    if okS and inst ~= "" then return false end
    return true
end

-- The row's two name text blocks, found by walking its own widget tree (no global searches).
local function FindTexts(row)
    local found = {}
    local function walk(w, depth)
        if depth > 12 or not valid(w) or (found.WeaponName and found.BehemothName) then return end
        local okN, n = pcall(function() return w:GetFName():ToString() end)
        if okN and (n == "WeaponName" or n == "BehemothName") then found[n] = w end
        local okC, cnt = pcall(function() return w:GetChildrenCount() end)
        if okC and type(cnt) == "number" then
            for i = 0, cnt - 1 do
                local okK, ch = pcall(function() return w:GetChildAt(i) end)
                if okK then walk(ch, depth + 1) end
            end
        end
        local okT, content = pcall(function() return w:GetContent() end)
        if okT and valid(content) then walk(content, depth + 1) end
    end
    local okR, root = pcall(function() return row.WidgetTree.RootWidget end)
    if okR then walk(root, 0) end
    return found.WeaponName, found.BehemothName
end

local function SetText(tb, s)
    return pcall(function() tb:SetText(FText(s)) end)
end

local function Key(o)
    local ok, n = pcall(function() return o:GetFullName() end)
    return ok and n or ""
end

local original = {}   -- weapon-name text block -> its colour before we changed it
local applied = {}    -- weapon-name text block -> colour index we gave it
local function SetColor(tb, c)
    pcall(function() tb:SetColorAndOpacity({SpecifiedColor = c, ColorUseRule = 0}) end)
end

-- A reused row now shows an owned weapon but still has our colour: redraw it with the old one.
local function Restore(row, iw)
    local wn, bn = FindTexts(row)
    if not (valid(wn) and valid(bn)) then return end
    local c = original[Key(wn)]
    if not c then return end
    local weapon, behemoth = Str(wn:GetText()), Str(bn:GetText())
    pcall(function() row:OnUpdatedViewModel() end)
    pcall(function() iw:OnUpdatedViewModel() end)
    SetText(bn, behemoth)
    SetText(wn, weapon)
    SetColor(wn, c)
    original[Key(wn)] = nil
    applied[Key(wn)] = nil
end

local function Mark(row, iw)
    local wn, bn = FindTexts(row)
    if not (valid(wn) and valid(bn)) then logOnce("texts", "name text blocks not found") return false end
    local weapon = Str(wn:GetText())
    local idx = ColorIndex()
    if weapon:sub(1, #MARK) == MARK then
        if applied[Key(wn)] == idx then return false end   -- already marked in this colour
        -- colour changed in the Mod Menu: redraw with the new one
        local behemoth = Str(bn:GetText())
        pcall(function() row:OnUpdatedViewModel() end)
        pcall(function() iw:OnUpdatedViewModel() end)
        SetText(bn, behemoth)
        SetText(wn, weapon)
        SetColor(wn, COLORS[idx])
        applied[Key(wn)] = idx
        return true
    end
    local okD, disp = pcall(function() return row:GetDisplayName():ToString() end)
    if okD and disp and disp ~= "" then weapon = disp end
    local behemoth = Str(bn:GetText())
    if weapon == "" or weapon:find("_normal", 1, true) then return false end

    -- the game's own refresh makes it redraw the row; then put the right texts back
    pcall(function() row:OnUpdatedViewModel() end)
    pcall(function() iw:OnUpdatedViewModel() end)
    SetText(bn, behemoth)
    SetText(wn, MARK .. weapon)
    local k = Key(wn)
    if not original[k] then
        local okC, col = pcall(function()
            local x = wn.ColorAndOpacity.SpecifiedColor
            return {R = x.R, G = x.G, B = x.B, A = x.A}
        end)
        original[k] = okC and col or {R = 1, G = 1, B = 1, A = 1}
    end
    SetColor(wn, COLORS[idx])
    applied[k] = idx
    logOnce("first", string.format("marked %q (behemoth %q), now shows %q / %q",
        weapon, behemoth, Str(wn:GetText()), Str(bn:GetText())))
    return true
end

local function Update()
    local rows = FindAllOf("WeaponCraftingListRowWidget")
    if not rows then return end
    local n = 0
    for _, row in ipairs(rows) do
        local okW, iw = pcall(function() return row.WeaponWidget end)
        local okM, item = pcall(function() return okW and valid(iw) and iw.EquipmentItem end)
        if okM and IsUncrafted(item) then
            if Mark(row, iw) then n = n + 1 end
        elseif okM and valid(item) then
            Restore(row, iw)
        end
    end
    if n > 0 then log("marked " .. n .. " uncrafted weapon name(s)") end
end

local lastT = 0
local pulses = 0
local function Pulse()
    local t = os.clock()
    if t - lastT < STEP then return end
    lastT = t
    pulses = pulses + 1
    if pulses % 4 == 1 then pcall(ModSettings.Load) end   -- pick up Mod Menu changes (~1 s)
    local ok, err = pcall(Update)
    if not ok then logOnce("upd", "Update error: " .. tostring(err)) end
end

-- On a fresh game start the player character's blueprint isn't loaded yet when mods start,
-- so the hook is retried every time the player pawn spawns (ClientRestart, a native function
-- that always exists) until it sticks.
local tickHooked = false
local function TryHookTick()
    if tickHooked then return end
    if not valid(StaticFindObject(TICK_FN)) then return end
    tickHooked = pcall(function() RegisterHook(TICK_FN, function() Pulse() end) end)
    log((tickHooked and "tick hooked: " or "could not hook ") .. TICK_FN)
end

TryHookTick()
if not tickHooked then
    log("player character not loaded yet - hooking when it spawns")
    pcall(function()
        RegisterHook("/Script/Engine.PlayerController:ClientRestart", function()
            ExecuteWithDelay(500, function()
                ExecuteInGameThread(function() pcall(TryHookTick) end)
            end)
        end)
    end)
end

log("CraftStar loaded")
