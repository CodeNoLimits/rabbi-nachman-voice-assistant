import { getPostgreSQLPool } from './database.js';
import { logger } from '../utils/logger.js';

/**
 * Master Index Service for ultra-fast routing and theme-based search
 */
class MasterIndexService {
  constructor() {
    this.pool = null;
    this.initialized = false;
    this.indexCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async init() {
    if (this.initialized) return;

    this.pool = getPostgreSQLPool();
    await this.buildCacheFromDatabase();
    this.initialized = true;
    logger.info('📇 Master index service initialized');
  }

  /**
   * Search master index for quick routing
   */
  async search(queryAnalysis) {
    if (!this.initialized) await this.init();

    const results = [];

    // Search by themes
    for (const theme of queryAnalysis.themes) {
      const themeResults = await this.searchByTerm(theme, 'theme');
      results.push(...themeResults);
    }

    // Search by suspected books
    for (const book of queryAnalysis.suspected_books) {
      const bookResults = await this.searchByBook(book);
      results.push(...bookResults);
    }

    // Search by key terms
    for (const term of queryAnalysis.key_terms || []) {
      const termResults = await this.searchByTerm(term, 'concept');
      results.push(...termResults);
    }

    // Deduplicate and sort by importance
    const uniqueResults = this.deduplicateResults(results);
    return this.sortByImportance(uniqueResults);
  }

  /**
   * Search by specific themes
   */
  async searchByThemes(themes) {
    if (!this.initialized) await this.init();

    const results = [];

    for (const theme of themes) {
      const themeResults = await this.searchByTerm(theme, 'theme');
      results.push(...themeResults);
    }

    return this.deduplicateResults(results);
  }

  /**
   * Search by specific term and type
   */
  async searchByTerm(term, indexType = null) {
    try {
      let sql = `
        SELECT
          mi.related_chunks,
          mi.book_references,
          mi.importance_score,
          mi.frequency
        FROM master_index mi
        WHERE LOWER(mi.key_term) LIKE LOWER($1)
      `;

      const params = [`%${term}%`];

      if (indexType) {
        sql += ` AND mi.index_type = $2`;
        params.push(indexType);
      }

      sql += ` ORDER BY mi.importance_score DESC, mi.frequency DESC`;

      const result = await this.pool.query(sql, params);

      const chunkIds = [];
      for (const row of result.rows) {
        if (row.related_chunks) {
          chunkIds.push(...row.related_chunks);
        }
      }

      // Get actual chunks
      if (chunkIds.length > 0) {
        return await this.getChunksByIds(chunkIds);
      }

      return [];

    } catch (error) {
      logger.error(`Search by term failed for "${term}":`, error);
      return [];
    }
  }

  /**
   * Search by book name
   */
  async searchByBook(bookName) {
    try {
      const sql = `
        SELECT
          tc.id,
          tc.content,
          tc.exact_reference,
          tc.section_title,
          tc.themes,
          tc.keywords,
          tc.token_count,
          b.title as book_title,
          0.8 as score
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
        WHERE LOWER(b.title) LIKE LOWER($1)
        OR LOWER(b.sefaria_ref) LIKE LOWER($1)
        ORDER BY tc.chunk_index
        LIMIT 50
      `;

      const result = await this.pool.query(sql, [`%${bookName}%`]);

      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        themes: row.themes || [],
        keywords: row.keywords || [],
        token_count: row.token_count,
        book_title: row.book_title,
        score: parseFloat(row.score)
      }));

    } catch (error) {
      logger.error(`Search by book failed for "${bookName}":`, error);
      return [];
    }
  }

  /**
   * Keyword search with filters
   */
  async keywordSearch(query, options = {}) {
    const { books = [], themes = [], limit = 20 } = options;

    try {
      let sql = `
        SELECT
          tc.id,
          tc.content,
          tc.exact_reference,
          tc.section_title,
          tc.themes,
          tc.keywords,
          tc.token_count,
          b.title as book_title,
          ts_rank(
            to_tsvector('simple', tc.content),
            plainto_tsquery('simple', $1)
          ) as score
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
        WHERE to_tsvector('simple', tc.content) @@ plainto_tsquery('simple', $1)
      `;

      const params = [query];
      let paramIndex = 2;

      if (books.length > 0) {
        sql += ` AND b.title = ANY($${paramIndex})`;
        params.push(books);
        paramIndex++;
      }

      if (themes.length > 0) {
        sql += ` AND tc.themes && $${paramIndex}`;
        params.push(themes);
        paramIndex++;
      }

      sql += ` ORDER BY score DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.pool.query(sql, params);

      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        themes: row.themes || [],
        keywords: row.keywords || [],
        token_count: row.token_count,
        book_title: row.book_title,
        score: parseFloat(row.score)
      }));

    } catch (error) {
      logger.error('Keyword search failed:', error);
      return [];
    }
  }

  /**
   * Get chunks by IDs
   */
  async getChunksByIds(chunkIds) {
    if (chunkIds.length === 0) return [];

    try {
      const sql = `
        SELECT
          tc.id,
          tc.content,
          tc.exact_reference,
          tc.section_title,
          tc.themes,
          tc.keywords,
          tc.token_count,
          b.title as book_title,
          0.7 as score
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
        WHERE tc.id = ANY($1)
      `;

      const result = await this.pool.query(sql, [chunkIds]);

      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        exact_reference: row.exact_reference,
        section_title: row.section_title,
        themes: row.themes || [],
        keywords: row.keywords || [],
        token_count: row.token_count,
        book_title: row.book_title,
        score: parseFloat(row.score)
      }));

    } catch (error) {
      logger.error('Get chunks by IDs failed:', error);
      return [];
    }
  }

  /**
   * Get available books with statistics
   */
  async getAvailableBooks() {
    try {
      const sql = `
        SELECT
          b.*,
          COUNT(tc.id) as total_chunks,
          ARRAY_AGG(DISTINCT unnest(tc.themes)) FILTER (WHERE tc.themes IS NOT NULL) as popular_themes
        FROM books b
        LEFT JOIN text_chunks tc ON b.id = tc.book_id
        GROUP BY b.id, b.title, b.hebrew_title, b.sefaria_ref, b.category, b.metadata, b.created_at, b.updated_at
        ORDER BY b.title
      `;

      const result = await this.pool.query(sql);

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        hebrew_title: row.hebrew_title,
        sefaria_ref: row.sefaria_ref,
        category: row.category,
        total_chunks: parseInt(row.total_chunks),
        popular_themes: (row.popular_themes || []).filter(t => t).slice(0, 10),
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

    } catch (error) {
      logger.error('Get available books failed:', error);
      return [];
    }
  }

  /**
   * Get popular themes across all books
   */
  async getPopularThemes(limit = 20) {
    try {
      const sql = `
        SELECT
          key_term,
          hebrew_term,
          frequency,
          importance_score,
          book_references,
          cross_references
        FROM master_index
        WHERE index_type = 'theme'
        ORDER BY importance_score DESC, frequency DESC
        LIMIT $1
      `;

      const result = await this.pool.query(sql, [limit]);

      return result.rows;

    } catch (error) {
      logger.error('Get popular themes failed:', error);
      return [];
    }
  }

  /**
   * Add or update index entry
   */
  async addIndexEntry(indexData) {
    try {
      const sql = `
        INSERT INTO master_index (
          index_type, key_term, hebrew_term, related_chunks,
          book_references, frequency, importance_score, cross_references
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (key_term, index_type)
        DO UPDATE SET
          related_chunks = EXCLUDED.related_chunks,
          book_references = EXCLUDED.book_references,
          frequency = EXCLUDED.frequency,
          importance_score = EXCLUDED.importance_score,
          cross_references = EXCLUDED.cross_references
      `;

      const params = [
        indexData.index_type,
        indexData.key_term,
        indexData.hebrew_term,
        indexData.related_chunks,
        indexData.book_references,
        indexData.frequency,
        indexData.importance_score,
        indexData.cross_references
      ];

      await this.pool.query(sql, params);

    } catch (error) {
      logger.error('Add index entry failed:', error);
      throw error;
    }
  }

  /**
   * Build master index from chunks
   */
  async buildIndexFromChunks() {
    logger.info('🏗️ Building master index from chunks...');

    try {
      // Clear existing index
      await this.pool.query('DELETE FROM master_index');

      // Get all chunks with their themes and keywords
      const sql = `
        SELECT
          tc.id,
          tc.themes,
          tc.keywords,
          tc.exact_reference,
          tc.hebrew_text,
          b.title as book_title
        FROM text_chunks tc
        JOIN books b ON tc.book_id = b.id
      `;

      const result = await this.pool.query(sql);
      const chunks = result.rows;

      // Build theme index
      const themeMap = new Map();
      const keywordMap = new Map();

      for (const chunk of chunks) {
        // Process themes
        if (chunk.themes) {
          for (const theme of chunk.themes) {
            if (!themeMap.has(theme)) {
              themeMap.set(theme, {
                chunks: [],
                books: new Set(),
                frequency: 0
              });
            }
            const themeData = themeMap.get(theme);
            themeData.chunks.push(chunk.id);
            themeData.books.add(chunk.book_title);
            themeData.frequency++;
          }
        }

        // Process keywords
        if (chunk.keywords) {
          for (const keyword of chunk.keywords) {
            if (!keywordMap.has(keyword)) {
              keywordMap.set(keyword, {
                chunks: [],
                books: new Set(),
                frequency: 0
              });
            }
            const keywordData = keywordMap.get(keyword);
            keywordData.chunks.push(chunk.id);
            keywordData.books.add(chunk.book_title);
            keywordData.frequency++;
          }
        }
      }

      // Insert theme entries
      for (const [theme, data] of themeMap) {
        await this.addIndexEntry({
          index_type: 'theme',
          key_term: theme,
          hebrew_term: this.extractHebrewEquivalent(theme),
          related_chunks: data.chunks,
          book_references: Array.from(data.books),
          frequency: data.frequency,
          importance_score: this.calculateImportanceScore(data.frequency, data.books.size),
          cross_references: {}
        });
      }

      // Insert keyword entries
      for (const [keyword, data] of keywordMap) {
        await this.addIndexEntry({
          index_type: 'concept',
          key_term: keyword,
          hebrew_term: this.extractHebrewEquivalent(keyword),
          related_chunks: data.chunks,
          book_references: Array.from(data.books),
          frequency: data.frequency,
          importance_score: this.calculateImportanceScore(data.frequency, data.books.size),
          cross_references: {}
        });
      }

      logger.info(`✅ Master index built: ${themeMap.size} themes, ${keywordMap.size} concepts`);

    } catch (error) {
      logger.error('Build index from chunks failed:', error);
      throw error;
    }
  }

  /**
   * Utility methods
   */

  deduplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
      if (seen.has(result.id)) {
        return false;
      }
      seen.add(result.id);
      return true;
    });
  }

  sortByImportance(results) {
    return results.sort((a, b) => {
      // Sort by score if available, then by other factors
      if (a.score && b.score) {
        return b.score - a.score;
      }
      return 0;
    });
  }

  calculateImportanceScore(frequency, bookCount) {
    // Simple importance scoring based on frequency and book distribution
    const frequencyScore = Math.min(frequency / 10, 1.0);
    const distributionScore = Math.min(bookCount / 5, 1.0);
    return (frequencyScore * 0.7 + distributionScore * 0.3);
  }

  extractHebrewEquivalent(term) {
    // Map common terms to Hebrew equivalents
    const hebrewMap = {
      'joie': 'שמחה',
      'prière': 'תפילה',
      'repentir': 'תשובה',
      'foi': 'אמונה',
      'méditation': 'התבודדות',
      'torah': 'תורה',
      'mitzvah': 'מצוה',
      'tsaddik': 'צדיק'
    };

    return hebrewMap[term.toLowerCase()] || null;
  }

  async buildCacheFromDatabase() {
    // Build a small cache of most important index entries
    try {
      const sql = `
        SELECT * FROM master_index
        WHERE importance_score > 0.5
        ORDER BY importance_score DESC
        LIMIT 1000
      `;

      const result = await this.pool.query(sql);

      for (const row of result.rows) {
        const cacheKey = `${row.index_type}:${row.key_term}`;
        this.indexCache.set(cacheKey, {
          data: row,
          timestamp: Date.now()
        });
      }

      logger.debug(`📦 Index cache built with ${this.indexCache.size} entries`);

    } catch (error) {
      logger.warn('Failed to build index cache:', error);
    }
  }
}

export { MasterIndexService };