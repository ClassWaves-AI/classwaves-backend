import { Router } from 'express';
import { audioUploadMulter, handleAudioWindowUpload } from '../controllers/audio.window.controller';
import { authenticateAudioUpload } from '../middleware/audio-upload.auth.middleware';

const router = Router();

// REST-first: authenticated upload of 10s audio windows
router.post('/window', authenticateAudioUpload, audioUploadMulter, handleAudioWindowUpload);

export default router;
