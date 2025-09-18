import dotenv from 'dotenv';
import { initializeDatabase, closeConnections } from '../src/services/database.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Setup script to initialize the database with sample data
 */
async function setupDatabase() {
  logger.info('🚀 Starting database setup...');

  try {
    // Initialize database connections and create tables
    await initializeDatabase();

    logger.info('✅ Database setup completed successfully!');
    logger.info('📋 Next steps:');
    logger.info('   1. Run: npm run extract-data (to extract Rabbi Nachman texts)');
    logger.info('   2. Run: npm run chunk-texts (to process and chunk the texts)');
    logger.info('   3. Run: npm run build-index (to build the master index)');
    logger.info('   4. Run: npm start (to start the server)');

  } catch (error) {
    logger.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    await closeConnections();
  }
}

// Run setup
setupDatabase();