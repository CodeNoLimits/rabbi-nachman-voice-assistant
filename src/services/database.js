import pg from 'pg';
import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// PostgreSQL connection for vector storage
let pgPool = null;

// MongoDB connection for Sefaria data
let mongoClient = null;
let mongoDB = null;

/**
 * Initialize PostgreSQL connection with pgvector extension
 */
async function initializePostgreSQL() {
  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await pgPool.connect();

    // Enable pgvector extension (temporarily disabled for initial setup)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('pgvector extension enabled');
    } catch (error) {
      logger.warn('pgvector extension not available, using basic setup');
    }

    // Create tables
    await createTables(client);

    client.release();
    logger.info('PostgreSQL connected and tables created');

    return pgPool;
  } catch (error) {
    logger.error('PostgreSQL connection failed:', error);
    throw error;
  }
}

/**
 * Initialize MongoDB connection for Sefaria data
 */
async function initializeMongoDB() {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URL);
    await mongoClient.connect();
    mongoDB = mongoClient.db('sefaria_data');

    logger.info('MongoDB connected for Sefaria data');
    return mongoDB;
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    throw error;
  }
}

/**
 * Create necessary tables for the vector database
 */
async function createTables(client) {
  // Books table for metadata
  await client.query(`
    CREATE TABLE IF NOT EXISTS books (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      hebrew_title TEXT,
      sefaria_ref TEXT UNIQUE,
      category TEXT,
      total_chunks INTEGER DEFAULT 0,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Text chunks table with vector embeddings
  await client.query(`
    CREATE TABLE IF NOT EXISTS text_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id UUID REFERENCES books(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      hebrew_text TEXT,
      exact_reference TEXT NOT NULL,
      section_title TEXT,
      paragraph_number INTEGER,
      token_count INTEGER,
      chunk_summary TEXT,
      themes TEXT[],
      keywords TEXT[],
      embedding TEXT, -- Temporary: will be vector(1536) when pgvector is ready
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Master index table for ultra-fast routing
  await client.query(`
    CREATE TABLE IF NOT EXISTS master_index (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      index_type TEXT NOT NULL, -- 'theme', 'person', 'place', 'concept'
      key_term TEXT NOT NULL,
      hebrew_term TEXT,
      related_chunks UUID[],
      book_references TEXT[],
      frequency INTEGER DEFAULT 1,
      importance_score FLOAT DEFAULT 0.5,
      cross_references JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Citations validation table
  await client.query(`
    CREATE TABLE IF NOT EXISTS citations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      query_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      cited_chunks UUID[],
      confidence_score FLOAT,
      validation_status TEXT DEFAULT 'pending', -- 'pending', 'verified', 'invalid'
      user_feedback INTEGER, -- 1-5 rating
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Create optimized indexes (vector index temporarily disabled)
  // await client.query(`
  //   CREATE INDEX IF NOT EXISTS idx_text_chunks_embedding
  //   ON text_chunks USING hnsw (embedding vector_cosine_ops)
  // `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_text_chunks_reference
    ON text_chunks(exact_reference)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_text_chunks_themes
    ON text_chunks USING gin(themes)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_master_index_key
    ON master_index(key_term, index_type)
  `);

  logger.info('Database tables and indexes created successfully');
}

/**
 * Get PostgreSQL pool
 */
export function getPostgreSQLPool() {
  if (!pgPool) {
    throw new Error('PostgreSQL not initialized. Call initializeDatabase() first.');
  }
  return pgPool;
}

/**
 * Get MongoDB database
 */
export function getMongoDB() {
  if (!mongoDB) {
    throw new Error('MongoDB not initialized. Call initializeDatabase() first.');
  }
  return mongoDB;
}

/**
 * Initialize all database connections
 */
export async function initializeDatabase() {
  await initializePostgreSQL();

  // Try MongoDB, but don't fail if it's not available
  try {
    await initializeMongoDB();
  } catch (error) {
    logger.warn('MongoDB not available, continuing with PostgreSQL only');
  }

  logger.info('🗄️ Database initialization completed');
}

/**
 * Close all database connections
 */
export async function closeConnections() {
  if (pgPool) {
    await pgPool.end();
    logger.info('PostgreSQL connection closed');
  }

  if (mongoClient) {
    await mongoClient.close();
    logger.info('MongoDB connection closed');
  }
}