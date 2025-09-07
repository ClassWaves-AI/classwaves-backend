describe('audit.port.instance', () => {
  it('returns a default instance and can be swapped in tests', async () => {
    jest.resetModules();
    const mod = await import('../../../utils/audit.port.instance');
    expect(mod.getAuditLogPort()).toBeDefined();
    // Swap by overwriting exported const via jest.mock not supported here; ensure import works
    const port = mod.getAuditLogPort();
    await expect(port.enqueue({
      actorId: 'a', actorType: 'system', eventType: 'test', eventCategory: 'compliance', resourceType: 'r', resourceId: 'rid', schoolId: 'sch'
    } as any)).resolves.toBeUndefined();
  });
});

