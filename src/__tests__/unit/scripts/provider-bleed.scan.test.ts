import path from 'path';

const { scanProviderBleed } = require('../../../../scripts/provider-bleed-scan');

describe('provider bleed scan', () => {
  const projectRoot = path.resolve(__dirname, '../../..');

  it('flags databricks imports in controller/service roots', () => {
    const badRoot = path.resolve(projectRoot, '__tests__/fixtures/provider-bleed/bad');
    const violations = scanProviderBleed({ roots: [badRoot] });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: expect.stringContaining('bad.controller.ts') }),
      ])
    );
  });

  it('passes when no forbidden imports are present', () => {
    const goodRoot = path.resolve(projectRoot, '__tests__/fixtures/provider-bleed/good');
    const violations = scanProviderBleed({ roots: [goodRoot] });
    expect(violations).toHaveLength(0);
  });
});
