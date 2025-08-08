import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

interface WhisperResponse {
  text: string;
  language: string;
  segments: WhisperSegment[];
  confidence: number;
}

class WhisperService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor() {
    // Using OpenAI's Whisper API
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.apiUrl = 'https://api.openai.com/v1/audio/transcriptions';
    this.model = 'whisper-1';

    if (!this.apiKey) {
      console.warn('OpenAI API key not configured. Whisper transcription will use mock data.');
    }
  }

  async transcribe(audioFilePath: string): Promise<WhisperResponse> {
    try {
      // If no API key, return mock transcription for development
      if (!this.apiKey) {
        return this.getMockTranscription();
      }

      // Create form data with audio file
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioFilePath));
      formData.append('model', this.model);
      formData.append('response_format', 'verbose_json');
      formData.append('language', 'en'); // Force English for better accuracy

      // Make API request
      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 30000 // 30 seconds timeout
      });

      const data = response.data;

      // Calculate average confidence from segments
      const avgConfidence = data.segments?.length > 0
        ? data.segments.reduce((sum: number, seg: WhisperSegment) => 
            sum + (1 - seg.no_speech_prob), 0) / data.segments.length
        : 0.95;

      return {
        text: data.text || '',
        language: data.language || 'en',
        segments: data.segments || [],
        confidence: avgConfidence
      };
    } catch (error) {
      console.error('Whisper transcription error', error);
      
      // Return mock transcription on error for development
      if (process.env.NODE_ENV === 'development') {
        return this.getMockTranscription();
      }
      
      throw new Error('Failed to transcribe audio');
    }
  }

  private getMockTranscription(): WhisperResponse {
    // Mock transcriptions for testing
    const mockTranscriptions = [
      "I think the main character in the story is really brave because she stood up to the bully even though she was scared.",
      "Can you repeat the question please? I didn't hear it clearly.",
      "The answer to number three is photosynthesis. Plants use sunlight to make their own food.",
      "I agree with Sarah. The experiment shows that water evaporates faster when it's heated.",
      "My favorite part was when they discovered the hidden treasure map in the old library.",
      "I'm not sure about this problem. Can someone help me understand how to solve it?",
      "We should add more details to our presentation about the solar system.",
      "I think we need to work together better as a group. Let's divide the tasks equally."
    ];

    const text = mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];

    return {
      text,
      language: 'en',
      segments: [{
        id: 0,
        seek: 0,
        start: 0,
        end: 5,
        text,
        tokens: [],
        temperature: 0,
        avg_logprob: -0.2,
        compression_ratio: 1.2,
        no_speech_prob: 0.05
      }],
      confidence: 0.95
    };
  }

  /**
   * Transcribe audio with retry logic
   */
  async transcribeWithRetry(audioFilePath: string, maxRetries = 3): Promise<WhisperResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.transcribe(audioFilePath);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Whisper transcription attempt ${attempt} failed`, { error });
        
        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError || new Error('Failed to transcribe audio after retries');
  }

  /**
   * Check if Whisper service is available
   */
  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) {
      return true; // Mock mode is always "healthy"
    }

    try {
      await axios.get('https://api.openai.com/v1/models/whisper-1', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 5000
      });
      return true;
    } catch (error) {
      console.error('Whisper health check failed', error);
      return false;
    }
  }
}

// Export singleton instance
export const whisperService = new WhisperService();