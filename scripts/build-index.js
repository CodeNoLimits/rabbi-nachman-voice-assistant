import { logger } from '../src/utils/logger.js';
import { getPostgreSQLPool, initializeDatabase } from '../src/services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Master Index Builder for Rabbi Nachman Voice Assistant
 * Creates ultra-fast routing indexes for RAG pipeline
 */
class MasterIndexBuilder {
  constructor() {
    this.db = null;
    this.masterIndex = {
      version: "1.0",
      created_at: new Date().toISOString(),
      books: [],
      themes: {},
      keywords: {},
      statistics: {
        total_books: 0,
        total_chunks: 0,
        total_tokens: 0
      }
    };
  }

  async init() {
    await initializeDatabase();
    this.db = getPostgreSQLPool();
    logger.info('🔧 Master Index Builder initialized');
  }

  /**
   * Build complete master index from chunked data
   */
  async buildMasterIndex() {
    try {
      logger.info('🏗️ Building master index...');

      // Get all chunks from database
      const chunks = await this.getAllChunks();
      logger.info(`📚 Processing ${chunks.length} chunks`);

      // Build book index
      await this.buildBookIndex(chunks);

      // Build theme index
      await this.buildThemeIndex(chunks);

      // Build keyword index
      await this.buildKeywordIndex(chunks);

      // Calculate statistics
      this.calculateStatistics(chunks);

      // Save to database
      await this.saveMasterIndex();

      logger.info('✅ Master index built successfully!');
      logger.info(`📖 Books: ${this.masterIndex.books.length}`);
      logger.info(`🏷️ Themes: ${Object.keys(this.masterIndex.themes).length}`);
      logger.info(`🔍 Keywords: ${Object.keys(this.masterIndex.keywords).length}`);

    } catch (error) {
      logger.error('💥 Failed to build master index:', error);
      throw error;
    }
  }

  /**
   * Get all chunks from database
   */
  async getAllChunks() {
    const result = await this.db.query(`
      SELECT
        id,
        book_name,
        section_number,
        chunk_number,
        reference,
        exact_reference,
        content,
        hebrew_text,
        token_count,
        metadata,
        created_at
      FROM chunks
      ORDER BY book_name, section_number, chunk_number
    `);

    return result.rows;
  }

  /**
   * Build book-level index
   */
  async buildBookIndex(chunks) {
    const booksMap = new Map();

    chunks.forEach(chunk => {
      const bookName = chunk.book_name;

      if (!booksMap.has(bookName)) {
        booksMap.set(bookName, {
          id: bookName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: bookName,
          title: this.getBookTitle(bookName, chunk),
          hebrew_title: this.getHebrewTitle(chunk),
          total_chunks: 0,
          total_tokens: 0,
          chunks: [],
          themes: new Set(),
          sample_content: '',
          references: []
        });
      }

      const book = booksMap.get(bookName);
      book.total_chunks++;
      book.total_tokens += chunk.token_count || 0;
      book.chunks.push(chunk.id);
      book.references.push(chunk.exact_reference);

      // Extract themes from content
      this.extractThemes(chunk.content, book.themes);

      // Set sample content (first chunk)
      if (!book.sample_content && chunk.content) {
        book.sample_content = chunk.content.substring(0, 200) + '...';
      }
    });

    this.masterIndex.books = Array.from(booksMap.values()).map(book => ({
      ...book,
      themes: Array.from(book.themes)
    }));
  }

  /**
   * Build theme-based index
   */
  async buildThemeIndex(chunks) {
    const themes = {
      // Core Breslov themes
      'joie': { hebrew: 'שמחה', chunks: [], frequency: 0 },
      'hitbodedout': { hebrew: 'התבודדות', chunks: [], frequency: 0 },
      'teshuvah': { hebrew: 'תשובה', chunks: [], frequency: 0 },
      'techouva': { hebrew: 'תשובה', chunks: [], frequency: 0 },
      'emunah': { hebrew: 'אמונה', chunks: [], frequency: 0 },
      'emounah': { hebrew: 'אמונה', chunks: [], frequency: 0 },
      'priere': { hebrew: 'תפילה', chunks: [], frequency: 0 },
      'tefillah': { hebrew: 'תפילה', chunks: [], frequency: 0 },
      'torah': { hebrew: 'תורה', chunks: [], frequency: 0 },
      'tzaddik': { hebrew: 'צדיק', chunks: [], frequency: 0 },
      'justice': { hebrew: 'צדק', chunks: [], frequency: 0 },
      'paix': { hebrew: 'שלום', chunks: [], frequency: 0 },
      'shalom': { hebrew: 'שלום', chunks: [], frequency: 0 },
      'amour': { hebrew: 'אהבה', chunks: [], frequency: 0 },
      'ahavah': { hebrew: 'אהבה', chunks: [], frequency: 0 },
      'creation': { hebrew: 'בריאה', chunks: [], frequency: 0 },
      'monde': { hebrew: 'עולם', chunks: [], frequency: 0 },
      'olam': { hebrew: 'עולם', chunks: [], frequency: 0 }
    };

    chunks.forEach(chunk => {
      const content = (chunk.content + ' ' + chunk.hebrew_text).toLowerCase();

      Object.keys(themes).forEach(theme => {
        if (content.includes(theme) || content.includes(themes[theme].hebrew)) {
          themes[theme].chunks.push(chunk.id);
          themes[theme].frequency++;
        }
      });
    });

    // Filter themes with at least one match
    this.masterIndex.themes = Object.fromEntries(
      Object.entries(themes).filter(([_, data]) => data.frequency > 0)
    );
  }

  /**
   * Build keyword index
   */
  async buildKeywordIndex(chunks) {
    const keywords = new Map();

    chunks.forEach(chunk => {
      const content = chunk.content || '';

      // Extract meaningful words (filter common words)
      const words = content.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word =>
          word.length > 3 &&
          !this.isCommonWord(word)
        );

      words.forEach(word => {
        if (!keywords.has(word)) {
          keywords.set(word, {
            term: word,
            chunks: [],
            frequency: 0,
            importance: 0
          });
        }

        const keyword = keywords.get(word);
        if (!keyword.chunks.includes(chunk.id)) {
          keyword.chunks.push(chunk.id);
          keyword.frequency++;
        }
      });
    });

    // Calculate importance and filter
    keywords.forEach((data, word) => {
      data.importance = Math.log(data.frequency) * data.chunks.length;
    });

    // Keep only significant keywords
    this.masterIndex.keywords = Object.fromEntries(
      Array.from(keywords.entries())
        .filter(([_, data]) => data.frequency >= 2)
        .sort((a, b) => b[1].importance - a[1].importance)
        .slice(0, 500) // Top 500 keywords
    );
  }

  /**
   * Extract themes from content
   */
  extractThemes(content, themes) {
    const themeKeywords = {
      'joy': ['joy', 'happy', 'simcha', 'rejoice', 'celebrate'],
      'prayer': ['prayer', 'pray', 'tefillah', 'davening'],
      'repentance': ['repentance', 'teshuvah', 'return', 'regret'],
      'faith': ['faith', 'belief', 'emunah', 'trust'],
      'torah': ['torah', 'study', 'learning', 'wisdom'],
      'meditation': ['meditation', 'hitbodedout', 'solitude', 'contemplation']
    };

    const lowerContent = content.toLowerCase();

    Object.entries(themeKeywords).forEach(([theme, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        themes.add(theme);
      }
    });
  }

  /**
   * Check if word is common/stop word
   */
  isCommonWord(word) {
    const commonWords = new Set([
      'the', 'and', 'that', 'this', 'with', 'from', 'they', 'have', 'are',
      'said', 'were', 'been', 'their', 'would', 'there', 'what', 'into',
      'who', 'will', 'more', 'when', 'why', 'how', 'where', 'each', 'which',
      'she', 'his', 'her', 'him', 'them', 'than', 'many', 'some', 'very',
      'through', 'during', 'before', 'after', 'above', 'below', 'between',
      'rabbi', 'said', 'says', 'told', 'tell', 'know', 'knew', 'come', 'came'
    ]);

    return commonWords.has(word);
  }

  /**
   * Get formatted book title
   */
  getBookTitle(bookName, chunk) {
    const titleMap = {
      'Chayei': 'Chayei Moharan (Life of Rabbi Nachman)',
      'Likutei': 'Likutei Moharan (Collected Teachings)',
      'Shivchei': 'Shivchei HaRan (In Praise of Rabbi Nachman)',
      'Sichot': 'Sichot HaRan (Rabbi Nachman\'s Wisdom)',
      'Sippurei': 'Sippurei Maasiyot (The Tales)',
      'Tikkun': 'Tikkun HaKlali (The General Remedy)'
    };

    return titleMap[bookName] || chunk.metadata?.version_title || bookName;
  }

  /**
   * Get Hebrew title
   */
  getHebrewTitle(chunk) {
    return chunk.metadata?.he_version_title ||
           chunk.metadata?.he_ref?.split(' ')[0] ||
           '';
  }

  /**
   * Calculate master statistics
   */
  calculateStatistics(chunks) {
    this.masterIndex.statistics = {
      total_books: this.masterIndex.books.length,
      total_chunks: chunks.length,
      total_tokens: chunks.reduce((sum, chunk) => sum + (chunk.token_count || 0), 0),
      avg_tokens_per_chunk: Math.round(
        chunks.reduce((sum, chunk) => sum + (chunk.token_count || 0), 0) / chunks.length
      ),
      themes_count: Object.keys(this.masterIndex.themes).length,
      keywords_count: Object.keys(this.masterIndex.keywords).length
    };
  }

  /**
   * Save master index to database
   */
  async saveMasterIndex() {
    try {
      // Clear existing master index
      await this.db.query('DELETE FROM master_index WHERE index_type = $1', ['master']);

      // Insert new master index
      await this.db.query(`
        INSERT INTO master_index (index_type, key_term, related_chunks, frequency, cross_references)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'master',
        'complete_index',
        [], // No specific chunks for master index
        1,
        this.masterIndex
      ]);

      logger.info('💾 Master index saved to database');

      // Also save to file
      const fs = await import('fs/promises');
      const path = await import('path');
      const { fileURLToPath } = await import('url');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);

      const indexPath = path.join(__dirname, '../data/master_index.json');
      await fs.writeFile(indexPath, JSON.stringify(this.masterIndex, null, 2));

      logger.info(`📋 Master index saved to ${indexPath}`);

    } catch (error) {
      logger.error('Failed to save master index:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    // Database pool cleanup is handled by the main process
    logger.info('🧹 Index builder cleanup completed');
  }
}

/**
 * Main execution
 */
async function main() {
  const builder = new MasterIndexBuilder();

  try {
    await builder.init();
    await builder.buildMasterIndex();

    logger.info('🎉 Master index build completed successfully!');
    logger.info('📋 Next step: Start the server with npm start');

  } catch (error) {
    logger.error('💥 Master index build failed:', error);
    process.exit(1);
  } finally {
    await builder.cleanup();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { MasterIndexBuilder };