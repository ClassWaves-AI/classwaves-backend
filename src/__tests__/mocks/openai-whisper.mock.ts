import { jest } from '@jest/globals';

export type WhisperStep = 'success' | '429' | '500' | 'timeout';

export interface WhisperMockResult {
  text: string;
  confidence?: number;
  language?: string;
  duration?: number;
}

export function makeTranscribeSequence(
  sequence: WhisperStep[],
  finalText: string = 'mock transcription',
  perCallDelayMs: number = 0
) {
  let callIndex = 0;
  return jest.fn(async (_buf: Buffer, _mime: string) => {
    const step: WhisperStep = sequence[Math.min(callIndex, sequence.length - 1)] || 'success';
    callIndex += 1;
    if (perCallDelayMs > 0) {
      await new Promise((r) => setTimeout(r, perCallDelayMs));
    }
    if (step === 'success') {
      const result: WhisperMockResult = { text: finalText, confidence: 0.9, language: 'en', duration: 0 };
      return result;
    }
    if (step === '429') {
      const err: any = new Error('Retryable Whisper error: 429');
      err.status = 429;
      throw err;
    }
    if (step === '500') {
      const err: any = new Error('Retryable Whisper error: 500');
      err.status = 500;
      throw err;
    }
    if (step === 'timeout') {
      throw new Error('timeout');
    }
    return { text: finalText } as WhisperMockResult;
  });
}

export function mockOpenAIWhisperServiceFactory(
  sequence: WhisperStep[] = ['success'],
  finalText: string = 'mock transcription',
  perCallDelayMs: number = 0
) {
  const transcribeBuffer = makeTranscribeSequence(sequence, finalText, perCallDelayMs);
  return {
    transcribeBuffer,
    setApiKey: jest.fn(),
    verifyCredentials: jest.fn(() => Promise.resolve(true)),
  };
}


