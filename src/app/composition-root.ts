import type { SessionRepositoryPort } from '../services/ports/session.repository.port';
import { sessionRepository as databricksSessionRepository } from '../adapters/repositories/databricks-session.repository';
import type { GroupRepositoryPort } from '../services/ports/group.repository.port';
import { groupRepository as databricksGroupRepository } from '../adapters/repositories/databricks-group.repository';
import type { SessionStatsRepositoryPort } from '../services/ports/session-stats.repository.port';
import { sessionStatsRepository as databricksSessionStatsRepository } from '../adapters/repositories/databricks-session-stats.repository';
import type { SessionDetailRepositoryPort } from '../services/ports/session-detail.repository.port';
import { sessionDetailRepository as databricksSessionDetailRepository } from '../adapters/repositories/databricks-session-detail.repository';
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

class CompositionRoot {
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

  constructor() {
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
}

const composition = new CompositionRoot();
export function getCompositionRoot(): CompositionRoot {
  return composition;
}
