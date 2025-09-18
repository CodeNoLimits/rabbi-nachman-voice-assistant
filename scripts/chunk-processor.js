import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { logger } from '../src/utils/logger.js';
import { SemanticChunker } from '../src/services/chunker.js';
// import { initializeDatabase } from '../src/services/database.js';
import pg from 'pg';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main chunking processor for extracted Sefaria data
 */
class ChunkProcessor {
  constructor() {
    this.inputDir = path.join(__dirname, '../data/raw');
    this.outputDir = path.join(__dirname, '../data/chunks');
    this.chunker = new SemanticChunker();
    this.db = null;
    this.processedCount = 0;
    this.totalChunks = 0;
  }

  async init() {
    // Create direct PostgreSQL connection (skip MongoDB for now)
    const { Pool } = pg;
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection and enable pgvector
    const client = await this.db.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('pgvector extension enabled');
    } catch (error) {
      logger.warn('pgvector extension not available, continuing without vectors');
    }
    client.release();

    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });

    logger.info('🔥 Starting chunking processor...');
  }

  /**
   * Process all extracted JSON files
   */
  async processAllFiles() {
    try {
      const files = await fs.readdir(this.inputDir);
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('summary'));

      logger.info(`📚 Found ${jsonFiles.length} files to process`);

      for (const file of jsonFiles) {
        try {
          await this.processFile(file);
        } catch (error) {
          logger.error(`❌ Failed to process ${file}:`, error.message);
        }
      }

      await this.generateSummary();

    } catch (error) {
      logger.error('💥 Processing failed:', error);
      throw error;
    }
  }

  /**
   * Process a single JSON file
   */
  async processFile(filename) {
    const filePath = path.join(this.inputDir, filename);

    logger.info(`📖 Processing ${filename}...`);

    try {
      // Load extracted data
      const rawData = await fs.readFile(filePath, 'utf8');
      const jsonData = JSON.parse(rawData);

      // Extract book name from filename
      const bookName = filename.split('_')[0];

      // Validate data structure
      if (!this.validateData(jsonData)) {
        throw new Error('Invalid data structure');
      }

      logger.info(`Data validation passed for ${bookName}`);

      // Chunk the text content
      const chunks = await this.chunkBookData(bookName, jsonData.data);

      logger.info(`Chunking completed for ${bookName}, chunks: ${chunks.length}`);

      // Save chunks to database
      await this.saveChunksToDatabase(bookName, chunks);

      // Save chunks to file
      await this.saveChunksToFile(bookName, chunks);

      this.processedCount++;
      this.totalChunks += chunks.length;

      logger.info(`✅ Processed ${bookName}: ${chunks.length} chunks created`);

    } catch (error) {
      logger.error(`❌ Error processing ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate extracted data structure
   */
  validateData(data) {
    if (!data || !data.data) {
      logger.warn('Invalid data structure: missing data or data.data');
      return false;
    }

    const content = data.data;

    // Check for Hebrew or English text content
    const hasHebrew = content.he && (Array.isArray(content.he) ? content.he.length > 0 : content.he);
    const hasEnglish = content.text && (Array.isArray(content.text) ? content.text.length > 0 : content.text);
    const hasSections = content.sections && content.sections.length > 0;

    const isValid = hasHebrew || hasEnglish || hasSections;

    if (!isValid) {
      logger.warn('No valid content found:', {
        hasHebrew,
        hasEnglish,
        hasSections,
        contentKeys: Object.keys(content)
      });
    }

    return isValid;
  }

  /**
   * Chunk book data using semantic chunking
   */
  async chunkBookData(bookName, bookData) {
    const chunks = [];

    try {
      logger.info(`Chunking ${bookName}, checking structure...`);
      logger.info(`BookData keys: ${Object.keys(bookData)}`);

      // Handle different data structures
      if (bookData.sections && Array.isArray(bookData.sections) && typeof bookData.sections[0] === 'object') {
        logger.info(`${bookName}: Processing ${bookData.sections.length} sections (object-based)`);
        // Section-based structure with section objects
        for (let i = 0; i < bookData.sections.length; i++) {
          const section = bookData.sections[i];
          const sectionChunks = await this.chunkSection(bookName, section, i + 1);
          chunks.push(...sectionChunks);
        }
      } else {
        logger.info(`${bookName}: Processing direct text structure (sections are numbers: ${JSON.stringify(bookData.sections)})`);
        // Direct text structure - sections are numbers, text/he are arrays
        const directChunks = await this.chunkDirectText(bookName, bookData);
        chunks.push(...directChunks);
      }

      logger.info(`${bookName}: Created ${chunks.length} chunks total`);
      return chunks;

    } catch (error) {
      logger.error(`Failed to chunk ${bookName}:`, error.message);
      return [];
    }
  }

  /**
   * Chunk a single section
   */
  async chunkSection(bookName, section, sectionNumber) {
    const chunks = [];

    try {
      // Combine Hebrew and English texts
      const hebrewText = Array.isArray(section.he) ? section.he.join(' ') : (section.he || '');
      const englishText = Array.isArray(section.text) ? section.text.join(' ') : (section.text || '');

      if (!hebrewText && !englishText) {
        return chunks;
      }

      // Create base reference
      const baseRef = section.ref || `${bookName}:${sectionNumber}`;

      // Simple chunking approach for now
      const textChunks = this.simpleChunk(englishText || hebrewText, baseRef);

      // Format chunks with metadata
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          id: `${bookName}_s${sectionNumber}_c${i + 1}`,
          book_name: bookName,
          section_number: sectionNumber,
          chunk_number: i + 1,
          reference: `${baseRef}:${i + 1}`,
          exact_reference: baseRef,
          content: textChunks[i].content,
          hebrew_text: hebrewText,
          token_count: textChunks[i].tokenCount || this.estimateTokens(textChunks[i].content),
          chunk_type: 'semantic',
          metadata: {
            original_ref: section.ref,
            he_ref: section.heRef,
            version_title: section.versionTitle,
            he_version_title: section.heVersionTitle,
            section_title: section.sectionNames?.[0] || `Section ${sectionNumber}`,
            extraction_method: section.extractedFrom || 'unknown'
          },
          created_at: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.warn(`Failed to chunk section ${sectionNumber} of ${bookName}:`, error.message);
    }

    return chunks;
  }

  /**
   * Chunk direct text (non-section based)
   */
  async chunkDirectText(bookName, bookData) {
    const chunks = [];

    try {
      const hebrewText = Array.isArray(bookData.he) ? bookData.he.join(' ') : (bookData.he || '');
      const englishText = Array.isArray(bookData.text) ? bookData.text.join(' ') : (bookData.text || '');

      if (!hebrewText && !englishText) {
        return chunks;
      }

      const baseRef = bookData.ref || bookName;

      // Simple chunking approach for now
      const textChunks = this.simpleChunk(englishText || hebrewText, baseRef);

      // Format chunks
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          id: `${bookName}_c${i + 1}`,
          book_name: bookName,
          section_number: 1,
          chunk_number: i + 1,
          reference: `${baseRef}:${i + 1}`,
          exact_reference: baseRef,
          content: textChunks[i].content,
          hebrew_text: hebrewText,
          token_count: textChunks[i].tokenCount || this.estimateTokens(textChunks[i].content),
          chunk_type: 'semantic',
          metadata: {
            original_ref: bookData.ref,
            he_ref: bookData.heRef,
            version_title: bookData.versionTitle,
            he_version_title: bookData.heVersionTitle,
            extraction_method: bookData.extraction_method || 'unknown'
          },
          created_at: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.warn(`Failed to chunk direct text for ${bookName}:`, error.message);
    }

    return chunks;
  }

  /**
   * Simple chunking method
   */
  simpleChunk(text, reference) {
    logger.info(`simpleChunk called with text: ${typeof text}, length: ${text?.length || 0}`);

    if (!text) {
      logger.warn('simpleChunk: No text provided');
      return [];
    }

    const TARGET_SIZE = 10000; // 10K tokens target
    const chunks = [];

    if (Array.isArray(text)) {
      logger.info(`simpleChunk: Array input with ${text.length} elements`);
      // Join array elements
      text = text.join('\n\n');
    }

    // Clean up HTML tags
    text = text.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '');

    logger.info(`simpleChunk: After cleanup, text length: ${text.length}`);

    if (text.length <= TARGET_SIZE) {
      const chunk = {
        content: text,
        tokenCount: this.estimateTokens(text),
        reference: reference
      };
      logger.info(`simpleChunk: Single chunk created with ${chunk.tokenCount} tokens`);
      return [chunk];
    }

    // Split into chunks
    const sentences = text.split(/[.!?]\s+/);
    let currentChunk = '';
    let chunkIndex = 1;

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > TARGET_SIZE && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          tokenCount: this.estimateTokens(currentChunk),
          reference: `${reference}:${chunkIndex}`
        });
        currentChunk = sentence;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        tokenCount: this.estimateTokens(currentChunk),
        reference: `${reference}:${chunkIndex}`
      });
    }

    return chunks;
  }

  /**
   * Simple token estimation
   */
  estimateTokens(text) {
    if (!text) return 0;
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Save chunks to PostgreSQL database
   */
  async saveChunksToDatabase(bookName, chunks) {
    if (!this.db || chunks.length === 0) return;

    try {
      logger.info(`💾 Saving ${chunks.length} chunks for ${bookName} to database...`);

      // Create table if it doesn't exist
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          id VARCHAR PRIMARY KEY,
          book_name VARCHAR NOT NULL,
          section_number INTEGER,
          chunk_number INTEGER,
          reference VARCHAR NOT NULL,
          exact_reference VARCHAR,
          content TEXT NOT NULL,
          hebrew_text TEXT,
          token_count INTEGER,
          chunk_type VARCHAR DEFAULT 'semantic',
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert chunks in batches
      const batchSize = 50;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);

        const values = batch.map(chunk => `(
          '${chunk.id}',
          '${chunk.book_name}',
          ${chunk.section_number},
          ${chunk.chunk_number},
          '${chunk.reference.replace(/'/g, "''")}',
          '${chunk.exact_reference.replace(/'/g, "''")}',
          '${chunk.content.replace(/'/g, "''")}',
          '${(chunk.hebrew_text || '').replace(/'/g, "''")}',
          ${chunk.token_count},
          '${chunk.chunk_type}',
          '${JSON.stringify(chunk.metadata).replace(/'/g, "''")}',
          '${chunk.created_at}'
        )`).join(',');

        await this.db.query(`
          INSERT INTO chunks (
            id, book_name, section_number, chunk_number, reference,
            exact_reference, content, hebrew_text, token_count,
            chunk_type, metadata, created_at
          ) VALUES ${values}
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            token_count = EXCLUDED.token_count,
            metadata = EXCLUDED.metadata
        `);
      }

      logger.info(`✅ Saved ${chunks.length} chunks for ${bookName} to database`);

    } catch (error) {
      logger.error(`Failed to save chunks to database for ${bookName}:`, error.message);
    }
  }

  /**
   * Save chunks to JSON file
   */
  async saveChunksToFile(bookName, chunks) {
    try {
      const outputFile = path.join(this.outputDir, `${bookName}_chunks.json`);

      const chunkData = {
        book: bookName,
        total_chunks: chunks.length,
        total_tokens: chunks.reduce((sum, chunk) => sum + chunk.token_count, 0),
        processed_at: new Date().toISOString(),
        chunks: chunks
      };

      await fs.writeFile(outputFile, JSON.stringify(chunkData, null, 2));

      logger.info(`📄 Saved chunks for ${bookName} to ${outputFile}`);

    } catch (error) {
      logger.error(`Failed to save chunks file for ${bookName}:`, error.message);
    }
  }

  /**
   * Generate processing summary
   */
  async generateSummary() {
    const summary = {
      processed_files: this.processedCount,
      total_chunks: this.totalChunks,
      processed_at: new Date().toISOString(),
      status: 'completed'
    };

    const summaryPath = path.join(this.outputDir, 'processing_summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    logger.info('📊 Chunking Summary:');
    logger.info(`✅ Files processed: ${this.processedCount}`);
    logger.info(`📄 Total chunks created: ${this.totalChunks}`);
    logger.info(`💾 Average chunks per file: ${(this.totalChunks / this.processedCount).toFixed(1)}`);
    logger.info(`📋 Summary saved to: ${summaryPath}`);
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.db) {
      await this.db.end();
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const processor = new ChunkProcessor();

  try {
    await processor.init();
    await processor.processAllFiles();

    logger.info('🎉 Chunking completed successfully!');
    logger.info('📋 Next step: npm run build-index');

  } catch (error) {
    logger.error('💥 Chunking failed:', error);
    process.exit(1);
  } finally {
    await processor.cleanup();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { ChunkProcessor };