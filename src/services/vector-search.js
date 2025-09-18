import { getPostgreSQLPool } from './database.js';
import { OpenRouterClient } from './openrouter.js';
import { logger } from '../utils/logger.js';

/**
 * Vector search service using PostgreSQL + pgvector
 */
class VectorSearchService {
  constructor() {
    this.pool = null;
    this.openrouter = new OpenRouterClient();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    this.pool = getPostgreSQLPool();
    this.initialized = true;
    logger.info('🔍 Vector search service initialized');
  }

  /**
   * Search for similar text chunks using vector similarity
   */
  async search(query, limit = 10, filters = {}) {
    if (!this.initialized) await this.init();

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.openrouter.generateEmbedding(query);

      // Build SQL query with filters
      let sql = `
        SELECT
          tc.id,
          tc.content,
          tc.hebrew_text,
          tc.exact_reference,
          tc.section_title,
          tc.token_count,
          tc.chunk_summary,
          tc.themes,
          tc.keywords,
          tc.metadata,
          b.title as book_title,
          b.hebrew_title,
          b.category,
          (tc.embedding <=> $1::vector) as distance,
          (1 - (tc.embedding <=> $1::vector)) as score
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
      `;

      const params = [JSON.stringify(queryEmbedding)];
      let paramIndex = 2;

      // Add filters
      const conditions = [];

      if (filters.books && filters.books.length > 0) {
        conditions.push(`b.title = ANY($${paramIndex})`);
        params.push(filters.books);
        paramIndex++;
      }

      if (filters.themes && filters.themes.length > 0) {
        conditions.push(`tc.themes && $${paramIndex}`);
        params.push(filters.themes);
        paramIndex++;
      }

      if (filters.minScore) {
        conditions.push(`(1 - (tc.embedding <=> $1::vector)) >= $${paramIndex}`);
        params.push(filters.minScore);
        paramIndex++;
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ` ORDER BY tc.embedding <=> $1::vector LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.pool.query(sql, params);

      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        hebrew_text: row.hebrew_text,
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        token_count: row.token_count,
        chunk_summary: row.chunk_summary,
        themes: row.themes || [],
        keywords: row.keywords || [],
        book_title: row.book_title,
        hebrew_title: row.hebrew_title,
        category: row.category,
        score: parseFloat(row.score),
        distance: parseFloat(row.distance),
        metadata: row.metadata
      }));

    } catch (error) {
      logger.error('Vector search failed:', error);
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  /**
   * Get a specific chunk by reference
   */
  async getChunkByReference(reference) {
    if (!this.initialized) await this.init();

    try {
      const sql = `
        SELECT
          tc.*,
          b.title as book_title,
          b.hebrew_title,
          b.category
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
        WHERE tc.exact_reference = $1
      `;

      const result = await this.pool.query(sql, [reference]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        content: row.content,
        hebrew_text: row.hebrew_text,
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        token_count: row.token_count,
        chunk_summary: row.chunk_summary,
        themes: row.themes || [],
        keywords: row.keywords || [],
        book_title: row.book_title,
        hebrew_title: row.hebrew_title,
        category: row.category,
        metadata: row.metadata
      };

    } catch (error) {
      logger.error('Get chunk by reference failed:', error);
      throw new Error(`Failed to get chunk: ${error.message}`);
    }
  }

  /**
   * Get context around a specific chunk (previous and next chunks)
   */
  async getChunkContext(chunkId, contextSize = 2) {
    if (!this.initialized) await this.init();

    try {
      // First get the target chunk
      const targetResult = await this.pool.query(
        'SELECT book_id, chunk_index FROM text_chunks WHERE id = $1',
        [chunkId]
      );

      if (targetResult.rows.length === 0) {
        return null;
      }

      const { book_id, chunk_index } = targetResult.rows[0];

      // Get surrounding chunks
      const sql = `
        SELECT
          tc.*,
          b.title as book_title
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
        WHERE tc.book_id = $1
        AND tc.chunk_index BETWEEN $2 AND $3
        ORDER BY tc.chunk_index
      `;

      const minIndex = Math.max(0, chunk_index - contextSize);
      const maxIndex = chunk_index + contextSize;

      const result = await this.pool.query(sql, [book_id, minIndex, maxIndex]);

      return {
        target_chunk_id: chunkId,
        context_chunks: result.rows.map(row => ({
          id: row.id,
          content: row.content,
          exact_reference: row.exact_reference,
          chunk_index: row.chunk_index,
          is_target: row.id === chunkId
        }))
      };

    } catch (error) {
      logger.error('Get chunk context failed:', error);
      throw new Error(`Failed to get context: ${error.message}`);
    }
  }

  /**
   * Store a chunk with its vector embedding
   */
  async storeChunk(chunk) {
    if (!this.initialized) await this.init();

    try {
      // Generate embedding for the chunk content
      const embedding = await this.openrouter.generateEmbedding(chunk.content);

      const sql = `
        INSERT INTO text_chunks (
          id, book_id, chunk_index, content, hebrew_text, exact_reference,
          section_title, paragraph_number, token_count, chunk_summary,
          themes, keywords, embedding, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
      `;

      const params = [
        chunk.id,
        chunk.book_id,
        chunk.chunk_index,
        chunk.content,
        chunk.hebrew_text,
        chunk.exact_reference,
        chunk.section_title,
        chunk.paragraph_number,
        chunk.token_count,
        chunk.chunk_summary,
        chunk.themes,
        chunk.keywords,
        JSON.stringify(embedding),
        chunk.metadata
      ];

      await this.pool.query(sql, params);

      logger.debug(`✅ Stored chunk ${chunk.exact_reference}`);

    } catch (error) {
      logger.error('Store chunk failed:', error);
      throw new Error(`Failed to store chunk: ${error.message}`);
    }
  }

  /**
   * Store multiple chunks in batch
   */
  async storeChunksBatch(chunks) {
    if (!this.initialized) await this.init();

    logger.info(`📥 Storing ${chunks.length} chunks in batch...`);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (let i = 0; i < chunks.length; i++) {
        await this.storeChunkWithClient(client, chunks[i]);

        if ((i + 1) % 10 === 0) {
          logger.info(`📝 Stored ${i + 1}/${chunks.length} chunks`);
        }
      }

      await client.query('COMMIT');
      logger.info(`✅ Successfully stored ${chunks.length} chunks`);

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Batch storage failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Store chunk using existing database client (for transactions)
   */
  async storeChunkWithClient(client, chunk) {
    // Generate embedding for the chunk content
    const embedding = await this.openrouter.generateEmbedding(chunk.content);

    const sql = `
      INSERT INTO text_chunks (
        id, book_id, chunk_index, content, hebrew_text, exact_reference,
        section_title, paragraph_number, token_count, chunk_summary,
        themes, keywords, embedding, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
    `;

    const params = [
      chunk.id,
      chunk.book_id,
      chunk.chunk_index,
      chunk.content,
      chunk.hebrew_text,
      chunk.exact_reference,
      chunk.section_title,
      chunk.paragraph_number,
      chunk.token_count,
      chunk.chunk_summary,
      chunk.themes,
      chunk.keywords,
      JSON.stringify(embedding),
      chunk.metadata
    ];

    await client.query(sql, params);
  }

  /**
   * Find similar chunks to a given chunk
   */
  async findSimilarChunks(chunkId, limit = 5) {
    if (!this.initialized) await this.init();

    try {
      const sql = `
        WITH target_chunk AS (
          SELECT embedding FROM text_chunks WHERE id = $1
        )
        SELECT
          tc.id,
          tc.content,
          tc.exact_reference,
          tc.section_title,
          b.title as book_title,
          (tc.embedding <=> target_chunk.embedding) as distance,
          (1 - (tc.embedding <=> target_chunk.embedding)) as score
        FROM text_chunks tc, target_chunk
        JOIN books b ON tc.book_id = b.id
        WHERE tc.id != $1
        ORDER BY tc.embedding <=> target_chunk.embedding
        LIMIT $2
      `;

      const result = await this.pool.query(sql, [chunkId, limit]);

      return result.rows.map(row => ({
        id: row.id,
        content: row.content.substring(0, 200) + '...',
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        book_title: row.book_title,
        score: parseFloat(row.score),
        distance: parseFloat(row.distance)
      }));

    } catch (error) {
      logger.error('Find similar chunks failed:', error);
      throw new Error(`Failed to find similar chunks: ${error.message}`);
    }
  }

  /**
   * Get search statistics
   */
  async getSearchStats() {
    if (!this.initialized) await this.init();

    try {
      const sql = `
        SELECT
          COUNT(*) as total_chunks,
          COUNT(DISTINCT book_id) as total_books,
          AVG(token_count) as avg_token_count,
          MAX(token_count) as max_token_count,
          MIN(token_count) as min_token_count
        FROM text_chunks
      `;

      const result = await this.pool.query(sql);

      return {
        total_chunks: parseInt(result.rows[0].total_chunks),
        total_books: parseInt(result.rows[0].total_books),
        avg_token_count: parseFloat(result.rows[0].avg_token_count),
        max_token_count: parseInt(result.rows[0].max_token_count),
        min_token_count: parseInt(result.rows[0].min_token_count)
      };

    } catch (error) {
      logger.error('Get search stats failed:', error);
      return {
        total_chunks: 0,
        total_books: 0,
        avg_token_count: 0,
        max_token_count: 0,
        min_token_count: 0
      };
    }
  }
}

export { VectorSearchService };