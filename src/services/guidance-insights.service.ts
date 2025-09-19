import { getCompositionRoot } from '../app/composition-root';

export interface SessionGuidanceInsights {
  tier1: Array<{ timestamp: string; groupId: string; groupName?: string; text: string }>;
  tier2: any | null;
}

export interface GroupGuidanceInsights {
  tier1: Array<{ timestamp: string; groupId: string; groupName?: string; text: string }>;
  tier2Group: any | null;
}

/**
 * Aggregates guidance insights for a session using the configured repository.
 * Keeps domain logic framework-free; all DB specifics live in the repository adapter.
 */
class GuidanceInsightsService {
  async getForSession(sessionId: string): Promise<SessionGuidanceInsights> {
    const repo = getCompositionRoot().getGuidanceInsightsRepository();
    const [t1, t2] = await Promise.all([
      repo.listTier1SnippetsBySession(sessionId, 25),
      repo.getLatestTier2BySession(sessionId)
    ]);

    return {
      tier1: t1.map(s => ({
        timestamp: new Date(s.timestamp).toISOString(),
        groupId: s.groupId,
        groupName: s.groupName,
        text: s.text,
      })),
      tier2: t2 || null,
    };
  }

  async getForGroup(sessionId: string, groupId: string): Promise<GroupGuidanceInsights> {
    const repo = getCompositionRoot().getGuidanceInsightsRepository();
    const [t1, t2] = await Promise.all([
      repo.listTier1ByGroup(sessionId, groupId, 25),
      repo.getLatestTier2BySession(sessionId)
    ]);

    // Derive a group slice from tier2 if crossGroupComparison or targetGroups exist
    let tier2Group: any | null = null;
    if (t2 && typeof t2 === 'object') {
      try {
        if (Array.isArray(t2.crossGroupComparison)) {
          const cmp = t2.crossGroupComparison.find((g: any) => g.groupId === groupId);
          if (cmp) tier2Group = { comparison: cmp };
        }
        if (!tier2Group && Array.isArray(t2.recommendations)) {
          const targeted = t2.recommendations.filter((r: any) => Array.isArray(r.targetGroups) && r.targetGroups.includes(groupId));
          if (targeted.length > 0) tier2Group = { recommendations: targeted };
        }
      } catch { /* intentionally ignored: best effort cleanup */ }
    }

    return {
      tier1: t1.map(s => ({
        timestamp: new Date(s.timestamp).toISOString(),
        groupId: s.groupId,
        groupName: s.groupName,
        text: s.text,
      })),
      tier2Group,
    };
  }
}

export const guidanceInsightsService = new GuidanceInsightsService();
