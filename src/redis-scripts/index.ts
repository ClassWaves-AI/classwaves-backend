import fs from 'node:fs'
import path from 'node:path'
import Redis from 'ioredis'

export interface GuidanceEnergyStats {
  mean: number
  variance: number
  count: number
}

export interface GuidancePromptStatsResult {
  successSum: number
  weightSum: number
  observationCount: number
  successRate: number
  lastUpdate: number
}

interface ScriptSources {
  energyWelford: string
  attentionGate: string
  autopromptCooldown: string
  promptStats: string
}

type ScriptKey = keyof ScriptSources

const SCRIPT_FILES: Record<ScriptKey, string> = {
  energyWelford: 'guidance_energy_welford.lua',
  attentionGate: 'guidance_attention_gate.lua',
  autopromptCooldown: 'guidance_autoprompt_cooldown.lua',
  promptStats: 'guidance_prompt_stats.lua',
}

let cachedSources: ScriptSources | null = null
const scriptShaCache = new Map<string, string>()

const supportsEvalSha = (client: Redis): boolean =>
  typeof (client as any).evalsha === 'function' && typeof (client as any).script === 'function'

const readScriptSource = (fileName: string): string => {
  const resolved = path.resolve(__dirname, fileName)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Redis script not found: ${resolved}`)
  }
  return fs.readFileSync(resolved, 'utf8')
}

const getScriptSources = (): ScriptSources => {
  if (!cachedSources) {
    cachedSources = {
      energyWelford: readScriptSource(SCRIPT_FILES.energyWelford),
      attentionGate: readScriptSource(SCRIPT_FILES.attentionGate),
      autopromptCooldown: readScriptSource(SCRIPT_FILES.autopromptCooldown),
      promptStats: readScriptSource(SCRIPT_FILES.promptStats),
    }
  }
  return cachedSources
}

const loadSha = async (client: Redis, key: ScriptKey): Promise<string> => {
  const cached = scriptShaCache.get(key)
  if (cached) {
    return cached
  }
  const source = getScriptSources()[key]
  const sha = await (client as any).call('SCRIPT', 'LOAD', source)
  const shaString = typeof sha === 'string' ? sha : sha?.toString?.()
  if (!shaString) {
    throw new Error('Failed to load Redis script')
  }
  scriptShaCache.set(key, shaString)
  return shaString
}

const executeLua = async <T>(
  client: Redis,
  key: ScriptKey,
  keys: string[],
  args: Array<string | number>,
  parser: (raw: unknown) => T,
  fallback: () => Promise<T>
): Promise<T> => {
  if (!supportsEvalSha(client)) {
    return fallback()
  }

  const normalizedArgs = args.map((value) => (typeof value === 'number' ? value.toString() : String(value)))
  const sha = await loadSha(client, key)

  try {
    const raw = await client.evalsha(sha, keys.length, ...keys, ...normalizedArgs)
    return parser(raw)
  } catch (error: any) {
    const message = error?.message ? String(error.message) : ''
    if (message.includes('NOSCRIPT')) {
      scriptShaCache.delete(key)
      const newSha = await loadSha(client, key)
      const raw = await client.evalsha(newSha, keys.length, ...keys, ...normalizedArgs)
      return parser(raw)
    }
    throw error
  }
}

const parseJson = <T>(raw: unknown): T => {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T
  }
  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString('utf8')) as T
  }
  throw new Error('Unexpected Lua script response format')
}

const parseBooleanNumber = (raw: unknown): boolean => {
  if (typeof raw === 'number') {
    return raw === 1
  }
  if (typeof raw === 'string') {
    return raw === '1'
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8') === '1'
  }
  return false
}

const clamp01 = (value: number): number => {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export interface GuidanceRedisScriptRunner {
  energyWelford: (params: {
    key: string
    sample: number
    ttlSeconds: number
  }) => Promise<GuidanceEnergyStats>
  attentionGate: (params: {
    key: string
    score: number
    timestampMs: number
    minScoreDelta: number
    minTimeDeltaMs: number
    ttlSeconds: number
  }) => Promise<boolean>
  autopromptCooldown: (params: {
    key: string
    timestampMs: number
    cooldownMs: number
    ttlMs: number
  }) => Promise<boolean>
  promptStats: (params: {
    key: string
    outcome: number
    timestampMs: number
    halfLifeMs: number
    ttlSeconds: number
  }) => Promise<GuidancePromptStatsResult>
}

const formatNumber = (value: number, precision = 12): string => value.toFixed(precision)

export const createGuidanceRedisScriptRunner = (client: Redis): GuidanceRedisScriptRunner => {
  const fallbackEnergy = async (
    key: string,
    sample: number,
    ttlSeconds: number
  ): Promise<GuidanceEnergyStats> => {
    const stats = await client.hgetall(key)
    const previousMean = Number.isFinite(Number(stats.mean)) ? Number(stats.mean) : 0
    const previousVariance = Number.isFinite(Number(stats.variance)) ? Number(stats.variance) : 0
    const previousCount = Number.isFinite(Number(stats.count)) ? Number(stats.count) : 0

    const count = previousCount > 0 ? previousCount : 0
    const mean = previousMean
    const variance = previousVariance > 0 ? previousVariance : 0

    const newCount = count + 1
    let newMean = mean
    let newVariance = variance

    if (count === 0) {
      newMean = sample
      newVariance = 0
    } else {
      const delta = sample - mean
      newMean = mean + delta / newCount
      const delta2 = sample - newMean
      const m2 = variance * count
      const newM2 = m2 + delta * delta2
      newVariance = newCount > 0 ? newM2 / newCount : 0
    }

    await client.hset(key, 'mean', formatNumber(newMean))
    await client.hset(key, 'variance', formatNumber(newVariance))
    await client.hset(key, 'count', String(newCount))
    if (ttlSeconds > 0) {
      await client.expire(key, ttlSeconds)
    }

    return { mean: newMean, variance: newVariance, count: newCount }
  }

  const fallbackAttention = async (
    key: string,
    score: number,
    timestampMs: number,
    minScoreDelta: number,
    minTimeDeltaMs: number,
    ttlSeconds: number
  ): Promise<boolean> => {
    const stats = await client.hgetall(key)
    const hasScore = typeof stats.score !== 'undefined'
    const hasTimestamp = typeof stats.timestamp !== 'undefined'

    const lastScoreValue = hasScore ? Number(stats.score) : Number.NaN
    const lastTimestampValue = hasTimestamp ? Number(stats.timestamp) : Number.NaN

    let allow = false

    if (!hasScore || !hasTimestamp || Number.isNaN(lastScoreValue) || Number.isNaN(lastTimestampValue)) {
      allow = true
    } else {
      const scoreDelta = Math.abs(score - lastScoreValue)
      const timeDelta = timestampMs - lastTimestampValue
      if (scoreDelta >= minScoreDelta || timeDelta >= minTimeDeltaMs) {
        allow = true
      }
    }

    if (allow) {
      await client.hset(key, 'score', formatNumber(score, 2))
      await client.hset(key, 'timestamp', String(timestampMs))
    }

    if (ttlSeconds > 0) {
      await client.expire(key, ttlSeconds)
    }

    return allow
  }

  const fallbackAutoprompt = async (
    key: string,
    timestampMs: number,
    cooldownMs: number,
    ttlMs: number
  ): Promise<boolean> => {
    const stored = await client.get(key)
    const lastTimestamp = stored != null ? Number(stored) : undefined

    let allow = false

    if (lastTimestamp == null || Number.isNaN(lastTimestamp)) {
      allow = true
    } else {
      const delta = timestampMs - lastTimestamp
      if (delta >= cooldownMs) {
        allow = true
      }
    }

    if (allow) {
      await client.set(key, String(timestampMs))
    }

    if (ttlMs > 0) {
      await client.pexpire(key, ttlMs)
    }

    return allow
  }

  const fallbackPromptStats = async (
    key: string,
    outcome: number,
    timestampMs: number,
    halfLifeMs: number,
    ttlSeconds: number
  ): Promise<GuidancePromptStatsResult> => {
    const stats = await client.hgetall(key)
    const successSum = Number.isFinite(Number(stats.success_sum)) ? Number(stats.success_sum) : 0
    const weightSum = Number.isFinite(Number(stats.weight_sum)) ? Number(stats.weight_sum) : 0
    const observationCount = Number.isFinite(Number(stats.observation_count)) ? Number(stats.observation_count) : 0
    const lastUpdate = Number.isFinite(Number(stats.last_update)) ? Number(stats.last_update) : 0

    const halfLife = halfLifeMs > 0 ? halfLifeMs : 1
    let decayedSuccess = successSum
    let decayedWeight = weightSum

    if (lastUpdate > 0 && timestampMs > lastUpdate) {
      const delta = timestampMs - lastUpdate
      const decay = Math.pow(0.5, delta / halfLife)
      decayedSuccess *= decay
      decayedWeight *= decay
    }

    const clampedOutcome = clamp01(outcome)
    decayedSuccess += clampedOutcome
    decayedWeight += 1
    const nextObservationCount = observationCount >= 0 ? observationCount + 1 : 1
    const nextSuccessRate = decayedWeight > 0 ? clamp01(decayedSuccess / decayedWeight) : 0.5

    await client.hset(key, 'success_sum', formatNumber(decayedSuccess))
    await client.hset(key, 'weight_sum', formatNumber(decayedWeight))
    await client.hset(key, 'observation_count', String(nextObservationCount))
    await client.hset(key, 'last_update', String(timestampMs))
    if (ttlSeconds > 0) {
      await client.expire(key, ttlSeconds)
    }

    return {
      successSum: decayedSuccess,
      weightSum: decayedWeight,
      observationCount: nextObservationCount,
      successRate: nextSuccessRate,
      lastUpdate: timestampMs,
    }
  }

  return {
    energyWelford: async ({ key, sample, ttlSeconds }) =>
      executeLua(
        client,
        'energyWelford',
        [key],
        [sample, ttlSeconds],
        (raw) => {
          const result = parseJson<GuidanceEnergyStats>(raw)
          return {
            mean: Number(result.mean),
            variance: Number(result.variance),
            count: Number(result.count),
          }
        },
        () => fallbackEnergy(key, sample, ttlSeconds)
      ),
    attentionGate: async ({ key, score, timestampMs, minScoreDelta, minTimeDeltaMs, ttlSeconds }) =>
      executeLua(
        client,
        'attentionGate',
        [key],
        [score, timestampMs, minScoreDelta, minTimeDeltaMs, ttlSeconds],
        parseBooleanNumber,
        () => fallbackAttention(key, score, timestampMs, minScoreDelta, minTimeDeltaMs, ttlSeconds)
      ),
    autopromptCooldown: async ({ key, timestampMs, cooldownMs, ttlMs }) =>
      executeLua(
        client,
        'autopromptCooldown',
        [key],
        [timestampMs, cooldownMs, ttlMs],
        parseBooleanNumber,
        () => fallbackAutoprompt(key, timestampMs, cooldownMs, ttlMs)
      ),
    promptStats: async ({ key, outcome, timestampMs, halfLifeMs, ttlSeconds }) =>
      executeLua(
        client,
        'promptStats',
        [key],
        [outcome, timestampMs, halfLifeMs, ttlSeconds],
        (raw) => {
          const result = parseJson<GuidancePromptStatsResult>(raw)
          return {
            successSum: Number(result.successSum),
            weightSum: Number(result.weightSum),
            observationCount: Number(result.observationCount),
            successRate: clamp01(Number(result.successRate)),
            lastUpdate: Number(result.lastUpdate),
          }
        },
        () => fallbackPromptStats(key, outcome, timestampMs, halfLifeMs, ttlSeconds)
      ),
  }
}
