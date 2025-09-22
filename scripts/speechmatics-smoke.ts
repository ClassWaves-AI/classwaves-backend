import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { speechmaticsSttAdapter } from '../src/adapters/stt.speechmatics';

function createSineWav(durationSeconds = 1, frequency = 440, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const headerSize = 44;
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  const writeString = (str: string) => {
    buffer.write(str, offset, str.length, 'ascii');
    offset += str.length;
  };

  const writeUInt32LE = (value: number) => {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  };

  const writeUInt16LE = (value: number) => {
    buffer.writeUInt16LE(value, offset);
    offset += 2;
  };

  // RIFF header
  writeString('RIFF');
  writeUInt32LE(headerSize + dataSize - 8); // file size - 8
  writeString('WAVE');

  // fmt chunk
  writeString('fmt ');
  writeUInt32LE(16); // PCM chunk size
  writeUInt16LE(1); // PCM format
  writeUInt16LE(1); // mono
  writeUInt32LE(sampleRate);
  writeUInt32LE(sampleRate * 2); // byte rate
  writeUInt16LE(2); // block align
  writeUInt16LE(16); // bits per sample

  // data chunk
  writeString('data');
  writeUInt32LE(dataSize);

  const amplitude = 32760;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
    buffer.writeInt16LE(sample, headerSize + i * 2);
  }

  return buffer;
}

async function main(): Promise<void> {
  if (process.env.STT_FORCE_MOCK === '1') {
    throw new Error('STT_FORCE_MOCK is enabled; disable it for real Speechmatics smoke test.');
  }
  if (!process.env.SPEECHMATICS_API_KEY) {
    throw new Error('SPEECHMATICS_API_KEY is not set.');
  }

  let wav: Buffer;
  const customFile = process.env.SPEECHMATICS_SMOKE_FILE;
  if (customFile) {
    const abs = path.resolve(customFile);
    wav = fs.readFileSync(abs);
    console.log(`Loaded smoke audio from ${abs} (${wav.length} bytes)`);
  } else {
    wav = createSineWav(1.2, 440);
  }
  const options = {
    durationSeconds: undefined,
    language: (process.env.STT_LANGUAGE_HINT || 'en') as string,
  };

  const result = await speechmaticsSttAdapter.transcribeBuffer(wav, 'audio/wav', options, 'smoke-school');
  console.log(JSON.stringify({ text: result.text, duration: result.duration, language: result.language }, null, 2));
}

main().catch((err) => {
  if (err && typeof err === 'object' && 'response' in (err as any)) {
    console.error('Speechmatics smoke test failed:', (err as any).response);
  } else {
    console.error('Speechmatics smoke test failed:', err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
