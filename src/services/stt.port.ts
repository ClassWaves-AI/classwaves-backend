export interface SpeechToTextPort {
  transcribeBuffer(
    buf: Buffer,
    mime: string,
    options?: { durationSeconds?: number; language?: string },
    schoolId?: string
  ): Promise<{ text: string; confidence?: number; language?: string; duration?: number }>;
}

