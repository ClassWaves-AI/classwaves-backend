const connectMock = jest.fn();
const queryMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('../../../services/databricks.service', () => ({
  DatabricksService: jest.fn(() => ({
    connect: connectMock,
    query: queryMock,
    disconnect: disconnectMock,
  })),
}));

describe('2025-09-18 guidance context migration', () => {
  beforeEach(() => {
    jest.resetModules();
    connectMock.mockClear();
    queryMock.mockClear();
    disconnectMock.mockClear();
  });

  it('runs idempotently when executed multiple times', async () => {
    await jest.isolateModulesAsync(async () => {
    const { migrate } = await import('../../../scripts/migrations/2025-09-18-guidance-context-and-ontrack-summary');

    let callCount = 0;
    queryMock.mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 8) {
        return;
      }
      const error = new Error('ALREADY_EXISTS: column already exists');
      throw error;
    });

    await expect(migrate()).resolves.not.toThrow();
    await expect(migrate()).resolves.not.toThrow();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenCalledTimes(16);
  });
});
});
