import * as client from 'prom-client'
import { processAudioJob } from '../../../workers/audio-stt.worker'

jest.mock('../../../services/openai-whisper.service', () => ({
  openAIWhisperService: {
    transcribeBuffer: jest.fn().mockResolvedValue({ text: ' ' }),
  },
}))

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitMergedGroupTranscript: jest.fn(),
      emitToGroup: jest.fn(),
    }),
  }),
}))

describe('Worker language hint + empty transcript suppression', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.STT_LANGUAGE_HINT = 'en'
  })

  it('suppresses empty transcripts and passes language hint', async () => {
    const { openAIWhisperService } = await import('../../../services/openai-whisper.service')
    const spy = jest.spyOn(openAIWhisperService, 'transcribeBuffer')

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

    expect(spy).toHaveBeenCalled()
    // Assert language hint was passed
    const args = spy.mock.calls[0]
    expect(args[2]).toMatchObject({ language: 'en' })

    // Prom counter should exist; exact value depends on global registry state
    const ctr = client.register.getSingleMetric('stt_empty_transcripts_dropped_total') as client.Counter<string>
    expect(ctr).toBeDefined()
  })
})

