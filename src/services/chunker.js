import { OpenRouterClient } from './openrouter.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Intelligent semantic chunking for Rabbi Nachman texts
 * Preserves religious meaning and maintains exact references
 */
class SemanticChunker {
  constructor() {
    this.openrouter = new OpenRouterClient();
    this.chunkSize = parseInt(process.env.CHUNK_SIZE) || 10000;
    this.overlapPercentage = parseInt(process.env.OVERLAP_PERCENTAGE) || 15;
    this.maxChunkSize = this.chunkSize * 1.2; // 20% tolerance
  }

  /**
   * Main chunking method for a book
   */
  async chunkBook(bookData, bookMetadata) {
    logger.info(`📚 Starting semantic chunking for ${bookMetadata.title}`);

    const chunks = [];
    const sections = this.extractSections(bookData);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      logger.debug(`Processing section ${i + 1}/${sections.length}: ${section.title}`);

      const sectionChunks = await this.chunkSection(section, bookMetadata, i);
      chunks.push(...sectionChunks);
    }

    // Add overlap between adjacent chunks
    this.addOverlapBetweenChunks(chunks);

    logger.info(`✅ Chunking complete: ${chunks.length} chunks created for ${bookMetadata.title}`);

    return chunks;
  }

  /**
   * Extract structured sections from book data
   */
  extractSections(bookData) {
    const sections = [];

    if (bookData.sections && Array.isArray(bookData.sections)) {
      // Section-by-section extraction format
      bookData.sections.forEach((section, index) => {
        sections.push({
          index: section.section || index + 1,
          title: this.generateSectionTitle(section, index),
          hebrew_text: section.he || section.hebrew || [],
          english_text: section.text || section.english || [],
          reference: section.ref || `${bookData.ref || 'Unknown'}:${index + 1}`
        });
      });

    } else if (bookData.he || bookData.text) {
      // Direct text format
      const hebrewTexts = Array.isArray(bookData.he) ? bookData.he : [bookData.he];
      const englishTexts = Array.isArray(bookData.text) ? bookData.text : [bookData.text];

      const maxLength = Math.max(hebrewTexts.length, englishTexts.length);

      for (let i = 0; i < maxLength; i++) {
        sections.push({
          index: i + 1,
          title: `Section ${i + 1}`,
          hebrew_text: hebrewTexts[i] || '',
          english_text: englishTexts[i] || '',
          reference: `${bookData.ref || 'Unknown'}:${i + 1}`
        });
      }
    }

    return sections.filter(section =>
      section.hebrew_text || section.english_text
    );
  }

  /**
   * Generate meaningful section titles
   */
  generateSectionTitle(section, index) {
    // Try to extract title from Hebrew text patterns
    if (section.he && Array.isArray(section.he) && section.he[0]) {
      const firstLine = section.he[0].trim();

      // Look for common Torah/teaching patterns
      const titlePatterns = [
        /^תורה\s+([א-ת\s]+)/,  // Torah + name pattern
        /^הלכות\s+([א-ת\s]+)/, // Halachot + name pattern
        /^תפילה\s+([א-ת\s]+)/, // Tefilah + name pattern
        /^מעשה\s+([א-ת\s]+)/   // Story + name pattern
      ];

      for (const pattern of titlePatterns) {
        const match = firstLine.match(pattern);
        if (match) {
          return `${match[1].trim()} (${index + 1})`;
        }
      }

      // Fallback: use first few words
      const words = firstLine.split(/\s+/).slice(0, 4);
      if (words.length > 0) {
        return `${words.join(' ')}... (${index + 1})`;
      }
    }

    return `Section ${index + 1}`;
  }

  /**
   * Chunk a specific section with semantic awareness
   */
  async chunkSection(section, bookMetadata, sectionIndex) {
    const chunks = [];

    // Combine Hebrew and English text
    const fullText = this.combineTexts(section.hebrew_text, section.english_text);

    if (!fullText.trim()) {
      logger.warn(`Empty section ${sectionIndex} in ${bookMetadata.title}`);
      return chunks;
    }

    // Check if section fits in one chunk
    const tokenCount = this.estimateTokenCount(fullText);

    if (tokenCount <= this.chunkSize) {
      // Single chunk for the entire section
      chunks.push(await this.createChunk({
        content: fullText,
        hebrew_text: section.hebrew_text,
        english_text: section.english_text,
        section_title: section.title,
        exact_reference: section.reference,
        chunk_index: 0,
        section_index: sectionIndex,
        book_metadata: bookMetadata,
        token_count: tokenCount,
        is_complete_section: true
      }));

    } else {
      // Multiple chunks needed - use intelligent splitting
      const subChunks = await this.intelligentSplit(
        fullText,
        section,
        bookMetadata,
        sectionIndex
      );

      chunks.push(...subChunks);
    }

    return chunks;
  }

  /**
   * Intelligent text splitting that preserves meaning
   */
  async intelligentSplit(fullText, section, bookMetadata, sectionIndex) {
    const chunks = [];

    // Split into natural paragraphs/sentences first
    const paragraphs = this.splitIntoParagraphs(fullText);

    let currentChunk = '';
    let currentTokens = 0;
    let chunkIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const paragraphTokens = this.estimateTokenCount(paragraph);

      // If single paragraph is too large, split it further
      if (paragraphTokens > this.chunkSize) {
        // Save current chunk if it has content
        if (currentChunk.trim()) {
          chunks.push(await this.createChunk({
            content: currentChunk.trim(),
            section_title: section.title,
            exact_reference: `${section.reference}:${chunkIndex + 1}`,
            chunk_index: chunkIndex,
            section_index: sectionIndex,
            book_metadata: bookMetadata,
            token_count: currentTokens,
            is_complete_section: false
          }));

          chunkIndex++;
          currentChunk = '';
          currentTokens = 0;
        }

        // Split large paragraph by sentences
        const sentences = this.splitIntoSentences(paragraph);
        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokenCount(sentence);

          if (currentTokens + sentenceTokens > this.chunkSize && currentChunk.trim()) {
            // Create chunk and start new one
            chunks.push(await this.createChunk({
              content: currentChunk.trim(),
              section_title: section.title,
              exact_reference: `${section.reference}:${chunkIndex + 1}`,
              chunk_index: chunkIndex,
              section_index: sectionIndex,
              book_metadata: bookMetadata,
              token_count: currentTokens,
              is_complete_section: false
            }));

            chunkIndex++;
            currentChunk = sentence;
            currentTokens = sentenceTokens;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
            currentTokens += sentenceTokens;
          }
        }

      } else {
        // Check if adding this paragraph exceeds chunk size
        if (currentTokens + paragraphTokens > this.chunkSize && currentChunk.trim()) {
          // Create chunk and start new one
          chunks.push(await this.createChunk({
            content: currentChunk.trim(),
            section_title: section.title,
            exact_reference: `${section.reference}:${chunkIndex + 1}`,
            chunk_index: chunkIndex,
            section_index: sectionIndex,
            book_metadata: bookMetadata,
            token_count: currentTokens,
            is_complete_section: false
          }));

          chunkIndex++;
          currentChunk = paragraph;
          currentTokens = paragraphTokens;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
          currentTokens += paragraphTokens;
        }
      }
    }

    // Add final chunk if there's remaining content
    if (currentChunk.trim()) {
      chunks.push(await this.createChunk({
        content: currentChunk.trim(),
        section_title: section.title,
        exact_reference: `${section.reference}:${chunkIndex + 1}`,
        chunk_index: chunkIndex,
        section_index: sectionIndex,
        book_metadata: bookMetadata,
        token_count: currentTokens,
        is_complete_section: false
      }));
    }

    return chunks;
  }

  /**
   * Create a complete chunk object with metadata
   */
  async createChunk(params) {
    const {
      content,
      hebrew_text,
      english_text,
      section_title,
      exact_reference,
      chunk_index,
      section_index,
      book_metadata,
      token_count,
      is_complete_section
    } = params;

    // Extract themes and keywords using AI
    const analysis = await this.analyzeChunkContent(content, book_metadata.title);

    // Generate summary for context
    const summary = await this.generateChunkSummary(content, section_title);

    return {
      id: uuidv4(),
      book_id: book_metadata.id,
      chunk_index,
      content,
      hebrew_text: this.extractHebrewFromContent(content, hebrew_text),
      exact_reference,
      section_title,
      paragraph_number: section_index + 1,
      token_count: token_count || this.estimateTokenCount(content),
      chunk_summary: summary,
      themes: analysis.themes || [],
      keywords: analysis.keywords || [],
      metadata: {
        book_title: book_metadata.title,
        hebrew_title: book_metadata.hebrew_title,
        category: book_metadata.category,
        is_complete_section,
        extraction_method: book_metadata.extraction_method,
        created_at: new Date().toISOString()
      }
    };
  }

  /**
   * Analyze chunk content to extract themes and keywords
   */
  async analyzeChunkContent(content, bookTitle) {
    try {
      const analysisPrompt = `Analyse ce texte de ${bookTitle} et fournis UNIQUEMENT un JSON avec:
{
  "themes": ["theme1", "theme2"], // 3-5 thèmes principaux en français
  "keywords": ["mot1", "mot2"], // 5-10 mots-clés importants
  "hebrew_concepts": ["תפילה", "תשובה"] // concepts hébreux identifiés
}

Texte à analyser:
${content.substring(0, 1000)}...`;

      const messages = [
        { role: 'system', content: 'Tu es un expert en enseignements de Rabbi Nachman. Réponds uniquement en JSON valide.' },
        { role: 'user', content: analysisPrompt }
      ];

      const response = await this.openrouter.chatCompletion(messages, {
        temperature: 0.1,
        maxTokens: 300
      });

      const analysis = JSON.parse(response.choices[0].message.content);
      return {
        themes: analysis.themes || [],
        keywords: analysis.keywords || [],
        hebrew_concepts: analysis.hebrew_concepts || []
      };

    } catch (error) {
      logger.warn('Chunk analysis failed, using fallback:', error.message);
      return {
        themes: [],
        keywords: [],
        hebrew_concepts: []
      };
    }
  }

  /**
   * Generate concise summary for chunk
   */
  async generateChunkSummary(content, sectionTitle) {
    try {
      const summaryPrompt = `Résume en 1-2 phrases l'enseignement principal de ce passage de ${sectionTitle}:

${content.substring(0, 800)}...`;

      const messages = [
        { role: 'system', content: 'Tu es un expert en enseignements de Rabbi Nachman. Résume de manière concise et précise.' },
        { role: 'user', content: summaryPrompt }
      ];

      const response = await this.openrouter.chatCompletion(messages, {
        temperature: 0.2,
        maxTokens: 150
      });

      return response.choices[0].message.content.trim();

    } catch (error) {
      logger.warn('Summary generation failed:', error.message);
      return `Enseignement de ${sectionTitle}`;
    }
  }

  /**
   * Utility methods
   */

  combineTexts(hebrew, english) {
    let combined = '';

    if (Array.isArray(hebrew) && hebrew.length > 0) {
      combined += hebrew.join(' ');
    } else if (typeof hebrew === 'string') {
      combined += hebrew;
    }

    if (Array.isArray(english) && english.length > 0) {
      if (combined) combined += '\n\n';
      combined += english.join(' ');
    } else if (typeof english === 'string') {
      if (combined) combined += '\n\n';
      combined += english;
    }

    return combined;
  }

  extractHebrewFromContent(content, originalHebrew) {
    // Try to extract Hebrew text from combined content
    if (originalHebrew) {
      if (Array.isArray(originalHebrew)) {
        return originalHebrew.join(' ');
      }
      return originalHebrew;
    }

    // Fallback: extract Hebrew unicode range from content
    const hebrewRegex = /[\u0590-\u05FF\u200F\u200E\s]+/g;
    const hebrewMatches = content.match(hebrewRegex);

    if (hebrewMatches) {
      return hebrewMatches.join(' ').trim();
    }

    return null;
  }

  splitIntoParagraphs(text) {
    return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  }

  splitIntoSentences(text) {
    // Handle both Hebrew and English sentence endings
    return text.split(/[.!?׃׀]+/).filter(s => s.trim().length > 0);
  }

  estimateTokenCount(text) {
    // Rough estimation: ~4 characters per token for mixed Hebrew/English
    return Math.ceil(text.length / 4);
  }

  addOverlapBetweenChunks(chunks) {
    const overlapTokens = Math.floor(this.chunkSize * (this.overlapPercentage / 100));

    for (let i = 0; i < chunks.length - 1; i++) {
      const currentChunk = chunks[i];
      const nextChunk = chunks[i + 1];

      // Add end of current chunk to beginning of next chunk
      const currentWords = currentChunk.content.split(/\s+/);
      const overlapWords = currentWords.slice(-Math.floor(overlapTokens / 4));

      if (overlapWords.length > 0) {
        nextChunk.content = overlapWords.join(' ') + ' ' + nextChunk.content;
        nextChunk.token_count += overlapWords.length;
      }
    }
  }
}

export { SemanticChunker };