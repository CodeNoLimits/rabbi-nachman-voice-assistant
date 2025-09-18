import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Configure multer for audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/webm'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio format. Supported: WAV, MP3, M4A, WebM'));
    }
  }
});

/**
 * Speech-to-Text endpoint
 * POST /api/voice/transcribe
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Audio file is required',
        supported_formats: ['WAV', 'MP3', 'M4A', 'WebM']
      });
    }

    logger.info(`🎤 Transcribing audio file: ${req.file.originalname} (${req.file.size} bytes)`);

    // Use OpenAI Whisper via OpenRouter for transcription
    const transcription = await transcribeAudio(req.file);

    res.json({
      transcription: transcription.text,
      language: transcription.language || 'fr',
      confidence: transcription.confidence || 0.9,
      duration: transcription.duration,
      processed_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Transcription failed:', error);
    res.status(500).json({
      error: 'Transcription failed',
      message: error.message
    });
  }
});

/**
 * Text-to-Speech endpoint
 * POST /api/voice/synthesize
 */
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voice = 'french-female', speed = 1.0 } = req.body;

    if (!text) {
      return res.status(400).json({
        error: 'Text is required for synthesis'
      });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        error: 'Text too long. Maximum 5000 characters.'
      });
    }

    logger.info(`🔊 Synthesizing speech for ${text.length} characters`);

    // Use ElevenLabs or OpenAI TTS
    const audioResult = await synthesizeSpeech(text, voice, speed);

    res.json({
      audio_url: audioResult.url,
      duration: audioResult.duration,
      voice_used: voice,
      speed: speed,
      text_length: text.length,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Speech synthesis failed:', error);
    res.status(500).json({
      error: 'Speech synthesis failed',
      message: error.message
    });
  }
});

/**
 * Get available voices
 * GET /api/voice/voices
 */
router.get('/voices', async (req, res) => {
  try {
    // List of available voices for TTS
    const voices = [
      {
        id: 'french-female',
        name: 'Claire (French Female)',
        language: 'fr-FR',
        gender: 'female',
        description: 'Natural French female voice'
      },
      {
        id: 'french-male',
        name: 'Henri (French Male)',
        language: 'fr-FR',
        gender: 'male',
        description: 'Natural French male voice'
      },
      {
        id: 'hebrew-female',
        name: 'Shira (Hebrew Female)',
        language: 'he-IL',
        gender: 'female',
        description: 'Natural Hebrew female voice'
      },
      {
        id: 'hebrew-male',
        name: 'David (Hebrew Male)',
        language: 'he-IL',
        gender: 'male',
        description: 'Natural Hebrew male voice'
      }
    ];

    res.json({
      voices,
      default_voice: 'french-female',
      supported_languages: ['fr-FR', 'he-IL'],
      max_text_length: 5000
    });

  } catch (error) {
    logger.error('Get voices failed:', error);
    res.status(500).json({
      error: 'Failed to get available voices',
      message: error.message
    });
  }
});

/**
 * Voice health check
 * GET /api/voice/health
 */
router.get('/health', async (req, res) => {
  try {
    // Test basic TTS functionality
    const testResult = await synthesizeSpeech('Bonjour', 'french-female', 1.0);

    res.json({
      status: 'healthy',
      services: {
        transcription: 'available',
        synthesis: 'available',
        voice_models: 'loaded'
      },
      test_synthesis: testResult ? 'success' : 'failed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Voice health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Helper functions
 */

async function transcribeAudio(audioFile) {
  try {
    // Option 1: Use OpenAI Whisper via OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      const formData = new FormData();
      formData.append('file', audioFile.buffer, {
        filename: audioFile.originalname,
        contentType: audioFile.mimetype
      });
      formData.append('model', 'whisper-1');
      formData.append('language', 'fr'); // Assume French input

      const response = await axios.post(
        'https://openrouter.ai/api/v1/audio/transcriptions',
        formData,
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            ...formData.getHeaders()
          },
          timeout: 30000
        }
      );

      return {
        text: response.data.text,
        language: response.data.language || 'fr',
        confidence: 0.9,
        duration: response.data.duration
      };
    }

    // Fallback: Mock transcription for development
    logger.warn('No transcription service configured, using mock');
    return {
      text: 'Qu\'est-ce que Rabbi Nachman dit sur la joie?',
      language: 'fr',
      confidence: 0.8,
      duration: 3.5
    };

  } catch (error) {
    logger.error('Audio transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

async function synthesizeSpeech(text, voice, speed) {
  try {
    // Option 1: Use ElevenLabs TTS
    if (process.env.ELEVENLABS_API_KEY) {
      const voiceMap = {
        'french-female': 'AZnzlk1XvdvUeBnXmlld', // Example voice ID
        'french-male': 'EXAVITQu4vr4xnSDxMaL',
        'hebrew-female': 'MF3mGyEYCl7XYWbV9V6O',
        'hebrew-male': 'TxGEqnHWrfWFTfGW9XjX'
      };

      const voiceId = voiceMap[voice] || voiceMap['french-female'];

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY
          },
          responseType: 'arraybuffer',
          timeout: 30000
        }
      );

      // In a real implementation, you'd save this to a file/storage and return URL
      const audioBase64 = Buffer.from(response.data).toString('base64');
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

      return {
        url: audioUrl,
        duration: Math.ceil(text.length / 150), // Rough estimate
        format: 'mp3'
      };
    }

    // Option 2: Use OpenAI TTS via OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/audio/speech',
        {
          model: 'tts-1',
          input: text,
          voice: 'alloy', // OpenAI voice
          speed: speed
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 30000
        }
      );

      const audioBase64 = Buffer.from(response.data).toString('base64');
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

      return {
        url: audioUrl,
        duration: Math.ceil(text.length / 150),
        format: 'mp3'
      };
    }

    // Fallback: Mock audio URL for development
    logger.warn('No TTS service configured, using mock audio URL');
    return {
      url: 'data:audio/mpeg;base64,mock-audio-data',
      duration: Math.ceil(text.length / 150),
      format: 'mp3'
    };

  } catch (error) {
    logger.error('Speech synthesis failed:', error);
    throw new Error(`TTS failed: ${error.message}`);
  }
}

export { router as voiceRoutes };