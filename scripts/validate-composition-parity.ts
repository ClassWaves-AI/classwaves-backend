#!/usr/bin/env ts-node

import path from 'path';
import { FeatureFlags } from '@classwaves/shared';

type Check = {
  name: string;
  getter: string;
  required: boolean;
  description: string;
};

const CHECKS: Check[] = [
  { name: 'sessionRepository', getter: 'getSessionRepository', required: true, description: 'Session repository must be Postgres-backed' },
  { name: 'groupRepository', getter: 'getGroupRepository', required: true, description: 'Group repository must be Postgres-backed' },
  { name: 'sessionDetailRepository', getter: 'getSessionDetailRepository', required: true, description: 'Session detail repository must be Postgres-backed' },
  { name: 'sessionStatsRepository', getter: 'getSessionStatsRepository', required: false, description: 'Session stats repository still relies on Databricks analytics' },
  { name: 'rosterRepository', getter: 'getRosterRepository', required: false, description: 'Roster repository remains Databricks-backed; follow-up ticket required for Postgres parity' },
  { name: 'adminRepository', getter: 'getAdminRepository', required: false, description: 'Admin repository remains Databricks-backed' },
  { name: 'budgetRepository', getter: 'getBudgetRepository', required: false, description: 'Budget repository remains Databricks-backed' },
  { name: 'analyticsRepository', getter: 'getAnalyticsRepository', required: false, description: 'Analytics repository remains Databricks-backed' },
  { name: 'participantRepository', getter: 'getParticipantRepository', required: false, description: 'Participant repository remains Databricks-backed' },
  { name: 'complianceRepository', getter: 'getComplianceRepository', required: false, description: 'Compliance repository remains Databricks-backed' },
  { name: 'healthRepository', getter: 'getHealthRepository', required: false, description: 'Health repository remains Databricks-backed' },
  { name: 'monitoringRepository', getter: 'getMonitoringRepository', required: false, description: 'Monitoring repository remains Databricks-backed' },
  { name: 'summariesRepository', getter: 'getSummariesRepository', required: false, description: 'Summaries repository remains Databricks-backed' },
  { name: 'guidanceInsightsRepository', getter: 'getGuidanceInsightsRepository', required: false, description: 'Guidance insights repository remains Databricks-backed' },
  { name: 'guidanceEventsRepository', getter: 'getGuidanceEventsRepository', required: false, description: 'Guidance events repository remains Databricks-backed' },
];

function lowerIncludesDatabricks(value: string | undefined): boolean {
  if (!value) return false;
  return value.toLowerCase().includes('databricks');
}

async function main() {
  // Ensure cwd is project root (allow running via npm -C etc.)
  const projectRoot = path.resolve(__dirname, '..');
  process.chdir(projectRoot);

  // Minimise side-effects when importing the composition root
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DB_PROVIDER = process.env.DB_PROVIDER || 'postgres';
  process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] = '1';
  process.env.METRICS_DEFAULT_DISABLED = process.env.METRICS_DEFAULT_DISABLED || '1';
  process.env.OTEL_ENABLED = process.env.OTEL_ENABLED || '0';

  // Lazily import composition root via ts-node
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(path.resolve('node_modules/ts-node/register/transpile-only'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCompositionRoot } = require(path.resolve('src/app/composition-root.ts'));

  const composition = getCompositionRoot();
  const provider = composition.getDbProvider?.() ?? process.env.DB_PROVIDER ?? 'unknown';

  const failures: Array<{ name: string; description: string; constructorName: string | undefined }> = [];
  const fallbacks: Array<{ name: string; description: string; constructorName: string | undefined }> = [];

  for (const check of CHECKS) {
    let instance: unknown;
    try {
      const getter = (composition as any)[check.getter];
      if (typeof getter !== 'function') {
        failures.push({ name: check.name, description: `Getter ${check.getter} missing`, constructorName: undefined });
        continue;
      }
      instance = getter.call(composition);
    } catch (error) {
      failures.push({
        name: check.name,
        description: `Error retrieving ${check.getter}: ${(error as Error)?.message || String(error)}`,
        constructorName: undefined,
      });
      continue;
    }

    const ctorName = (instance as any)?.constructor?.name as string | undefined;
    const isDatabricks = lowerIncludesDatabricks(ctorName);

    if (check.required) {
      if (!instance) {
        failures.push({ name: check.name, description: `${check.description} (got null/undefined)`, constructorName: ctorName });
      } else if (isDatabricks) {
        failures.push({ name: check.name, description: `${check.description} (expected Postgres implementation)`, constructorName: ctorName });
      }
    } else if (isDatabricks) {
      fallbacks.push({ name: check.name, description: check.description, constructorName: ctorName });
    }
  }

  const report = {
    provider,
    required: CHECKS.filter((c) => c.required).map((c) => c.name),
    checked: CHECKS.length,
    failures,
    fallbacks,
  };

  const isSuccess = failures.length === 0;

  if (isSuccess) {
    console.log(JSON.stringify({ status: 'ok', ...report }, null, 2));
    if (fallbacks.length > 0) {
      console.log('\n⚠️  The following repositories still rely on Databricks:');
      for (const item of fallbacks) {
        console.log(` - ${item.name}: ${item.constructorName || 'unknown'} (${item.description})`);
      }
    }
    process.exit(0);
  } else {
    console.error(JSON.stringify({ status: 'failed', ...report }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('validate-composition-parity: unhandled error', error);
  process.exit(1);
});
