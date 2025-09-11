declare module 'ffmpeg-static' {
  const pathToFfmpeg: string | null;
  export default pathToFfmpeg;
}

declare module 'fluent-ffmpeg' {
  import { Writable } from 'stream';
  interface FfmpegCommand {
    input(src: any): FfmpegCommand;
    inputFormat(fmt?: string): FfmpegCommand;
    audioChannels(n: number): FfmpegCommand;
    audioFrequency(n: number): FfmpegCommand;
    audioCodec(codec: string): FfmpegCommand;
    format(fmt: string): FfmpegCommand;
    on(event: 'error', cb: (err: any) => void): FfmpegCommand;
    on(event: 'end', cb: () => void): FfmpegCommand;
    on(event: string, cb: (...args: any[]) => void): FfmpegCommand;
    pipe(stream: Writable, opts?: { end?: boolean }): Writable;
  }
  function ffmpeg(input?: any): FfmpegCommand;
  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
  }
  export = ffmpeg;
}

