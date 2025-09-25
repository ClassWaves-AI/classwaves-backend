import {
  buildSessionListQuery,
  buildSessionDetailQuery,
  buildSessionAnalyticsQuery,
  buildTeacherAnalyticsQuery,
  buildSelectClause,
  createFieldSet,
  combineFieldSets,
  validateApiContractFields,
  logQueryOptimization,
} from '../../../utils/query-builder.utils';
import { logger } from '../../../utils/logger';

describe('query-builder.utils', () => {
  it('buildSessionListQuery returns minimal optimization and qualified fields', () => {
    const result = buildSessionListQuery();
    expect(result.sql.startsWith('SELECT ')).toBe(true);
    // Should qualify fields with alias 's'
    expect(result.sql).toContain('s.id');
    expect(result.metrics.optimizationLevel).toBe('standard');
    expect(result.metrics.fieldsSelected).toBeGreaterThan(0);
  });

  it('buildSelectClause computes standard optimization for mid-sized field set', () => {
    const setA = createFieldSet('table_a', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 'a');
    const setB = createFieldSet('table_b', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], 'b');
    const result = buildSelectClause([setA, setB]);
    // 12 selected → standard
    expect(result.metrics.fieldsSelected).toBe(12);
    expect(result.metrics.optimizationLevel).toBe('standard');
  });

  it('buildSelectClause computes full optimization for large selection', () => {
    const many = Array.from({ length: 20 }, (_, i) => `f${i + 1}`);
    const setC = createFieldSet('table_c', many, 'c');
    const result = buildSelectClause([setC]);
    expect(result.metrics.fieldsSelected).toBe(20);
    expect(result.metrics.optimizationLevel).toBe('full');
  });

  it('combineFieldSets merges duplicate table/alias entries and de-duplicates fields', () => {
    const set1 = createFieldSet('t', ['x', 'y'], 't');
    const set2 = createFieldSet('t', ['y', 'z'], 't');
    const combined = combineFieldSets(set1, set2);
    expect(combined).toHaveLength(1);
    expect(new Set(combined[0].fields)).toEqual(new Set(['x', 'y', 'z']));
  });

  it('validateApiContractFields checks required fields presence', () => {
    const set = createFieldSet('t', ['id', 'name']);
    expect(validateApiContractFields(set, ['id'])).toBe(true);
    expect(validateApiContractFields(set, ['missing'])).toBe(false);
  });

  it('logQueryOptimization logs with correct structure', () => {
    const spy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    logQueryOptimization('unit:endpoint', {
      fieldsSelected: 5,
      estimatedFieldsAvoided: 10,
      queryBuildTime: 1.23,
      optimizationLevel: 'minimal',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
