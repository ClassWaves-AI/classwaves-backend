import { Request, Response } from 'express';
import { audioController } from '../../../controllers/audio.controller';
import { databricksService } from '../../../services/databricks.service';
import { redisService } from '../../../services/redis.service';
import { whisperService } from '../../../services/whisper.service';
import {
  createMockRequest,
  createMockResponse,
  assertErrorResponse,
  assertSuccessResponse
} from '../../utils/test-helpers';

// Mock services
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service');
jest.mock('../../../services/whisper.service');
jest.mock('../../../queues/transcription.queue', () => ({
  transcriptionQueue: {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
  },
}));

// Mock multer
const mockMulter = {
  single: jest.fn(() => (req: any, res: any, next: any) => {
    req.file = {
      buffer: Buffer.from('mock audio data'),
      mimetype: 'audio/webm',
      size: 1024 * 50, // 50KB
      originalname: 'recording.webm',
    };
    next();
  }),
};
jest.mock('multer', () => {
  return jest.fn(() => mockMulter);
});

describe('Audio Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockRes = createMockResponse();
    jest.clearAllMocks();
  });

  describe('uploadAudio', () => {
    it('should upload audio successfully', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
          groupId: 'group-789',
          duration: 15.5,
        },
        file: {
          buffer: Buffer.from('mock audio data'),
          mimetype: 'audio/webm',
          size: 1024 * 50,
          originalname: 'recording.webm',
        } as any,
      });

      const mockRecordingId = 'recording-abc';
      const mockUploadUrl = 'https://storage.example.com/audio/recording-abc.webm';

      // Mock database operations
      (databricksService.query as jest.Mock)
        // Verify session exists and is active
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', status: 'active' }],
        })
        // Create recording record
        .mockResolvedValueOnce({
          rows: [{ 
            recording_id: mockRecordingId,
            storage_url: mockUploadUrl,
          }],
        });

      // Mock Redis cache for duplicate check
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      
      // Import transcription queue
      const { transcriptionQueue } = require('../../../queues/transcription.queue');

      await uploadAudio(mockReq as Request, mockRes as Response);

      // Verify duplicate check
      expect(redisService.get).toHaveBeenCalledWith(
        expect.stringContaining('audio:upload:student-456')
      );

      // Verify recording was saved
      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO main.classwaves.audio_recordings'),
        expect.objectContaining({
          session_id: 'session-123',
          student_id: 'student-456',
          group_id: 'group-789',
          duration_seconds: 15.5,
          file_size_bytes: 1024 * 50,
        })
      );

      // Verify transcription job was queued
      expect(transcriptionQueue.add).toHaveBeenCalledWith('transcribe', {
        recordingId: mockRecordingId,
        audioUrl: mockUploadUrl,
        sessionId: 'session-123',
        studentId: 'student-456',
      });

      // Verify duplicate prevention cache
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('audio:upload:student-456'),
        '1',
        5 // 5 second window
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        recordingId: mockRecordingId,
        status: 'uploaded',
        transcriptionJobId: 'job-123',
      });
    });

    it('should enforce file size limits', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
        },
        file: {
          buffer: Buffer.alloc(1024 * 1024 * 11), // 11MB (over 10MB limit)
          mimetype: 'audio/webm',
          size: 1024 * 1024 * 11,
        } as any,
      });

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'FILE_TOO_LARGE', 400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('10MB'),
        })
      );
    });

    it('should enforce audio duration limits', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
          duration: 65, // Over 60 second limit
        },
        file: {
          buffer: Buffer.from('mock audio'),
          mimetype: 'audio/webm',
          size: 1024 * 100,
        } as any,
      });

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'DURATION_TOO_LONG', 400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('60 seconds'),
        })
      );
    });

    it('should prevent duplicate uploads', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
          duration: 10,
        },
        file: {
          buffer: Buffer.from('mock audio'),
          mimetype: 'audio/webm',
          size: 1024 * 50,
        } as any,
      });

      // Mock Redis showing recent upload
      (redisService.get as jest.Mock).mockResolvedValueOnce('1');

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'DUPLICATE_UPLOAD', 429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('wait before uploading'),
        })
      );
    });

    it('should validate audio format', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
        },
        file: {
          buffer: Buffer.from('not audio'),
          mimetype: 'text/plain', // Invalid mime type
          size: 1024,
        } as any,
      });

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'INVALID_FILE_TYPE', 400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('audio file'),
          supportedTypes: expect.arrayContaining(['audio/webm', 'audio/mp4']),
        })
      );
    });

    it('should require file upload', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
        },
        // No file attached
      });

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'NO_FILE_UPLOADED', 400);
    });

    it('should verify session is active', async () => {
      mockReq = createMockRequest({
        body: {
          sessionId: 'session-123',
          studentId: 'student-456',
        },
        file: {
          buffer: Buffer.from('audio'),
          mimetype: 'audio/webm',
          size: 1024,
        } as any,
      });

      // Session is ended
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'session-123', status: 'ended' }],
      });

      await uploadAudio(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_ACTIVE', 400);
    });
  });

  describe('getTranscription', () => {
    it('should return completed transcription', async () => {
      const recordingId = 'recording-123';
      mockReq = createMockRequest({
        params: { recordingId },
      });

      const mockTranscription = {
        recording_id: recordingId,
        transcription_text: 'Hello, this is a test transcription.',
        confidence_score: 0.95,
        language_code: 'en-US',
        processing_time_ms: 1500,
        word_count: 6,
        status: 'completed',
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockTranscription],
      });

      await getTranscription(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        recordingId,
        text: mockTranscription.transcription_text,
        confidence: mockTranscription.confidence_score,
        language: mockTranscription.language_code,
        wordCount: mockTranscription.word_count,
        processingTime: mockTranscription.processing_time_ms,
        status: 'completed',
      });
    });

    it('should return pending status for processing transcriptions', async () => {
      const recordingId = 'recording-123';
      mockReq = createMockRequest({
        params: { recordingId },
      });

      // No transcription found yet
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      // Check if recording exists
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ recording_id: recordingId }],
      });

      await getTranscription(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        recordingId,
        status: 'processing',
        message: 'Transcription is still being processed',
      });
    });

    it('should return 404 for non-existent recording', async () => {
      const recordingId = 'non-existent';
      mockReq = createMockRequest({
        params: { recordingId },
      });

      // No transcription
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      // No recording either
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      await getTranscription(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'RECORDING_NOT_FOUND', 404);
    });

    it('should handle failed transcriptions', async () => {
      const recordingId = 'recording-123';
      mockReq = createMockRequest({
        params: { recordingId },
      });

      const mockTranscription = {
        recording_id: recordingId,
        status: 'failed',
        error_message: 'Audio quality too poor for transcription',
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockTranscription],
      });

      await getTranscription(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        recordingId,
        status: 'failed',
        error: mockTranscription.error_message,
      });
    });

    it('should use cache for completed transcriptions', async () => {
      const recordingId = 'recording-123';
      mockReq = createMockRequest({
        params: { recordingId },
      });

      const cachedTranscription = JSON.stringify({
        text: 'Cached transcription',
        confidence: 0.92,
        status: 'completed',
      });

      // Check cache first
      (redisService.get as jest.Mock).mockResolvedValueOnce(cachedTranscription);

      await getTranscription(mockReq as Request, mockRes as Response);

      // Should not query database
      expect(databricksService.query).not.toHaveBeenCalled();

      expect(mockRes.json).toHaveBeenCalledWith({
        recordingId,
        text: 'Cached transcription',
        confidence: 0.92,
        status: 'completed',
        cached: true,
      });
    });
  });
});