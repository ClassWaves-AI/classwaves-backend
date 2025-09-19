-- guidance_autoprompt_cooldown.lua
-- KEYS[1] = Redis key guidance:autoprompt:last:<sessionId>:<groupId>
-- ARGV[1] = current timestamp in milliseconds
-- ARGV[2] = cooldown window in milliseconds
-- ARGV[3] = TTL in milliseconds (session TTL + 1 hour)

local key = KEYS[1]
local currentTimestamp = tonumber(ARGV[1]) or 0
local cooldownMs = tonumber(ARGV[2]) or 0
local ttlMs = tonumber(ARGV[3]) or 0

local lastTimestampRaw = redis.call('GET', key)
local lastTimestamp = tonumber(lastTimestampRaw)

local allowEmit = false

if not lastTimestamp then
  allowEmit = true
else
  local delta = currentTimestamp - lastTimestamp
  if delta >= cooldownMs then
    allowEmit = true
  end
end

if allowEmit then
  redis.call('SET', key, tostring(currentTimestamp))
end

if ttlMs > 0 then
  redis.call('PEXPIRE', key, ttlMs)
end

if allowEmit then
  return 1
end

return 0
