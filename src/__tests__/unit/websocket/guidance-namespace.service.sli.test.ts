import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';

// Mock composition root to provide SessionRepository.getBasic for school lookup
jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getSessionRepository: () => ({
      getBasic: jest.fn().mockResolvedValue({ id: 'sess-1', school_id: 'school-abc', status: 'active', teacher_id: 't1' })
    })
  })
}));

describe('GuidanceNamespaceService SLI emissions (repo-backed school lookup)', () => {
  const nsEmit = jest.fn();
  const nsTo = jest.fn(() => ({ emit: nsEmit }));
  const fakeNamespace: any = { use: jest.fn(), on: jest.fn(), to: nsTo, adapter: { rooms: new Map() }, sockets: new Map(), emit: nsEmit };
  const service = new GuidanceNamespaceService(fakeNamespace);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emitTier1Insight emits to guidance:session and performs repo school lookup', async () => {
    service.emitTier1Insight('sess-1', { insight: 'x' });
    expect(nsTo).toHaveBeenCalledWith('guidance:session:sess-1');
    expect(nsEmit).toHaveBeenCalledWith('ai:tier1:insight', expect.objectContaining({ insight: 'x' }));
  });

  it('emitTeacherRecommendations emits to guidance rooms', () => {
    service.emitTeacherRecommendations('sess-1', [{ id: 'p1' }], { tier: 'tier1', generatedAt: Date.now() });
    expect(nsTo).toHaveBeenCalledWith('guidance:session:sess-1');
    const calls = (nsEmit as jest.Mock).mock.calls.filter((c: any[]) => c[0] === 'teacher:recommendations');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
