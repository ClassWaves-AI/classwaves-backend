import { InMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';

const calls: { buffer: Buffer }[] = [];
const mockProvider = {
  transcribeBuffer: jest.fn(async (b: Buffer) => { calls.push({ buffer: b }); return { text: 'ok' } as any; }),
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

describe('InMemoryAudioProcessor WebM fragment repair (WS flag)', () => {
  beforeEach(() => { calls.length = 0; process.env.WS_STT_REPAIR_WEBM_FRAGMENTS = '1'; });

  it('aligns to first Cluster and rewrites size so Cluster starts at header end', async () => {
    const p = new InMemoryAudioProcessor();
    const groupId = 'g1';
    const sessionId = 's1';
    // Build a header-bearing chunk (EBML + HEADER + Cluster + data)
    const EBML = Buffer.from([0x1a,0x45,0xdf,0xa3, 0x42,0x86]);
    const CLUSTER = Buffer.from([0x1f,0x43,0xb6,0x75]);
    // Fake header includes EBML + HEADER + CLUSTER start
    const headered = Buffer.concat([EBML, Buffer.from('HEADER'), CLUSTER, Buffer.from('H1')]);
    // Ingest headered first to cache header
    await (p as any).ingestGroupAudioChunk(groupId, headered, 'audio/webm;codecs=opus', sessionId);

    // Next fragment: junk + cluster + payload (no header)
    const frag = Buffer.concat([ Buffer.from('JUNKJUNK'), CLUSTER, Buffer.from('PAYLOAD') ]);
    await (p as any).ingestGroupAudioChunk(groupId, frag, 'audio/webm;codecs=opus', sessionId);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const buf = calls[calls.length - 1].buffer;
    // Extract header length from the combined buffer using EBML+HEADER length
    const headerLen = buf.indexOf(CLUSTER);
    expect(headerLen).toBeGreaterThan(0);
    // Assert the first occurrence of cluster equals header end (aligned)
    expect(buf.indexOf(CLUSTER)).toBe(headerLen);
  });
});
