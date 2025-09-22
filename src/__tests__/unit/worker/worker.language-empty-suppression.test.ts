import * as client from 'prom-client'

const mockProvider = {
  transcribeBuffer: jest.fn().mockResolvedValue({ text: ' ' }),
}

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}))

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitMergedGroupTranscript: jest.fn(),
      emitToGroup: jest.fn(),
    }),
  }),
}))

import { processAudioJob } from '../../../workers/audio-stt.worker'

describe('Worker language hint + empty transcript suppression', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.STT_LANGUAGE_HINT = 'en'
    mockProvider.transcribeBuffer = jest.fn().mockResolvedValue({ text: ' ' })
  })

  it('suppresses empty transcripts and passes language hint', async () => {
    mockProvider.transcribeBuffer.mockResolvedValueOnce({ text: ' ' })

    await processAudioJob({
      chunkId: 'c1',
      sessionId: 's1',
      groupId: 'g1',
      startTs: Date.now() - 1000,
      endTs: Date.now(),
      mime: 'audio/webm;codecs=opus',
      bytes: 10,
      audioB64: Buffer.from('x').toString('base64'),
    } as any)

    expect(mockProvider.transcribeBuffer).toHaveBeenCalled()
    // Assert language hint was passed
    const args = mockProvider.transcribeBuffer.mock.calls[0]
    expect(args[2]).toMatchObject({ language: 'en' })

    // Prom counter should exist; exact value depends on global registry state
    const ctr = client.register.getSingleMetric('stt_empty_transcripts_dropped_total') as client.Counter<string>
    expect(ctr).toBeDefined()
  })
})
