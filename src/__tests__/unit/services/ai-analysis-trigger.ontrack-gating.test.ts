// Shared mocks
const emitTier1Insight = jest.fn()
const emitGuidanceAnalytics = jest.fn()
const emitTeacherRecommendations = jest.fn()
const emitTier2Insight = jest.fn()

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getGuidanceService: () => ({
      emitTier1Insight,
      emitGuidanceAnalytics,
      emitTeacherRecommendations,
      emitTier2Insight,
    })
  })
}))

jest.mock('../../../services/ai-insights-persistence.service', () => ({
  aiInsightsPersistenceService: {
    persistTier1: jest.fn(async () => {}),
    persistTier2: jest.fn(async () => {}),
  }
}))

describe('AIAnalysisTriggerService — Tier1 on-track gating + Tier2 passive', () => {
  const realEnv = process.env
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...realEnv }
    // Default flags for tests
    process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK = '1'
    process.env.GUIDANCE_TIER1_ONTRACK_THRESHOLD = '0.5'
    process.env.GUIDANCE_TIER1_CONF_MIN = '0.5'
    process.env.GUIDANCE_AUTO_PROMPTS = '1'
  })
  afterAll(() => {
    process.env = realEnv
  })

  it('suppresses Tier1 emits/prompts when on-track and emits guidance analytics', async () => {
    jest.doMock('../../../utils/ai-analysis.port.instance', () => ({
      aiAnalysisPort: {
        analyzeTier1: jest.fn(async () => ({
          analysisTimestamp: new Date().toISOString(),
          topicalCohesion: 0.8,
          conceptualDensity: 0.82,
          confidence: 0.9,
          insights: []
        })),
      }
    }))

    const { aiAnalysisTriggerService: svc } = require('../../../services/ai-analysis-trigger.service')
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    await svc.triggerTier1Analysis(uuid, uuid, uuid, ['enough text', 'more text'])

    expect(emitTier1Insight).not.toHaveBeenCalled()
    expect(emitTeacherRecommendations).not.toHaveBeenCalled()
    expect(emitGuidanceAnalytics).toHaveBeenCalled()
  })

  it('off-track path unchanged: emits Tier1 + generates prompts', async () => {
    jest.doMock('../../../utils/ai-analysis.port.instance', () => ({
      aiAnalysisPort: {
        analyzeTier1: jest.fn(async () => ({
          analysisTimestamp: new Date().toISOString(),
          topicalCohesion: 0.3,
          conceptualDensity: 0.4,
          confidence: 0.9,
          insights: []
        })),
      }
    }))

    jest.doMock('../../../services/teacher-prompt.service', () => ({
      teacherPromptService: {
        generatePrompts: jest.fn(async () => ([{ id: 'p1', message: 'Try think-pair-share', priority: 'high', category: 'collaboration' }]))
      }
    }))

    const { aiAnalysisTriggerService: svc } = require('../../../services/ai-analysis-trigger.service')
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    await svc.triggerTier1Analysis(uuid, uuid, uuid, ['enough text', 'more text'])

    expect(emitTier1Insight).toHaveBeenCalled()
    expect(emitTeacherRecommendations).toHaveBeenCalled()
  })

  it('confidence below C_MIN ignores gating and proceeds with emit', async () => {
    jest.doMock('../../../utils/ai-analysis.port.instance', () => ({
      aiAnalysisPort: {
        analyzeTier1: jest.fn(async () => ({
          analysisTimestamp: new Date().toISOString(),
          topicalCohesion: 0.9,
          conceptualDensity: 0.9,
          confidence: 0.2,
          insights: []
        })),
      }
    }))

    const { aiAnalysisTriggerService: svc } = require('../../../services/ai-analysis-trigger.service')
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    await svc.triggerTier1Analysis(uuid, uuid, uuid, ['enough text', 'more text'])

    expect(emitTier1Insight).toHaveBeenCalled()
  })

  it('Tier2 passive mode: suppresses Tier2 emits and prompts, still persists', async () => {
    process.env.GUIDANCE_TIER2_PASSIVE = '1'
    jest.doMock('../../../utils/ai-analysis.port.instance', () => ({
      aiAnalysisPort: {
        analyzeTier2: jest.fn(async () => ({
          analysisTimestamp: new Date().toISOString(),
          recommendations: [],
          confidence: 0.9,
        })),
      }
    }))

    const { aiAnalysisTriggerService: svc } = require('../../../services/ai-analysis-trigger.service')
    await svc.triggerTier2Analysis('123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174000', new Array(10).fill('text'))

    expect(emitTier2Insight).not.toHaveBeenCalled()
    expect(emitTeacherRecommendations).not.toHaveBeenCalled()
  })
})
