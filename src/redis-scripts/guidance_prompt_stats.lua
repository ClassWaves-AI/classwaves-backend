-- guidance_prompt_stats.lua
-- KEYS[1] = Redis hash key guidance:prompt:template_stats:<templateId>
-- ARGV[1] = outcome (0 or 1)
-- ARGV[2] = current timestamp in milliseconds
-- ARGV[3] = half-life in milliseconds (defaults to 14 days)
-- ARGV[4] = TTL in seconds (30 days)

local key = KEYS[1]
local outcome = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2]) or 0
local halfLifeMs = tonumber(ARGV[3]) or (14 * 24 * 60 * 60 * 1000)
local ttlSeconds = tonumber(ARGV[4]) or 0

if not outcome then
  return redis.error_reply('OUTCOME_REQUIRED')
end

if outcome < 0 then
  outcome = 0
elseif outcome > 1 then
  outcome = 1
end

local data = redis.call('HMGET', key, 'success_sum', 'weight_sum', 'observation_count', 'last_update')
local successSum = tonumber(data[1]) or 0.0
local weightSum = tonumber(data[2]) or 0.0
local observationCount = tonumber(data[3]) or 0
local lastUpdate = tonumber(data[4]) or 0

if successSum < 0 then
  successSum = 0.0
end
if weightSum < 0 then
  weightSum = 0.0
end
if observationCount < 0 then
  observationCount = 0
end

local decay = 1.0
if lastUpdate > 0 and timestamp > lastUpdate and halfLifeMs > 0 then
  local delta = timestamp - lastUpdate
  decay = math.pow(0.5, delta / halfLifeMs)
end

successSum = successSum * decay
weightSum = weightSum * decay

successSum = successSum + outcome
weightSum = weightSum + 1.0
observationCount = observationCount + 1
lastUpdate = timestamp

local successRate = 0.5
if weightSum > 0 then
  successRate = successSum / weightSum
end

if successRate < 0 then
  successRate = 0.0
elseif successRate > 1 then
  successRate = 1.0
end

redis.call('HSET', key,
  'success_sum', string.format('%.12f', successSum),
  'weight_sum', string.format('%.12f', weightSum),
  'observation_count', tostring(observationCount),
  'last_update', tostring(lastUpdate)
)

if ttlSeconds > 0 then
  redis.call('EXPIRE', key, ttlSeconds)
end

return cjson.encode({
  successSum = successSum,
  weightSum = weightSum,
  observationCount = observationCount,
  successRate = successRate,
  lastUpdate = lastUpdate
})
