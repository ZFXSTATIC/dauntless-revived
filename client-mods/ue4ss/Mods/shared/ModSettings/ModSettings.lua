-- ModSettings: on/off settings shared by the client mods, changed live from the Mod Menu.
--
-- Stored in shared\ModSettings\settings.txt as "key = 1" / "key = 0" lines (choice settings
-- store a number: "key = 2"). The file is created
-- by the Mod Menu the first time a setting is changed; until then every mod uses its defaults.
-- Each mod has its own copy of this module (separate Lua states), so mods re-read the file
-- regularly to pick up changes:
--   local ModSettings = require("ModSettings")
--   FrameTick.Every(1, "settings", ModSettings.Load)
--   if ModSettings.Get("bhb_shield", true) then ... end

local M = {}

local function Dir()
    local src = debug.getinfo(1, "S").source or ""
    src = src:gsub("^@", ""):gsub("/", "\\")
    return src:match("^(.*\\)[^\\]+$") or ""
end
M.FILE = Dir() .. "settings.txt"

local values = {}

-- Re-reads the file. A missing file means "all defaults".
function M.Load()
    local f = io.open(M.FILE, "rb")
    if not f then values = {} return end
    local data = f:read("*a")
    f:close()
    local v = {}
    for key, val in data:gmatch("([%w_]+)%s*=%s*(%d+)") do v[key] = tonumber(val) end
    values = v
end

-- On/off setting: any non-zero number is on.
function M.Get(key, default)
    local v = values[key]
    if v == nil then return default end
    return v ~= 0
end

-- Choice setting: the stored number.
function M.GetNum(key, default)
    local v = values[key]
    if v == nil then return default end
    return v
end

-- Changes one setting and writes the whole file (sorted, so it stays readable).
function M.Set(key, on)
    return M.SetNum(key, on and 1 or 0)
end

function M.SetNum(key, n)
    values[key] = math.floor(tonumber(n) or 0)
    local keys = {}
    for k in pairs(values) do keys[#keys + 1] = k end
    table.sort(keys)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = k .. " = " .. tostring(values[k]) end
    local f = io.open(M.FILE, "wb")
    if not f then return false end
    f:write(table.concat(out, "\n") .. "\n")
    f:close()
    return true
end

M.Load()
return M
