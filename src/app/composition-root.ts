import type { SessionRepositoryPort } from '../services/ports/session.repository.port';
import type { DbProvider } from '@classwaves/shared';
import { FeatureFlags } from '@classwaves/shared';
import { sessionRepository as databricksSessionRepository } from '../adapters/repositories/databricks-session.repository';
import type { GroupRepositoryPort } from '../services/ports/group.repository.port';
import { groupRepository as databricksGroupRepository } from '../adapters/repositories/databricks-group.repository';
import type { SessionStatsRepositoryPort } from '../services/ports/session-stats.repository.port';
import { sessionStatsRepository as databricksSessionStatsRepository } from '../adapters/repositories/databricks-session-stats.repository';
import type { SessionDetailRepositoryPort } from '../services/ports/session-detail.repository.port';
import { sessionDetailRepository as databricksSessionDetailRepository } from '../adapters/repositories/databricks-session-detail.repository';
import { createDbSessionDetailRepository } from '../adapters/repositories/db-session-detail.repository';
import type { RosterRepositoryPort } from '../services/ports/roster.repository.port';
import { rosterRepository as databricksRosterRepository } from '../adapters/repositories/databricks-roster.repository';
import type { AdminRepositoryPort } from '../services/ports/admin.repository.port';
import { adminRepository as databricksAdminRepository } from '../adapters/repositories/databricks-admin.repository';
import type { BudgetRepositoryPort } from '../services/ports/budget.repository.port';
import { budgetRepository as databricksBudgetRepository } from '../adapters/repositories/databricks-budget.repository';
import type { AnalyticsRepositoryPort } from '../services/ports/analytics.repository.port';
import { analyticsRepository as databricksAnalyticsRepository } from '../adapters/repositories/databricks-analytics.repository';
import type { ParticipantRepositoryPort } from '../services/ports/participant.repository.port';
import { participantRepository as databricksParticipantRepository } from '../adapters/repositories/databricks-participant.repository';
import { createDbParticipantRepository } from '../adapters/repositories/db-participant.repository';
import type { ComplianceRepositoryPort } from '../services/ports/compliance.repository.port';
import { complianceRepository as databricksComplianceRepository } from '../adapters/repositories/databricks-compliance.repository';
import type { HealthRepositoryPort } from '../services/ports/health.repository.port';
import { healthRepository as databricksHealthRepository } from '../adapters/repositories/databricks-health.repository';
import type { MonitoringRepositoryPort } from '../services/ports/monitoring.repository.port';
import { monitoringRepository as databricksMonitoringRepository } from '../adapters/repositories/databricks-monitoring.repository';
import type { AIAnalysisPort } from '../services/ai-analysis.port';
import { databricksAIAnalysisAdapter } from '../adapters/ai-analysis.databricks';
import type { EmailPort } from '../services/ports/email.port';
import { emailServiceAdapter } from '../adapters/email/email.adapter';
import type { SummariesRepositoryPort } from '../services/ports/summaries.repository.port';
import { summariesRepository as databricksSummariesRepository } from '../adapters/repositories/databricks-summaries.repository';
import type { GuidanceInsightsRepositoryPort } from '../services/ports/guidance-insights.repository.port';
import { guidanceInsightsRepository as databricksGuidanceInsightsRepository } from '../adapters/repositories/databricks-guidance-insights.repository';
import { createDbGuidanceInsightsRepository } from '../adapters/repositories/db-guidance-insights.repository';
import type { GuidanceEventsRepositoryPort } from '../services/ports/guidance-events.repository.port';
import { guidanceEventsRepository as databricksGuidanceEventsRepository } from '../adapters/repositories/databricks-guidance-events.repository';
import type { DbPort } from '../services/ports/db.port';
import { createPostgresDbAdapter } from '../adapters/db/postgres.adapter';
import { createDatabricksDbAdapter } from '../adapters/db/databricks.adapter';
import { createDbSessionRepository } from '../adapters/repositories/db-session.repository';
import { createDbGroupRepository } from '../adapters/repositories/db-group.repository';
import { createDbRosterRepository } from '../adapters/repositories/db-roster.repository';
import { logger } from '../utils/logger';
import { getSchemaManifestHash } from '../utils/manifest.utils';

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveDbProvider(): { provider: DbProvider; details: { envProvider?: string | null; flagEnabled: boolean; enforcedProvider?: DbProvider } } {
  const rawEnvProvider = process.env.DB_PROVIDER?.toLowerCase() ?? null;
  const flagKey = FeatureFlags.DB_USE_LOCAL_POSTGRES;
  const flagRawDirect = process.env[flagKey];
  const flagRawEnv = process.env.CW_DB_USE_LOCAL_POSTGRES;
  const useLocalDb = isTruthyEnv(process.env.USE_LOCAL_DB);
  const flagEnabled = isTruthyEnv(flagRawDirect) || isTruthyEnv(flagRawEnv) || useLocalDb;

  let provider: DbProvider = 'databricks';
  if (rawEnvProvider === 'postgres') {
    provider = 'postgres';
  }
  if (flagEnabled) {
    provider = 'postgres';
  }

  const environment = (process.env.NODE_ENV || 'development').toLowerCase();
  const allowPostgres = environment === 'development' || environment === 'test';
  if (provider === 'postgres' && !allowPostgres) {
    logger.warn('postgres-provider-forbidden', {
      environment,
      requestedProvider: rawEnvProvider,
    });
    provider = 'databricks';
  }

  return {
    provider,
    details: { envProvider: rawEnvProvider, flagEnabled, enforcedProvider: provider },
  };
}

class CompositionRoot {
  private readonly _dbProvider: DbProvider;
  private readonly _dbPort: DbPort;
  private _sessionRepository: SessionRepositoryPort;
  private _groupRepository: GroupRepositoryPort;
  private _sessionStatsRepository: SessionStatsRepositoryPort;
  private _sessionDetailRepository: SessionDetailRepositoryPort;
  private _rosterRepository: RosterRepositoryPort;
  private _adminRepository: AdminRepositoryPort;
  private _budgetRepository: BudgetRepositoryPort;
  private _analyticsRepository: AnalyticsRepositoryPort;
  private _participantRepository: ParticipantRepositoryPort;
  private _complianceRepository: ComplianceRepositoryPort;
  private _healthRepository: HealthRepositoryPort;
  private _monitoringRepository: MonitoringRepositoryPort;
  private _aiAnalysisPort: AIAnalysisPort;
  private _emailPort: EmailPort;
  private _summariesRepository: SummariesRepositoryPort;
  private _guidanceInsightsRepository: GuidanceInsightsRepositoryPort;
  private _guidanceEventsRepository: GuidanceEventsRepositoryPort;

  constructor() {
    const { provider, details } = resolveDbProvider();
    this._dbProvider = provider;
    if (provider === 'postgres' && process.env.DATABRICKS_MOCK !== '1') {
      process.env.DATABRICKS_MOCK = '1';
    }
    this._dbPort = provider === 'postgres' ? createPostgresDbAdapter() : createDatabricksDbAdapter();
    const schemaManifestVersion = provider === 'postgres' ? getSchemaManifestHash() ?? null : null;
    logger.info('db-provider-selected', {
      provider: this._dbProvider,
      envProvider: details.envProvider,
      flagEnabled: details.flagEnabled,
      schema_manifest_version: schemaManifestVersion,
    });

    // Wire default adapters
    this._sessionRepository = databricksSessionRepository;
    this._groupRepository = databricksGroupRepository;
    this._sessionStatsRepository = databricksSessionStatsRepository;
    this._sessionDetailRepository = databricksSessionDetailRepository;
    this._rosterRepository = databricksRosterRepository;
    this._adminRepository = databricksAdminRepository;
    this._budgetRepository = databricksBudgetRepository;
    this._analyticsRepository = databricksAnalyticsRepository;
    this._participantRepository = databricksParticipantRepository;
    this._complianceRepository = databricksComplianceRepository;
    this._healthRepository = databricksHealthRepository;
    this._monitoringRepository = databricksMonitoringRepository;
    this._aiAnalysisPort = databricksAIAnalysisAdapter;
    this._emailPort = emailServiceAdapter;
    this._summariesRepository = databricksSummariesRepository;
    this._guidanceInsightsRepository = databricksGuidanceInsightsRepository;
    this._guidanceEventsRepository = databricksGuidanceEventsRepository;

    if (this._dbProvider === 'postgres') {
      this._sessionRepository = createDbSessionRepository(this._dbPort);
      this._groupRepository = createDbGroupRepository(this._dbPort);
      this._rosterRepository = createDbRosterRepository(this._dbPort);
      this._sessionDetailRepository = createDbSessionDetailRepository(this._dbPort);
      this._participantRepository = createDbParticipantRepository(this._dbPort);
      this._guidanceInsightsRepository = createDbGuidanceInsightsRepository(this._dbPort);
    }
  }

  getSessionRepository(): SessionRepositoryPort {
    return this._sessionRepository;
  }

  getGroupRepository(): GroupRepositoryPort {
    return this._groupRepository;
  }

  getSessionStatsRepository(): SessionStatsRepositoryPort {
    return this._sessionStatsRepository;
  }

  getSessionDetailRepository(): SessionDetailRepositoryPort {
    return this._sessionDetailRepository;
  }

  getRosterRepository(): RosterRepositoryPort {
    return this._rosterRepository;
  }

  getAdminRepository(): AdminRepositoryPort {
    return this._adminRepository;
  }

  getBudgetRepository(): BudgetRepositoryPort {
    return this._budgetRepository;
  }

  getAnalyticsRepository(): AnalyticsRepositoryPort {
    return this._analyticsRepository;
  }

  getParticipantRepository(): ParticipantRepositoryPort {
    return this._participantRepository;
  }

  getComplianceRepository(): ComplianceRepositoryPort {
    return this._complianceRepository;
  }

  getHealthRepository(): HealthRepositoryPort {
    return this._healthRepository;
  }

  getMonitoringRepository(): MonitoringRepositoryPort {
    return this._monitoringRepository;
  }

  getAIAnalysisPort(): AIAnalysisPort {
    return this._aiAnalysisPort;
  }

  getEmailPort(): EmailPort {
    return this._emailPort;
  }

  getSummariesRepository(): SummariesRepositoryPort {
    return this._summariesRepository;
  }

  getGuidanceInsightsRepository(): GuidanceInsightsRepositoryPort {
    return this._guidanceInsightsRepository;
  }

  getGuidanceEventsRepository(): GuidanceEventsRepositoryPort {
    return this._guidanceEventsRepository;
  }

  getDbProvider(): DbProvider {
    return this._dbProvider;
  }

  getDbPort(): DbPort {
    return this._dbPort;
  }
}

const composition = new CompositionRoot();
export function getCompositionRoot(): CompositionRoot {
  return composition;
}
