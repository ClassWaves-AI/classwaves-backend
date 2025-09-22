import type { SpeechToTextPort } from './stt.port';
import { openAIWhisperService } from './openai-whisper.service';
import { speechmaticsSttAdapter } from '../adapters/stt.speechmatics';
import { logger } from '../utils/logger';

const disabledProvider: SpeechToTextPort = {
  async transcribeBuffer(_buf, _mime, options) {
    logger.warn('stt.provider.disabled_invoked');
    return { text: '', duration: options?.durationSeconds };
  },
};

let overrideProvider: SpeechToTextPort | undefined;

export function setSttProviderOverride(provider: SpeechToTextPort): void {
  overrideProvider = provider;
}

export function clearSttProviderOverride(): void {
  overrideProvider = undefined;
}

export function getSttProvider(): SpeechToTextPort {
  if (overrideProvider) {
    return overrideProvider;
  }

  const provider = (process.env.STT_PROVIDER || '').trim().toLowerCase();

  switch (provider) {
    case 'speechmatics':
      return speechmaticsSttAdapter;
    case 'off':
    case 'disabled':
      return disabledProvider;
    case 'openai':
    case '':
      return openAIWhisperService;
    default:
      logger.warn('stt.provider.unknown_provider', { provider });
      return openAIWhisperService;
  }
}

