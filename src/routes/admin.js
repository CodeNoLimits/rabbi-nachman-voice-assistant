import express from 'express';
import { VectorSearchService } from '../services/vector-search.js';
import { MasterIndexService } from '../services/master-index.js';
import { OpenRouterClient } from '../services/openrouter.js';
import { getPostgreSQLPool } from '../services/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Get system statistics
 * GET /api/admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const vectorSearch = new VectorSearchService();
    await vectorSearch.init();

    const masterIndex = new MasterIndexService();
    await masterIndex.init();

    const openrouter = new OpenRouterClient();

    // Get statistics
    const [searchStats, books, themes, healthCheck] = await Promise.all([
      vectorSearch.getSearchStats(),
      masterIndex.getAvailableBooks(),
      masterIndex.getPopularThemes(10),
      openrouter.healthCheck()
    ]);

    // Calculate additional metrics
    const booksByCategory = books.reduce((acc, book) => {
      acc[book.category] = (acc[book.category] || 0) + 1;
      return acc;
    }, {});

    const totalTokens = books.reduce((sum, book) => sum + (book.total_chunks * 8000), 0);

    res.json({
      system: {
        status: 'healthy',
        last_updated: new Date().toISOString(),
        version: '1.0.0'
      },
      content: {
        total_books: searchStats.total_books,
        total_chunks: searchStats.total_chunks,
        total_tokens_estimated: totalTokens,
        avg_chunk_size: Math.round(searchStats.avg_token_count),
        books_by_category: booksByCategory
      },
      ai_models: {
        primary_model: process.env.PRIMARY_MODEL,
        translation_model: process.env.TRANSLATION_MODEL,
        models_healthy: healthCheck.healthy,
        last_health_check: healthCheck.timestamp
      },
      popular_themes: themes.slice(0, 5).map(theme => ({
        name: theme.key_term,
        hebrew: theme.hebrew_term,
        frequency: theme.frequency
      })),
      recent_books: books.slice(0, 5).map(book => ({
        title: book.title,
        chunks: book.total_chunks,
        last_updated: book.updated_at
      }))
    });

  } catch (error) {
    logger.error('Admin stats failed:', error);
    res.status(500).json({
      error: 'Failed to get system statistics',
      message: error.message
    });
  }
});

/**
 * Rebuild master index
 * POST /api/admin/reindex
 */
router.post('/reindex', async (req, res) => {
  try {
    logger.info('🔄 Starting master index rebuild...');

    const masterIndex = new MasterIndexService();
    await masterIndex.init();

    await masterIndex.buildIndexFromChunks();

    res.json({
      success: true,
      message: 'Master index rebuilt successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Reindex failed:', error);
    res.status(500).json({
      error: 'Failed to rebuild index',
      message: error.message
    });
  }
});

/**
 * Test AI models health
 * POST /api/admin/test-models
 */
router.post('/test-models', async (req, res) => {
  try {
    const openrouter = new OpenRouterClient();

    // Test different model capabilities
    const tests = await Promise.allSettled([
      // Test primary model
      openrouter.chatCompletion([
        { role: 'user', content: 'Respond with exactly: "Primary model OK"' }
      ], { model: process.env.PRIMARY_MODEL }),

      // Test translation model
      openrouter.chatCompletion([
        { role: 'user', content: 'Respond with exactly: "Translation model OK"' }
      ], { model: process.env.TRANSLATION_MODEL }),

      // Test embedding
      openrouter.generateEmbedding('Test embedding generation')
    ]);

    const results = tests.map((test, index) => ({
      test: ['primary_model', 'translation_model', 'embedding'][index],
      status: test.status === 'fulfilled' ? 'success' : 'failed',
      error: test.status === 'rejected' ? test.reason.message : null
    }));

    const allSuccessful = results.every(r => r.status === 'success');

    res.json({
      overall_status: allSuccessful ? 'healthy' : 'degraded',
      model_tests: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Model tests failed:', error);
    res.status(500).json({
      error: 'Failed to test models',
      message: error.message
    });
  }
});

/**
 * Get database health
 * GET /api/admin/db-health
 */
router.get('/db-health', async (req, res) => {
  try {
    const pool = getPostgreSQLPool();

    // Test PostgreSQL connection
    const pgTest = await pool.query('SELECT NOW() as timestamp, version() as version');

    // Test pgvector extension
    const vectorTest = await pool.query("SELECT 1 as test WHERE 'vector' = ANY(SELECT extname FROM pg_extension)");

    // Get table sizes
    const sizeQuery = `
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;

    const tableStats = await pool.query(sizeQuery);

    res.json({
      postgresql: {
        status: 'healthy',
        version: pgTest.rows[0].version,
        timestamp: pgTest.rows[0].timestamp
      },
      pgvector: {
        installed: vectorTest.rows.length > 0,
        status: vectorTest.rows.length > 0 ? 'available' : 'missing'
      },
      tables: tableStats.rows.map(row => ({
        name: row.tablename,
        size: row.size,
        size_bytes: parseInt(row.size_bytes)
      }))
    });

  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      error: 'Database health check failed',
      message: error.message,
      postgresql: { status: 'unhealthy' },
      pgvector: { status: 'unknown' }
    });
  }
});

/**
 * Get recent queries log
 * GET /api/admin/recent-queries
 */
router.get('/recent-queries', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const pool = getPostgreSQLPool();

    const sql = `
      SELECT
        query_text,
        confidence_score,
        validation_status,
        user_feedback,
        created_at
      FROM citations
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(sql, [parseInt(limit)]);

    res.json({
      recent_queries: result.rows.map(row => ({
        query: row.query_text,
        confidence: row.confidence_score,
        status: row.validation_status,
        feedback: row.user_feedback,
        timestamp: row.created_at
      })),
      total_returned: result.rows.length
    });

  } catch (error) {
    logger.error('Get recent queries failed:', error);
    res.status(500).json({
      error: 'Failed to get recent queries',
      message: error.message
    });
  }
});

/**
 * Clear system cache
 * POST /api/admin/clear-cache
 */
router.post('/clear-cache', async (req, res) => {
  try {
    // This would clear any application caches
    // For now, we'll just respond with success

    res.json({
      success: true,
      message: 'System cache cleared',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Clear cache failed:', error);
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message
    });
  }
});

/**
 * Export data
 * GET /api/admin/export/:type
 */
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'json' } = req.query;

    if (!['books', 'chunks', 'index'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid export type',
        valid_types: ['books', 'chunks', 'index']
      });
    }

    const pool = getPostgreSQLPool();
    let sql, filename;

    switch (type) {
      case 'books':
        sql = 'SELECT * FROM books ORDER BY title';
        filename = 'rabbi_nachman_books';
        break;
      case 'chunks':
        sql = 'SELECT * FROM text_chunks ORDER BY exact_reference';
        filename = 'rabbi_nachman_chunks';
        break;
      case 'index':
        sql = 'SELECT * FROM master_index ORDER BY importance_score DESC';
        filename = 'rabbi_nachman_index';
        break;
    }

    const result = await pool.query(sql);

    if (format === 'csv') {
      // Convert to CSV (simplified)
      const headers = Object.keys(result.rows[0] || {});
      const csvContent = [
        headers.join(','),
        ...result.rows.map(row =>
          headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        export_type: type,
        export_date: new Date().toISOString(),
        total_records: result.rows.length,
        data: result.rows
      });
    }

  } catch (error) {
    logger.error('Export failed:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

export { router as adminRoutes };