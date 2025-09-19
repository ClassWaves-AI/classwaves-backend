import { databricksMock, databricksMockService } from '../../services/databricks.mock.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';

jest.mock('../../utils/audit.port.instance', () => ({
  auditLogPort: { enqueue: jest.fn().mockResolvedValue(undefined) },
}));

describe('Guidance context persistence round-trip', () => {
  const sessionId = 'c8f3a666-8e8b-4e86-9a30-5b2ccdda8d9d';
  const promptId = 'a3cf3485-0aa1-4f5e-a5ab-1268990e9d15';

  beforeEach(() => {
    process.env.DATABRICKS_MOCK = '1';
    databricksMock.reset();
    (teacherPromptService as any).promptCache.clear();
    (teacherPromptService as any).teacherGuidanceContextColumnsSupport = true;
  });

  afterEach(() => {
    delete process.env.DATABRICKS_MOCK;
  });

  it('reads context and on-track summary fields from teacher_guidance_metrics', async () => {
    const now = new Date();
    await databricksMockService.insert('classwaves.ai_insights.teacher_guidance_metrics', {
      id: promptId,
      prompt_id: promptId,
      session_id: sessionId,
      teacher_id: 'teacher-ctx',
      group_id: 'group-ctx',
      prompt_category: 'redirection',
      priority_level: 'high',
      prompt_message: 'Guide the group back to the lab objective.',
      prompt_context: 'Trending off-topic',
      suggested_timing: 'immediate',
      session_phase: 'development',
      subject_area: 'science',
      target_metric: 'topicalCohesion',
      learning_objectives: '[]',
      generated_at: new Date(now.getTime() - 60_000).toISOString(),
      expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      acknowledged_at: null,
      used_at: null,
      dismissed_at: null,
      effectiveness_score: 0.48,
      feedback_rating: null,
      feedback_text: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      context_reason: 'Students drifted into weekend plans.',
      context_prior_topic: 'Energy transfer lab',
      context_current_topic: 'Weekend plans',
      context_transition_idea: 'Invite them to connect the tangent back to their lab notes.',
      context_supporting_lines: [
        { speaker: 'Participant 2', quote: 'Practice tonight will be exciting.', timestamp: now.toISOString() },
      ],
      context_confidence: 0.66,
      bridging_prompt: 'Ask for one evidence-based observation to reconnect.',
      on_track_summary: 'Group is on track — cohesion 82%, depth 76%, momentum +12.',
    });

    const prompts = await teacherPromptService.getActivePrompts(sessionId, { includeExpired: true });
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0];

    expect(prompt.contextEvidence).toBeDefined();
    expect(prompt.contextEvidence).toMatchObject({
      reason: expect.stringContaining('drifted into weekend plans'),
      priorTopic: 'Energy transfer lab',
      currentTopic: 'Weekend plans',
      transitionIdea: expect.stringContaining('lab notes'),
      confidence: 0.66,
    });
    expect(prompt.contextEvidence?.quotes).toEqual([
      expect.objectContaining({
        speakerLabel: 'Participant 1',
        text: expect.stringContaining('Practice tonight'),
      }),
    ]);
    expect(prompt.contextEvidence?.supportingLines).toEqual([
      expect.objectContaining({
        speaker: 'Participant 1',
        quote: expect.stringContaining('Practice tonight'),
      }),
    ]);
    expect(prompt.onTrackSummary).toContain('cohesion 82%');
    expect(prompt.bridgingPrompt).toContain('evidence-based observation');
  });
});
