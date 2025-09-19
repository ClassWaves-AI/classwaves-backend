/**
 * Validate Whisper connectivity by posting a 1s silent WAV to /v1/audio/transcriptions.
 * Usage:
 *   OPENAI_API_KEY=sk-... ts-node src/scripts/validate-whisper.ts
 * Optional:
 *   OPENAI_WHISPER_TIMEOUT_MS=60000
 */
import axios from 'axios';
import FormData = require('form-data');
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

function makeSilentWav({ seconds = 1, sampleRate = 16000 }: { seconds?: number; sampleRate?: number }) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4; // ChunkSize
  buffer.write('WAVE', offset); offset += 4;

  // fmt subchunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, offset); offset += 2; // AudioFormat (1=PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2; // NumChannels
  buffer.writeUInt32LE(sampleRate, offset); offset += 4; // SampleRate
  buffer.writeUInt32LE(byteRate, offset); offset += 4; // ByteRate
  buffer.writeUInt16LE(blockAlign, offset); offset += 2; // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2; // BitsPerSample

  // data subchunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM silence (all zeros)
  // Buffer is pre-filled with zeros, so no need to write samples
  return buffer;
}

async function main() {
  const key = process.env.OPENAI_API_KEY || '';
  const timeout = Number(process.env.OPENAI_WHISPER_TIMEOUT_MS || 15000);
  if (!key) {
    logger.error('OPENAI_API_KEY is not set.');
    process.exit(1);
  }
  const wav = makeSilentWav({ seconds: 1, sampleRate: 16000 });
  const form = new FormData();
  form.append('file', wav, { filename: 'silence.wav', contentType: 'audio/wav' });
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  form.append('language', 'en');

  logger.debug('Posting 1s silent WAV to Whisper…');
  const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${key}`, ...form.getHeaders() },
    timeout,
    validateStatus: () => true,
  });

  logger.debug('HTTP', resp.status);
  if (resp.status >= 200 && resp.status < 300) {
    const text = (resp.data?.text || '').toString();
    logger.debug('OK. Text length:', text.length);
    logger.debug('Preview:', text.slice(0, 120));
    process.exit(0);
  }
  logger.error('Whisper error:', resp.status, resp.data?.error || resp.data);
  process.exit(2);
}

main().catch((e) => {
  logger.error('Script error:', e?.message || String(e));
  process.exit(3);
});
