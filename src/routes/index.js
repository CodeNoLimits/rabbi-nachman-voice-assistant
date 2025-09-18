import express from 'express';
import { queryRoutes } from './query.js';
import { adminRoutes } from './admin.js';
import { voiceRoutes } from './voice.js';

const router = express.Router();

/**
 * Setup all application routes
 */
export function setupRoutes(app) {
  // API health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: 'Rabbi Nachman Voice Assistant API',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Main query routes
  app.use('/api/query', queryRoutes);

  // Admin routes
  app.use('/api/admin', adminRoutes);

  // Voice processing routes
  app.use('/api/voice', voiceRoutes);

  // Documentation route
  app.get('/api/docs', (req, res) => {
    res.json({
      title: 'Rabbi Nachman Voice Assistant API',
      description: 'Ultra-precise voice assistant for exploring ALL teachings of Rabbi Nachman de Breslov',
      endpoints: {
        'POST /api/query/ask': 'Ask a question in French',
        'POST /api/query/search': 'Advanced text search',
        'GET /api/query/books': 'List available books',
        'POST /api/voice/transcribe': 'Speech-to-text',
        'POST /api/voice/synthesize': 'Text-to-speech',
        'GET /api/admin/stats': 'System statistics',
        'POST /api/admin/reindex': 'Rebuild search index'
      },
      architecture: {
        database: 'PostgreSQL + pgvector',
        ai_models: ['Gemini 2.0 Flash', 'Claude 3.5 Sonnet'],
        voice: 'ElevenLabs TTS + Whisper STT',
        data_source: 'Sefaria.org'
      }
    });
  });

  // Catch-all route
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      available_endpoints: [
        'GET /health',
        'GET /api/docs',
        'POST /api/query/ask',
        'POST /api/voice/transcribe'
      ]
    });
  });
}