import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';

export interface TranscodeResult {
  buffer: Buffer;
  mime: string; // e.g., 'audio/wav'
}

// Real in-memory transcode to WAV (PCM 16kHz mono) using ffmpeg-static + fluent-ffmpeg
interface TranscodeOptions {
  force?: boolean;
}

export async function maybeTranscodeToWav(buf: Buffer, mime: string, options: TranscodeOptions = {}): Promise<TranscodeResult> {
  // If already WAV or transcode disabled, pass-through
  const wavAlready = mime?.toLowerCase().startsWith('audio/wav');
  const allowTranscode = options.force || (process.env.STT_TRANSCODE_TO_WAV === '1') || (process.env.WS_STT_TRANSCODE_TO_WAV === '1');
  if (wavAlready || !allowTranscode) {
    return { buffer: buf, mime };
  }

  // Prefer ffmpeg-static, but fall back to system ffmpeg if available
  const bin = (ffmpegPath as string) || process.env.FFMPEG_PATH || 'ffmpeg';

  // Hint input container to ffmpeg to stabilize fragment decoding
  const mt = (mime || '').toLowerCase();
  const inputFormat = mt.includes('webm') ? 'webm' : mt.includes('ogg') ? 'ogg' : '';
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    ...(inputFormat ? ['-f', inputFormat] : []),
    '-i', 'pipe:0',           // read input from stdin
    '-ac', '1',               // mono
    '-ar', '16000',           // 16 kHz
    '-acodec', 'pcm_s16le',   // 16-bit PCM
    '-f', 'wav',              // output format
    'pipe:1'                  // write output to stdout
  ];

  return await new Promise<TranscodeResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ buffer: Buffer.concat(chunks), mime: 'audio/wav' });
      } else {
        const errMsg = Buffer.concat(errChunks).toString() || `ffmpeg exited with code ${code}`;
        reject(new Error(errMsg));
      }
    });

    // Write input and close stdin
    try {
      child.stdin.write(buf);
      child.stdin.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}
