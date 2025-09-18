import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initializeDatabase } from './services/database.js';
import { setupRoutes } from './routes/index.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/static', express.static(join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Rabbi Nachman Voice Assistant',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Initialize services and routes
async function startServer() {
  try {
    // Initialize database connections
    await initializeDatabase();
    logger.info('Database initialized successfully');

    // Setup API routes
    setupRoutes(app);
    logger.info('Routes configured');

    // Start server
    app.listen(PORT, () => {
      logger.info(`🎭 Rabbi Nachman Voice Assistant running on port ${PORT}`);
      logger.info(`📚 Ready to answer questions about ALL Rabbi Nachman teachings`);
      logger.info(`🔍 Ultra-precise citations with vector search enabled`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the application
startServer().catch(error => {
  logger.error('Startup error:', error);
  process.exit(1);
});