print("[TRK] BehemothTracker loading...")
local FrameTick = require("FrameTick")
-- Live settings from the Mod Menu (shared\ModSettings): trk_always = show at any distance.
local ModSettings = require("ModSettings")

-- Behemoth tracker: a ring with the behemoth's sigil, a red arrow orbiting it toward the
-- behemoth (relative to the camera) and the distance underneath. Shown while the behemoth is
-- MIN_M or further away. Local only - nothing is sent to the server or the party.
--
-- Verified in UE4SS_ObjectDump.txt:
--   images: StackableProgressBar_C.BoostIconBarImage (bar part hidden) - Image:SetBrushResourceObject,
--           SetBrushSize, SetColorAndOpacity, Widget:SetRenderTranslation/SetRenderTransformAngle
--   text  : w_chat_log_label_bpw_C.ChatLogLabelTextBlock, font from HealthStamina_bpw.HealthValueText
--   ring  : ui_thin_white_ring (fallback WhiteRing / EmptyCircle)
--   arrow : menu_hud_danger_tri, tinted pure red (it is yellow-ish), black copy behind = border
--   sigil : BehemothMarkerComponent.BehemothIcon fed into behemoth_hud_info_bpw's BehemothIcon material
--   angle : Controller:GetControlRotation, Actor:K2_GetActorLocation
--   pixels: SetPositionInViewport(..., true) = screen pixels (UI scale ~0.7 on the user's screen)
-- Every widget is tagged with RenderOpacity TAG so reloads remove only this mod's widgets.
-- No LoopAsync (it made Ctrl+R hang): ticks come from Mods\shared\FrameTick.

-- ---------------------------------------------------------------- settings

local SCALE = 1.69
local MIN_M = 50                                   -- show at this distance or further
local ANCHOR = {X = 1.0, Y = 0.0}                  -- top-right corner of the screen
local POS_X, POS_Y = -131, 465                     -- px from that corner (under the danger meter)
local RING_R = math.floor(22 * SCALE + 0.5)        -- ring radius
local RING_THICK = 2
local PLATE = RING_R * 2                           -- circle diameter
local ICON = math.floor(26 * SCALE + 0.5)          -- sigil size
local ARROW = math.floor(13 * SCALE * 0.9 + 0.5)   -- arrow size
local ARROW_BORDER = math.floor(3 * SCALE * 0.9 + 0.5)
local ORBIT = math.floor(RING_R + ARROW / 2 + 3 * SCALE + 0.5)   -- arrow orbit radius
local TEXT_SIZE = math.floor(9 * SCALE + 0.5)
local TEXT_OUTLINE = 2
local ARROW_ANGLE_OFFSET = 0
local BRIGHT_LAYERS = 2                            -- copies stacked for brightness
local RING_COLOR = {R = 1, G = 1, B = 1, A = 1}
local ARROW_COLOR = {R = 1.0, G = 0.0, B = 0.0, A = 1.0}
local TEXT_COLOR = {R = 1, G = 1, B = 1, A = 1}
local TICK_SEC = 0.06
local TAG = 0.996                                  -- RenderOpacity tag of this mod's widgets

local IMG_PATH = "/Game/UI/EndOfHunt/StackableProgressBar.StackableProgressBar_C"
local IMG_ASSET = "/Game/UI/EndOfHunt/StackableProgressBar"
local TEXT_PATH = "/Game/UI/Chat/w_chat_log_label_bpw.w_chat_log_label_bpw_C"
local TEXT_ASSET = "/Game/UI/Chat/w_chat_log_label_bpw"
local FONT_SRC = "/Game/UI/HUD/HealthStamina_bpw.HealthStamina_bpw_C:WidgetTree.HealthValueText"
local ICON_TEMPLATE = "/Game/UI/HUD/Behemoth/behemoth_hud_info_bpw.behemoth_hud_info_bpw_C:WidgetTree.BehemothIcon"
local ARROW_MARKER_CDO = "/Game/UI/Adventure/behemoth_marker.Default__behemoth_marker_C"
local RING_TEXTURES = {
    "/Game/UI/Textures/Icons/skyfishing/ui_thin_white_ring.ui_thin_white_ring",
    "/Game/UI/Materials/WhiteRing.WhiteRing",
    "/Game/UI/Textures/Icons/Menu/EmptyCircle.EmptyCircle",
}
local ARROW_TEXTURES = {
    "/Game/UI/Textures/HUD/Meters/menu_hud_danger_tri.menu_hud_danger_tri",
    "/Game/UI/Textures/Menus/ui_arrow_triangle_up.ui_arrow_triangle_up",
}

local VIS_SHOWN, VIS_HIDDEN = 3, 1                 -- HitTestInvisible / Collapsed

-- ---------------------------------------------------------------- state

local ptr = nil
local creating = false
local lastHealth, targetKey, targetObj = {}, nil, nil
local markerCompCache = {}
local errLogged = {}
local createWait = 0

local function log(m) print("[TRK] " .. tostring(m)) end
local function logOnce(k, m) if not errLogged[k] then errLogged[k] = true log(m) end end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

local function PathOf(fullName)
    return fullName and fullName:match("^%S+%s+(.+)$")
end

local function GetPC()
    local list = FindAllOf("ArchonPlayerController")
    local PC = list and list[1]
    if valid(PC) then return PC end
    return nil
end

local function FindOrLoad(path)
    local o = StaticFindObject(path)
    if valid(o) then return o end
    pcall(function() LoadAsset((path:gsub("%.[^./]+$", ""))) end)
    o = StaticFindObject(path)
    if valid(o) then return o end
    return nil
end

-- ---------------------------------------------------------------- brushes / widgets

local function ReadBrush(b)
    local r = {}
    pcall(function() r.res = b.ResourceObject end)
    pcall(function() r.drawAs = b.DrawAs end)
    pcall(function() r.tiling = b.Tiling end)
    pcall(function() r.mirroring = b.Mirroring end)
    pcall(function() r.imageType = b.ImageType end)
    pcall(function() local s = b.ImageSize r.size = {X = s.X, Y = s.Y} end)
    pcall(function()
        local m = b.Margin
        r.margin = {Left = m.Left, Top = m.Top, Right = m.Right, Bottom = m.Bottom}
    end)
    pcall(function()
        local c = b.TintColor.SpecifiedColor
        r.tint = {R = c.R, G = c.G, B = c.B, A = c.A}
    end)
    return r
end

local function WriteBrush(dst, src)
    if src.res ~= nil then pcall(function() dst.ResourceObject = src.res end) end
    if src.drawAs ~= nil then pcall(function() dst.DrawAs = src.drawAs end) end
    if src.tiling ~= nil then pcall(function() dst.Tiling = src.tiling end) end
    if src.mirroring ~= nil then pcall(function() dst.Mirroring = src.mirroring end) end
    if src.imageType ~= nil then pcall(function() dst.ImageType = src.imageType end) end
    if src.size then pcall(function() dst.ImageSize = {X = src.size.X, Y = src.size.Y} end) end
    if src.margin then pcall(function() dst.Margin = src.margin end) end
    if src.tint then pcall(function() dst.TintColor.SpecifiedColor = src.tint end) end
end

local function PinSlot(slot, z, x, y, w, h)
    pcall(function() slot:SetAnchors({Minimum = {X = 0, Y = 0}, Maximum = {X = 0, Y = 0}}) end)
    pcall(function() slot:SetAlignment({X = 0, Y = 0}) end)
    pcall(function() slot:SetAutoSize(false) end)
    pcall(function() slot:SetPosition({X = x, Y = y}) end)
    pcall(function() slot:SetSize({X = w, Y = h}) end)
    pcall(function() slot:SetZOrder(z) end)
end

-- Reads an Image template's brush + colour so a copy looks exactly like the game's.
local function TemplateLook(path)
    local t = StaticFindObject(path)
    if not valid(t) then log("template not found: " .. path) return nil end
    local look = {brush = ReadBrush(t.Brush)}
    pcall(function()
        local c = t.ColorAndOpacity
        look.color = {R = c.R, G = c.G, B = c.B, A = c.A}
    end)
    if look.color and look.color.A < 0.2 then look.color.A = 1 end
    return look
end

-- One image on screen: StackableProgressBar_C with its bar hidden, BoostIconBarImage shown.
local function MakeImage(PC, Lib, cls, size, z, look)
    local w = Lib:Create(PC, cls, PC)
    if not valid(w) then return nil end
    local okI, img = pcall(function() return w.BoostIconBarImage end)
    if not (okI and valid(img)) then return nil end
    if look and look.brush then WriteBrush(img.Brush, look.brush) end
    local okB, bar = pcall(function() return w.ProgressBarComponent end)
    w:AddToViewport(z)
    if okB and valid(bar) then pcall(function() bar:GetParent():SetVisibility(VIS_HIDDEN) end) end
    local okS, slot = pcall(function() return img.Slot end)
    if okS and valid(slot) then PinSlot(slot, 10, 0, 0, size, size) end
    pcall(function() img:SetVisibility(VIS_SHOWN) end)
    pcall(function() img:SetBrushSize({X = size, Y = size}) end)
    local col = (look and look.color) or {R = 1, G = 1, B = 1, A = 1}
    pcall(function() img:SetColorAndOpacity(col) end)
    pcall(function() w:SetRenderOpacity(TAG) end)
    return w, img
end

-- Text in the player's HP font with a solid black outline. Font written before AddToViewport.
local function MakeText(PC, Lib, size, z)
    local cls = FindOrLoad(TEXT_PATH)
    if not cls then log("text class not found") return nil end
    local l = Lib:Create(PC, cls, PC)
    if not valid(l) then return nil end
    local okT, tb = pcall(function() return l.ChatLogLabelTextBlock end)
    if not (okT and valid(tb)) then return nil end
    local src = StaticFindObject(FONT_SRC)
    if valid(src) then
        pcall(function() tb.Font.FontObject = src.Font.FontObject end)
        pcall(function() tb.Font.TypefaceFontName = src.Font.TypefaceFontName end)
        pcall(function() local o = src.ShadowOffset tb.ShadowOffset = {X = o.X, Y = o.Y} end)
        pcall(function()
            local c = src.ShadowColorAndOpacity
            tb.ShadowColorAndOpacity = {R = c.R, G = c.G, B = c.B, A = c.A}
        end)
    end
    pcall(function() tb.Font.Size = size end)
    pcall(function()
        tb.Font.OutlineSettings.OutlineSize = TEXT_OUTLINE
        tb.Font.OutlineSettings.OutlineColor = {R = 0, G = 0, B = 0, A = 1}
    end)
    l:AddToViewport(z)
    pcall(function() tb:SetJustification(1) end)  -- centred
    pcall(function() tb:SetColorAndOpacity({SpecifiedColor = TEXT_COLOR, ColorUseRule = 0}) end)
    pcall(function() l:SetRenderOpacity(TAG) end)
    return l, tb
end

-- ---------------------------------------------------------------- tracker widgets

local function AllWidgets()
    local out = {}
    if ptr then
        for _, part in ipairs(ptr.parts) do out[#out + 1] = part.w end
        out[#out + 1] = ptr.label
    end
    return out
end

local function Place()
    if not ptr then return end
    local scale = 1
    pcall(function()
        local L = StaticFindObject("/Script/UMG.Default__WidgetLayoutLibrary")
        local v = L:GetViewportScale(GetPC())
        if type(v) == "number" and v > 0 then scale = v end
    end)
    local function put(w, sx, sy, alignY, y)
        if not valid(w) then return end
        pcall(function()
            -- position first, anchors after (SetPositionInViewport resets anchors)
            w:SetPositionInViewport({X = POS_X, Y = y or POS_Y}, true)
            w:SetDesiredSizeInViewport({X = sx, Y = sy})
            w:SetAnchorsInViewport({Minimum = {X = ANCHOR.X, Y = ANCHOR.Y}, Maximum = {X = ANCHOR.X, Y = ANCHOR.Y}})
            w:SetAlignmentInViewport({X = 0.5, Y = alignY})
        end)
    end
    for _, part in ipairs(ptr.parts) do put(part.w, part.size, part.size, 0.5) end
    local lineH = math.floor(TEXT_SIZE * 1.35 + 0.5)
    put(ptr.label, PLATE + 60, lineH, 0.0, POS_Y + math.floor((ORBIT + ARROW / 2 + 2) * scale + 0.5))
end

local function SetShown(s)
    if not ptr or ptr.shown == s then return end
    local vis = s and VIS_SHOWN or VIS_HIDDEN
    for _, w in ipairs(AllWidgets()) do
        if valid(w) and not (w == ptr.iconW and ptr.noIcon) then
            pcall(function() w:SetVisibility(vis) end)
        end
    end
    ptr.shown = s
end

local function Destroy()
    for _, w in ipairs(AllWidgets()) do
        if valid(w) then pcall(function() w:RemoveFromViewport() end) end
    end
    ptr = nil
end

local function Create()
    if creating then return end
    creating = true
    Destroy()
    local ok, err = pcall(function()
        local PC = GetPC()
        if not PC then return end
        local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
        local cls = FindOrLoad(IMG_PATH)
        if not (valid(Lib) and cls) then log("widget classes not found") return end

        local p = {parts = {}}
        local function add(size, z, look)
            local w, img = MakeImage(PC, Lib, cls, size, z, look)
            if w then p.parts[#p.parts + 1] = {w = w, img = img, size = size} end
            return w, img
        end
        local function texOf(list)
            for _, path in ipairs(list) do
                local t = FindOrLoad(path)
                if t then return t, path:match("%.([%w_]+)$") end
            end
            return nil
        end

        -- ring: stacked copies of a smooth ring texture
        local ringTex, ringSrc = texOf(RING_TEXTURES)
        if ringTex then
            local size = PLATE + RING_THICK
            for _ = 1, BRIGHT_LAYERS do
                local _, img = add(size, 1001, nil)
                if img then
                    pcall(function() img:SetBrushResourceObject(ringTex) end)
                    pcall(function() img:SetBrushSize({X = size, Y = size}) end)
                    pcall(function() img:SetColorAndOpacity(RING_COLOR) end)
                end
            end
            log("ring texture: " .. ringSrc)
        else
            log("no ring texture found")
        end

        -- sigil inside the ring, through the game's behemoth-icon material
        local iconLook = TemplateLook(ICON_TEMPLATE)
        if iconLook and iconLook.brush then
            p.iconW, p.iconImg = add(ICON, 1002, iconLook)
            pcall(function()
                iconLook.brush.res.TextureParameterValues:ForEach(function(_, elem)
                    local e = elem
                    pcall(function() e = elem:get() end)
                    local nm = nil
                    pcall(function() nm = e.ParameterInfo.Name:ToString() end)
                    if nm and not p.iconParam then p.iconParam = nm end
                end)
            end)
        end

        -- arrow: black border copies behind, red copies on top
        local arrowTex, arrowSrc = nil, nil
        local cdo = StaticFindObject(ARROW_MARKER_CDO)
        if valid(cdo) then
            local okA, t = pcall(function() return cdo.OffscreenIndicator end)
            if okA and valid(t) then arrowTex, arrowSrc = t, "behemoth_marker.OffscreenIndicator" end
        end
        if not arrowTex then arrowTex, arrowSrc = texOf(ARROW_TEXTURES) end
        p.arrowImgs = {}
        local bs = ARROW + 2 * ARROW_BORDER
        for _ = 1, BRIGHT_LAYERS do
            local _, bi = add(bs, 1003, nil)
            if bi then
                p.arrowImgs[#p.arrowImgs + 1] = bi
                if arrowTex then pcall(function() bi:SetBrushResourceObject(arrowTex) end) end
                pcall(function() bi:SetBrushSize({X = bs, Y = bs}) end)
                pcall(function() bi:SetColorAndOpacity({R = 0, G = 0, B = 0, A = 1}) end)
            end
        end
        for _ = 1, BRIGHT_LAYERS do
            local _, ai = add(ARROW, 1004, nil)
            if ai then
                p.arrowImgs[#p.arrowImgs + 1] = ai
                if arrowTex then pcall(function() ai:SetBrushResourceObject(arrowTex) end) end
                pcall(function() ai:SetBrushSize({X = ARROW, Y = ARROW}) end)
                pcall(function() ai:SetColorAndOpacity(ARROW_COLOR) end)
            end
        end
        log("arrow texture: " .. tostring(arrowSrc))

        -- distance text under the ring
        local okT, l, tb = pcall(MakeText, PC, Lib, TEXT_SIZE, 1004)
        if okT and l then p.label, p.labelText = l, tb end

        ptr = p
        Place()
        SetShown(false)
        log("tracker ready (top-right, shows at " .. MIN_M .. " m+)")
    end)
    if not ok then log("ERROR Create: " .. tostring(err)) end
    creating = false
end

-- ---------------------------------------------------------------- target + update

local function MarkerCompFor(key)
    local c = markerCompCache[key]
    if valid(c) then return c end
    markerCompCache[key] = nil
    local path = PathOf(key)
    if not path then return nil end
    for _, cls in ipairs({"behemoth_marker_bpc_C", "BehemothMarkerComponent"}) do
        local list = FindAllOf(cls)
        if list then
            for _, o in ipairs(list) do
                local okN, n = pcall(function() return o:GetFullName() end)
                local op = okN and PathOf(n)
                if op and op:sub(1, #path + 1) == path .. "." then
                    markerCompCache[key] = o
                    return o
                end
            end
        end
    end
    return nil
end

-- Target = the behemoth whose health changed most recently, else the first one found.
local function PickTarget()
    local list = FindAllOf("ArchonBehemoth")
    local seen, first = {}, nil
    if list then
        for _, b in ipairs(list) do
            if valid(b) then
                local okN, key = pcall(function() return b:GetFullName() end)
                local okH, hp = pcall(function() return b:GetCurrentHealth() end)
                if okN and key then
                    seen[key] = b
                    first = first or {key = key, obj = b}
                    if okH and type(hp) == "number" then
                        local prev = lastHealth[key]
                        if prev and math.abs(prev - hp) > 0.01 then targetKey, targetObj = key, b end
                        lastHealth[key] = hp
                    end
                end
            end
        end
    end
    for k in pairs(lastHealth) do if not seen[k] then lastHealth[k] = nil end end
    if not (targetKey and seen[targetKey]) then
        if first then targetKey, targetObj = first.key, first.obj else targetKey, targetObj = nil, nil end
    else
        targetObj = seen[targetKey]
    end
end

local function NormDeg(a)
    a = a % 360
    if a > 180 then a = a - 360 end
    return a
end

local function Tick()
    PickTarget()
    if not targetKey then SetShown(false) return end
    if not (ptr and valid(ptr.parts[1] and ptr.parts[1].w)) then
        -- (re)create, but at most once every ~3 s if it keeps failing
        createWait = (createWait or 0) - 1
        if createWait <= 0 then
            createWait = 50
            Create()
        end
    end
    if not ptr then return end
    if not valid(targetObj) then SetShown(false) return end

    local PC = GetPC()
    if not PC then return end
    local okP, pawn = pcall(function() return PC:K2_GetPawn() end)
    if not (okP and valid(pawn)) then SetShown(false) return end
    local okL, pl = pcall(function() return pawn:K2_GetActorLocation() end)
    local okB, bl = pcall(function() return targetObj:K2_GetActorLocation() end)
    if not (okL and pl and okB and bl) then return end
    local dx, dy, dz = bl.X - pl.X, bl.Y - pl.Y, bl.Z - pl.Z
    local dist = math.sqrt(dx * dx + dy * dy + dz * dz) / 100   -- cm -> m
    if dist < MIN_M and not ModSettings.Get("trk_always", false) then SetShown(false) return end

    -- sigil, once per target
    if ptr.iconKey ~= targetKey and valid(ptr.iconImg) then
        ptr.iconKey = targetKey
        local comp = MarkerCompFor(targetKey)
        local okI, tex = false, nil
        if comp then okI, tex = pcall(function() return comp.BehemothIcon end) end
        if okI and valid(tex) then
            if ptr.iconParam then
                local okD, dyn = pcall(function() return ptr.iconImg:GetDynamicMaterial() end)
                if okD and valid(dyn) then
                    pcall(function() dyn:SetTextureParameterValue(FName(ptr.iconParam), tex) end)
                end
            else
                pcall(function() ptr.iconImg:SetBrushResourceObject(tex) end)
            end
            pcall(function() ptr.iconImg:SetBrushSize({X = ICON, Y = ICON}) end)
            ptr.noIcon = false
        else
            ptr.noIcon = true
            pcall(function() ptr.iconW:SetVisibility(VIS_HIDDEN) end)
        end
    end

    -- arrow angle: direction to the behemoth relative to the camera (screen-up = forward)
    local okR, rot = pcall(function() return PC:GetControlRotation() end)
    if not (okR and rot) then logOnce("rot", "GetControlRotation failed") return end
    local rel = NormDeg(math.deg(math.atan(dy, dx)) - rot.Yaw)
    local rad = math.rad(rel)
    for _, img in ipairs(ptr.arrowImgs) do
        if valid(img) then
            pcall(function()
                img:SetRenderTranslation({X = ORBIT * math.sin(rad), Y = -ORBIT * math.cos(rad)})
                img:SetRenderTransformAngle(rel + ARROW_ANGLE_OFFSET)
            end)
        end
    end
    local txt = string.format("%d m", math.floor(dist + 0.5))
    if valid(ptr.labelText) and txt ~= ptr.lastText then
        if pcall(function() ptr.labelText:SetText(FText(txt)) end) then ptr.lastText = txt end
    end
    SetShown(true)
end

-- ---------------------------------------------------------------- startup

-- Ctrl+R restarts this script but leaves its old widgets on screen: remove the tagged ones.
local function RemoveOld()
    local n = 0
    for _, cls in ipairs({"StackableProgressBar_C", "w_chat_log_label_bpw_C"}) do
        local list = FindAllOf(cls)
        if list then
            for _, w in ipairs(list) do
                local okV, inVp = pcall(function() return w:IsInViewport() end)
                local okO, op = pcall(function() return w.RenderOpacity end)
                if okV and inVp and okO and op and math.abs(op - TAG) < 0.0005 then
                    if pcall(function() w:RemoveFromViewport() end) then n = n + 1 end
                end
            end
        end
    end
    if n > 0 then log("removed " .. n .. " old tracker widget(s)") end
end

pcall(function() ExecuteInGameThread(function() pcall(RemoveOld) end) end)

FrameTick.Every(1, "settings", ModSettings.Load)
FrameTick.Every(TICK_SEC, "tracker", function()
    local ok, err = pcall(Tick)
    if not ok then logOnce("tick", "ERROR Tick: " .. tostring(err)) end
end)
FrameTick.Start(log, "BehemothTracker")

log("BehemothTracker loaded")
