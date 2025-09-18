import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rabbi Nachman books to extract from Sefaria
const BRESLOV_BOOKS = [
  // Primary works
  'Likutei_Moharan',
  'Likutei_Moharan_II',
  'Sippurei_Maasiyot',
  'Chayei_Moharan',
  'Sichot_HaRan',
  'Shivchei_HaRan',

  // Reb Noson's works
  'Likutei_Tefilot',
  'Likutei_Halachot',
  'Sefer_HaMidot',

  // Other works
  'Tikkun_HaKlali',
  'Kitzur_Likutei_Moharan',
  'Meshivat_Nefesh'
];

class SefariaExtractor {
  constructor() {
    this.baseUrl = 'https://www.sefaria.org/api';
    this.rateLimit = 300; // ms between requests
    this.outputDir = path.join(__dirname, '../data/raw');
    this.results = {
      extracted: [],
      failed: [],
      methods_used: {}
    };
  }

  async init() {
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });
    logger.info('🔍 Starting Sefaria extraction for Rabbi Nachman corpus');
  }

  /**
   * Multi-method extraction approach for maximum reliability
   */
  async extractBook(bookName) {
    const methods = [
      { name: 'API_v3', fn: () => this.tryAPIv3(bookName) },
      { name: 'API_v2', fn: () => this.tryAPIv2(bookName) },
      { name: 'Section_by_Section', fn: () => this.trySectionBySection(bookName) },
      { name: 'HTML_Parsing', fn: () => this.tryHTMLParsing(bookName) }
    ];

    for (const method of methods) {
      logger.info(`📖 Extracting ${bookName} via ${method.name}`);

      try {
        const result = await method.fn();

        if (this.validateResult(result)) {
          logger.info(`✅ Success with ${method.name} for ${bookName}`);

          // Save raw data
          await this.saveRawData(bookName, result, method.name);

          this.results.extracted.push(bookName);
          this.results.methods_used[bookName] = method.name;

          return result;
        }
      } catch (error) {
        logger.warn(`${method.name} failed for ${bookName}:`, error.message);
      }

      // Rate limiting between attempts
      await this.sleep(this.rateLimit);
    }

    // If all methods failed
    this.results.failed.push({
      book: bookName,
      error: 'All extraction methods failed',
      attempted_at: new Date().toISOString()
    });

    throw new Error(`Failed to extract ${bookName} with all methods`);
  }

  /**
   * Try Sefaria API v3 (most modern)
   */
  async tryAPIv3(bookName) {
    const url = `${this.baseUrl}/v3/texts/${bookName}?context=1&commentary=0`;
    const response = await axios.get(url, { timeout: 10000 });

    if (response.status === 200 && response.data) {
      return {
        ...response.data,
        extraction_method: 'API_v3',
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('API v3 returned invalid data');
  }

  /**
   * Try Sefaria API v2 (legacy but stable)
   */
  async tryAPIv2(bookName) {
    const url = `${this.baseUrl}/texts/${bookName}?context=1&commentary=0`;
    const response = await axios.get(url, { timeout: 10000 });

    if (response.status === 200 && response.data) {
      return {
        ...response.data,
        extraction_method: 'API_v2',
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('API v2 returned invalid data');
  }

  /**
   * Extract section by section for large texts
   */
  async trySectionBySection(bookName) {
    logger.info(`📑 Attempting section-by-section extraction for ${bookName}`);

    // First get the index
    const indexUrl = `${this.baseUrl}/index/${bookName}`;
    const indexResponse = await axios.get(indexUrl);

    if (!indexResponse.data || !indexResponse.data.schema) {
      throw new Error('No index data available');
    }

    const index = indexResponse.data;
    const sections = [];
    const maxSections = index.schema.lengths ? index.schema.lengths[0] : 50;

    logger.info(`📊 Found ${maxSections} sections in ${bookName}`);

    for (let i = 1; i <= Math.min(maxSections, 100); i++) {
      try {
        const sectionUrl = `${this.baseUrl}/texts/${bookName}.${i}`;
        const sectionResponse = await axios.get(sectionUrl, { timeout: 5000 });

        if (sectionResponse.status === 200 && sectionResponse.data) {
          sections.push({
            section: i,
            ...sectionResponse.data
          });

          if (i % 10 === 0) {
            logger.info(`📝 Extracted ${i}/${maxSections} sections of ${bookName}`);
          }
        }

        // Rate limiting
        await this.sleep(this.rateLimit);

      } catch (error) {
        logger.warn(`Section ${i} failed for ${bookName}:`, error.message);
      }
    }

    if (sections.length === 0) {
      throw new Error('No sections extracted');
    }

    return {
      ref: bookName,
      index: index,
      sections: sections,
      total_sections: sections.length,
      extraction_method: 'Section_by_Section',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Try HTML parsing as fallback
   */
  async tryHTMLParsing(bookName) {
    const url = `https://www.sefaria.org/${bookName}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'RabbiNachmanBot/1.0 Educational Research'
      }
    });

    if (response.status !== 200) {
      throw new Error('HTML fetch failed');
    }

    // Basic HTML parsing (this would need a proper parser in production)
    const html = response.data;

    // Look for JSON-LD data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        return {
          ...jsonData,
          extraction_method: 'HTML_Parsing',
          timestamp: new Date().toISOString()
        };
      } catch (e) {
        // Continue to basic HTML parsing
      }
    }

    // Extract basic text content (simplified)
    const hebrewRegex = /<span[^>]*class="[^"]*he[^"]*"[^>]*>(.*?)<\/span>/gs;
    const englishRegex = /<span[^>]*class="[^"]*en[^"]*"[^>]*>(.*?)<\/span>/gs;

    const hebrewTexts = [...html.matchAll(hebrewRegex)].map(m => m[1].replace(/<[^>]*>/g, ''));
    const englishTexts = [...html.matchAll(englishRegex)].map(m => m[1].replace(/<[^>]*>/g, ''));

    if (hebrewTexts.length === 0 && englishTexts.length === 0) {
      throw new Error('No text content found in HTML');
    }

    return {
      ref: bookName,
      he: hebrewTexts,
      text: englishTexts,
      extraction_method: 'HTML_Parsing',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate extracted data
   */
  validateResult(data) {
    if (!data) return false;

    // Check for text content
    const hasHebrew = data.he && (Array.isArray(data.he) ? data.he.length > 0 : data.he);
    const hasEnglish = data.text && (Array.isArray(data.text) ? data.text.length > 0 : data.text);
    const hasSections = data.sections && data.sections.length > 0;

    return hasHebrew || hasEnglish || hasSections;
  }

  /**
   * Save raw extracted data
   */
  async saveRawData(bookName, data, method) {
    const filename = `${bookName}_${method}_${Date.now()}.json`;
    const filepath = path.join(this.outputDir, filename);

    const saveData = {
      book: bookName,
      extraction_method: method,
      extracted_at: new Date().toISOString(),
      data: data
    };

    await fs.writeFile(filepath, JSON.stringify(saveData, null, 2));
    logger.info(`💾 Saved ${bookName} data to ${filename}`);
  }

  /**
   * Extract all Rabbi Nachman books
   */
  async extractAll() {
    await this.init();

    for (const bookName of BRESLOV_BOOKS) {
      try {
        logger.info(`🔄 Processing ${bookName}...`);
        await this.extractBook(bookName);

        // Longer pause between books
        await this.sleep(1000);

      } catch (error) {
        logger.error(`❌ Failed to extract ${bookName}:`, error.message);
      }
    }

    // Save extraction summary
    await this.saveSummary();

    return this.results;
  }

  /**
   * Save extraction summary
   */
  async saveSummary() {
    const summaryPath = path.join(this.outputDir, 'extraction_summary.json');
    const summary = {
      ...this.results,
      total_books: BRESLOV_BOOKS.length,
      success_rate: this.results.extracted.length / BRESLOV_BOOKS.length,
      completed_at: new Date().toISOString()
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    logger.info('📊 Extraction Summary:');
    logger.info(`✅ Extracted: ${this.results.extracted.length}/${BRESLOV_BOOKS.length} books`);
    logger.info(`❌ Failed: ${this.results.failed.length} books`);
    logger.info(`📈 Success rate: ${(summary.success_rate * 100).toFixed(1)}%`);
  }

  /**
   * Utility: Sleep function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const extractor = new SefariaExtractor();

  try {
    const results = await extractor.extractAll();

    if (results.extracted.length === 0) {
      logger.error('❌ No books extracted successfully');
      process.exit(1);
    }

    logger.info('🎉 Sefaria extraction completed successfully!');

  } catch (error) {
    logger.error('💥 Extraction failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { SefariaExtractor };