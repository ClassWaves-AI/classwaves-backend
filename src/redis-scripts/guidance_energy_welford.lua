-- guidance_energy_welford.lua
-- KEYS[1] = Redis hash key guidance:energy:stats:<sessionId>:<groupId>
-- ARGV[1] = sample value (number)
-- ARGV[2] = TTL in seconds (SLI_SESSION_TTL_SECONDS)

local key = KEYS[1]
local sample = tonumber(ARGV[1])
local ttlSeconds = tonumber(ARGV[2]) or 0

if not sample then
  return redis.error_reply('SAMPLE_REQUIRED')
end

local stats = redis.call('HMGET', key, 'mean', 'variance', 'count')
local previousMean = tonumber(stats[1]) or 0.0
local previousVariance = tonumber(stats[2]) or 0.0
local previousCount = tonumber(stats[3]) or 0

if previousCount < 0 then
  previousCount = 0
end
if previousVariance < 0 then
  previousVariance = 0.0
end

local newCount = previousCount + 1
local newMean
local newVariance

if previousCount == 0 then
  newMean = sample
  newVariance = 0.0
else
  local delta = sample - previousMean
  newMean = previousMean + (delta / newCount)
  local delta2 = sample - newMean
  local previousM2 = previousVariance * previousCount
  local newM2 = previousM2 + (delta * delta2)
  if newCount > 0 then
    newVariance = newM2 / newCount
  else
    newVariance = 0.0
  end
end

if not newMean then
  newMean = sample
end
if not newVariance then
  newVariance = 0.0
end

redis.call('HSET', key,
  'mean', string.format('%.12f', newMean),
  'variance', string.format('%.12f', newVariance),
  'count', tostring(newCount)
)

if ttlSeconds > 0 then
  redis.call('EXPIRE', key, ttlSeconds)
end

return cjson.encode({
  mean = newMean,
  variance = newVariance,
  count = newCount
})
