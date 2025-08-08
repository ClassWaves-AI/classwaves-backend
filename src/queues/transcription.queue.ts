import { Queue, Worker, Job } from 'bullmq';
import { redisService } from '../services/redis.service';
import Redis from 'ioredis';
import { whisperService } from '../services/whisper.service';
import { websocketService } from '../services/websocket.service';
import { insightService } from '../services/insight.service';
import fs from 'fs/promises';

// Create BullMQ-compatible Redis connection
const bullMQConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || 'classwaves-redis-pass',
  maxRetriesPerRequest: null, // Required by BullMQ
});

interface TranscriptionJobData {
  audio_id: string;
  session_id: string;
  participant_id: string;
  group_id?: string;
  file_path: string;
  duration: number;
  timestamp: string;
}

// Create queue
export const transcriptionQueue = new Queue('transcription', {
  connection: bullMQConnection,
  defaultJobOptions: {
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 3600 // Keep for 24 hours
    },
    removeOnFail: {
      count: 50, // Keep last 50 failed jobs
      age: 7 * 24 * 3600 // Keep for 7 days
    }
  }
});

// Create worker
const transcriptionWorker = new Worker(
  'transcription',
  async (job: Job<TranscriptionJobData>) => {
    const { audio_id, session_id, participant_id, file_path } = job.data;
    
    console.info('Processing transcription job', { audio_id, session_id });

    try {
      // Update status to processing
      await updateAudioStatus(audio_id, 'processing');

      // Transcribe audio using Whisper service
      const transcription = await whisperService.transcribe(file_path);

      // Save transcription result
      const transcriptionRecord = {
        id: audio_id,
        session_id,
        participant_id,
        group_id: job.data.group_id,
        text: transcription.text,
        language: transcription.language,
        confidence: transcription.confidence,
        segments: transcription.segments,
        status: 'completed',
        created_at: new Date().toISOString()
      };

      // Store in Redis
      await redisService.getClient().setex(
        `transcription:${audio_id}`,
        86400, // 24 hours
        JSON.stringify(transcriptionRecord)
      );

      // Update audio status
      await updateAudioStatus(audio_id, 'transcribed');

      // Emit real-time transcription event
      if (websocketService.io) {
        websocketService.io.to(`session:${session_id}`).emit('transcription:group:new', {
          id: audio_id,
          groupId: job.data.group_id || 'unknown',
          groupName: 'Unknown Group', // TODO: Fetch group name from database
          text: transcription.text,
          timestamp: job.data.timestamp,
          confidence: transcription.confidence || 0.95
        });
      }

      // Generate insights based on transcription (only if group_id is available)
      if (job.data.group_id) {
        const insights = await insightService.analyzeGroupTranscription({
          text: transcription.text,
          session_id,
          group_id: job.data.group_id
        });

        // Emit insights
        for (const insight of insights) {
          if (websocketService.io) {
            // Map insight types to frontend-expected types
            const mapInsightType = (type: string) => {
              switch (type) {
                case 'conceptual_density': return 'conceptual_understanding';
                case 'topical_cohesion': return 'topical_focus';
                case 'sentiment_arc': return 'collaboration_patterns';
                case 'argumentation_quality': return 'argumentation_quality';
                default: return 'argumentation_quality';
              }
            };

            websocketService.io.to(`session:${session_id}`).emit('insight:group:new', {
              groupId: job.data.group_id,
              insightType: mapInsightType(insight.type),
              message: insight.message,
              severity: insight.severity,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // Clean up audio file
      try {
        await fs.unlink(file_path);
      } catch (err) {
        console.warn('Failed to delete audio file after transcription', { file_path, error: err });
      }

      console.info('Transcription completed', { audio_id, text_length: transcription.text.length });

      return transcriptionRecord;
    } catch (error) {
      console.error('Transcription failed', { audio_id, error });
      await updateAudioStatus(audio_id, 'failed');
      throw error;
    }
  },
  {
    connection: bullMQConnection,
    concurrency: 5, // Process up to 5 transcriptions in parallel
  }
);

// Helper functions
async function updateAudioStatus(audioId: string, status: string) {
  const recordJson = await redisService.getClient().get(`audio:${audioId}`);
  if (recordJson) {
    const record = JSON.parse(recordJson);
    record.status = status;
    await redisService.getClient().setex(`audio:${audioId}`, 86400, JSON.stringify(record));
  }
}

async function getParticipantName(participantId: string): Promise<string> {
  // Get participant info from Redis session data
  const participantJson = await redisService.getClient().get(`participant:${participantId}`);
  if (participantJson) {
    const participant = JSON.parse(participantJson);
    return participant.name || 'Unknown Student';
  }
  return 'Unknown Student';
}

// Event listeners
transcriptionWorker.on('completed', (job: Job) => {
  console.info('Transcription job completed', { jobId: job.id, audioId: job.data.audio_id });
});

transcriptionWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error('Transcription job failed', { jobId: job?.id, error: err });
});

// Export worker for graceful shutdown
export { transcriptionWorker };