-- guidance_attention_gate.lua
-- KEYS[1] = Redis hash key guidance:attention:last:<sessionId>:<groupId>
-- ARGV[1] = new attention score (number)
-- ARGV[2] = event timestamp in milliseconds
-- ARGV[3] = minimum score delta required to emit (default 5)
-- ARGV[4] = minimum time delta in milliseconds (default 30000)
-- ARGV[5] = TTL in seconds (SLI_SESSION_TTL_SECONDS)

local key = KEYS[1]
local score = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2]) or 0
local minScoreDelta = tonumber(ARGV[3]) or 0
local minTimeDeltaMs = tonumber(ARGV[4]) or 0
local ttlSeconds = tonumber(ARGV[5]) or 0

if not score then
  return redis.error_reply('SCORE_REQUIRED')
end

local existing = redis.call('HMGET', key, 'score', 'timestamp')
local lastScore = tonumber(existing[1])
local lastTimestamp = tonumber(existing[2])

local allowEmit = false

if not lastScore or not lastTimestamp then
  allowEmit = true
else
  local scoreDelta = math.abs(score - lastScore)
  local timeDelta = timestamp - lastTimestamp
  if scoreDelta >= minScoreDelta or timeDelta >= minTimeDeltaMs then
    allowEmit = true
  end
end

if allowEmit then
  redis.call('HSET', key,
    'score', string.format('%.2f', score),
    'timestamp', tostring(timestamp)
  )
end

if ttlSeconds > 0 then
  redis.call('EXPIRE', key, ttlSeconds)
end

if allowEmit then
  return 1
end

return 0
