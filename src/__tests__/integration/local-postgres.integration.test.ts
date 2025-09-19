import request from 'supertest';
import type { Application } from 'express';
import path from 'path';
import { execSync } from 'child_process';
import {
  createPostgresDbAdapter,
  PostgresAdapterError,
} from '../../adapters/db/postgres.adapter';
import { createDbSessionRepository } from '../../adapters/repositories/db-session.repository';
import { createDbGroupRepository } from '../../adapters/repositories/db-group.repository';
import {
  maybeDescribe,
  ensureLocalPostgresReset,
  loadPostgresApp,
} from './utils/postgres-test-helpers';

const backendRoot = path.resolve(__dirname, '../../..');

maybeDescribe('Local Postgres provider – end-to-end integration', () => {
  let app: Application;
  const adapter = createPostgresDbAdapter();
  let dynamicGetCompositionRoot: () => any;
  let dynamicHealthController: any;

  beforeAll(async () => {
    ensureLocalPostgresReset();
    app = loadPostgresApp();
    // Re-require modules after resetModules to ensure provider selection respects updated env
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    dynamicGetCompositionRoot = require('../../app/composition-root').getCompositionRoot;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    dynamicHealthController = require('../../controllers/health.controller').healthController;
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('reports postgres provider in health check and metrics', async () => {
    const systemHealth = await dynamicHealthController.getSystemHealth();
    expect(systemHealth.dbProvider).toBe('postgres');
    expect(systemHealth.services.databricks.status).toBe('skipped');

    // Prime metrics by executing a simple query through the DB port
    await adapter.query('SELECT 1');

    let metrics;
    try {
      metrics = await request(app).get('/metrics').expect(200);
    } catch (error) {
      console.error('metrics request failed', error);
      throw error;
    }
    expect(metrics.text).toContain('classwaves_app_info{db_provider="postgres"} 1');
    expect(metrics.text).toContain('classwaves_db_query_attempts_total');
    expect(metrics.text).toContain('provider="postgres"');
  });

  it('round-trips session and group data via DB repositories', async () => {
    const sessionRepo = createDbSessionRepository(adapter);
    const groupRepo = createDbGroupRepository(adapter);

    const sessionId = adapter.generateId();
    const teacherId = adapter.generateId();
    const schoolId = adapter.generateId();

    await sessionRepo.insertSession({
      id: sessionId,
      title: 'Integration Session',
      status: 'created',
      teacher_id: teacherId,
      school_id: schoolId,
      planned_duration_minutes: 45,
      scheduled_start: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    const fetchedSession = await sessionRepo.getBasic(sessionId);
    expect(fetchedSession?.id).toBe(sessionId);

    const groupId = adapter.generateId();
    await groupRepo.insertGroup({
      id: groupId,
      session_id: sessionId,
      name: 'Group One',
      group_number: 1,
      status: 'created',
      max_size: 4,
      current_size: 0,
      created_at: new Date(),
      updated_at: new Date(),
      leader_id: null,
      is_ready: false,
      auto_managed: false,
    });

    await groupRepo.insertGroupMember({
      id: adapter.generateId(),
      session_id: sessionId,
      group_id: groupId,
      student_id: adapter.generateId(),
      created_at: new Date(),
    });

    const groups = await groupRepo.getGroupsBasic(sessionId);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(groupId);
  });

  it('upserts guidance metrics with JSONB context', async () => {
    const metricId = adapter.generateId();
    const promptId = adapter.generateId();

    const baseData = {
      id: metricId,
      session_id: '00000000-0000-0000-0000-000000010000',
      teacher_id: '00000000-0000-0000-0000-000000000001',
      prompt_id: promptId,
      prompt_category: 'insight',
      priority_level: 'medium',
      prompt_message: 'Initial prompt message',
      generated_at: new Date(),
      context_supporting_lines: [
        { speaker: 'teacher', quote: 'Guidance note', timestamp: '2025-01-01T00:00:00.000Z' },
      ],
    };

    await adapter.upsert('ai_insights.teacher_guidance_metrics', ['prompt_id'], baseData);

    await adapter.upsert('ai_insights.teacher_guidance_metrics', ['prompt_id'], {
      ...baseData,
      prompt_message: 'Updated prompt message',
      priority_level: 'high',
    });

    const stored = await adapter.queryOne<{
      prompt_message: string;
      priority_level: string;
      context_supporting_lines: Array<{ quote: string }>;
    }>(
      'SELECT prompt_message, priority_level, context_supporting_lines FROM ai_insights.teacher_guidance_metrics WHERE prompt_id = ?',
      [promptId]
    );

    expect(stored?.prompt_message).toBe('Updated prompt message');
    expect(stored?.priority_level).toBe('high');
    expect(stored?.context_supporting_lines?.[0]?.quote).toBe('Guidance note');
  });

  it('surfaces SQL errors with adapter error codes', async () => {
    await expect(
      adapter.query('SELECT non_existent_column FROM sessions.classroom_sessions LIMIT 1')
    ).rejects.toBeInstanceOf(PostgresAdapterError);
  });

  it('handles connection failures gracefully when the database is unavailable', async () => {
    const badAdapter = createPostgresDbAdapter({
      connectionString: 'postgres://classwaves:classwaves@localhost:6543/does_not_exist',
    });

    await expect(badAdapter.query('SELECT 1')).rejects.toBeInstanceOf(PostgresAdapterError);
  });

  it('supports reseeding via helper script mid-test', async () => {
    execSync('npm run db:local:init', { cwd: backendRoot, stdio: 'inherit' });
    const seededSession = await adapter.queryOne<{ title: string }>(
      'SELECT title FROM sessions.classroom_sessions WHERE id = ?',
      ['00000000-0000-0000-0000-000000010000']
    );
    expect(seededSession?.title).toBe('Dev Session');
  });
});
