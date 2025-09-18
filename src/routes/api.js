import express from 'express';
import { logger } from '../utils/logger.js';
import { getPostgreSQLPool } from '../services/database.js';
import { OpenRouterClient } from '../services/openrouter.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Initialize OpenRouter client
const openRouter = new OpenRouterClient();

/**
 * RAG-based query endpoint for Rabbi Nachman Voice Assistant
 */
router.post('/query/ask', async (req, res) => {
  try {
    const { question, includeAudio = false } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Question is required',
        code: 'MISSING_QUESTION'
      });
    }

    logger.info(`🔍 Processing query: "${question}"`);

    // Step 1: Search relevant chunks
    const relevantChunks = await searchRelevantChunks(question);

    if (relevantChunks.length === 0) {
      return res.json({
        answer: "Je n'ai pas trouvé d'informations spécifiques sur ce sujet dans les enseignements de Rabbi Nachman. Pourriez-vous reformuler votre question ou être plus spécifique ?",
        citations: [],
        confidence: 30,
        query: question,
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Generate response with OpenRouter
    const answer = await generateAnswer(question, relevantChunks);

    // Step 3: Extract citations
    const citations = extractCitations(relevantChunks);

    // Step 4: Calculate confidence
    const confidence = calculateConfidence(question, relevantChunks, answer);

    const response = {
      answer,
      citations,
      confidence,
      query: question,
      total_sources: relevantChunks.length,
      timestamp: new Date().toISOString()
    };

    // Optional: Generate audio response
    if (includeAudio) {
      // TODO: Implement TTS with ElevenLabs
      response.audio_url = null;
    }

    // Log successful query
    await logQuery(question, answer, citations, confidence);

    res.json(response);

  } catch (error) {
    logger.error('Query processing failed:', error);
    res.status(500).json({
      error: 'Une erreur est survenue lors du traitement de votre question',
      code: 'QUERY_PROCESSING_ERROR',
      message: error.message
    });
  }
});

/**
 * Get system status
 */
router.get('/status', async (req, res) => {
  try {
    const db = getPostgreSQLPool();

    // Check database connectivity
    const dbResult = await db.query('SELECT COUNT(*) FROM chunks');
    const chunksCount = parseInt(dbResult.rows[0].count);

    // Load master index stats
    const masterIndex = await loadMasterIndex();

    const status = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        chunks_count: chunksCount,
        books_count: masterIndex?.books?.length || 0
      },
      ai: {
        openrouter_available: true,
        primary_model: 'google/gemini-2.5-flash',
        translation_model: 'anthropic/claude-3.5-sonnet'
      },
      search: {
        master_index_loaded: !!masterIndex,
        themes_count: Object.keys(masterIndex?.themes || {}).length,
        keywords_count: Object.keys(masterIndex?.keywords || {}).length
      }
    };

    res.json(status);

  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get available books
 */
router.get('/books', async (req, res) => {
  try {
    const masterIndex = await loadMasterIndex();

    if (!masterIndex || !masterIndex.books) {
      return res.status(500).json({
        error: 'Master index not available',
        books: []
      });
    }

    const books = masterIndex.books.map(book => ({
      id: book.id,
      name: book.name,
      title: book.title,
      hebrew_title: book.hebrew_title,
      total_chunks: book.total_chunks,
      total_tokens: book.total_tokens,
      themes: book.themes,
      sample_content: book.sample_content
    }));

    res.json({
      books,
      total_books: books.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Books listing failed:', error);
    res.status(500).json({
      error: 'Failed to load books',
      books: []
    });
  }
});

/**
 * Search chunks by theme
 */
router.get('/search/theme/:theme', async (req, res) => {
  try {
    const { theme } = req.params;
    const masterIndex = await loadMasterIndex();

    if (!masterIndex?.themes?.[theme]) {
      return res.json({
        theme,
        chunks: [],
        message: 'Theme not found'
      });
    }

    const themeData = masterIndex.themes[theme];
    const db = getPostgreSQLPool();

    // Get chunks for this theme
    const placeholders = themeData.chunks.map((_, i) => `$${i + 1}`).join(',');
    const result = await db.query(
      `SELECT id, book_name, reference, content, hebrew_text, token_count
       FROM chunks
       WHERE id = ANY($1::text[])
       ORDER BY book_name, section_number`,
      [themeData.chunks]
    );

    res.json({
      theme,
      hebrew_term: themeData.hebrew,
      frequency: themeData.frequency,
      chunks: result.rows,
      total_chunks: result.rows.length
    });

  } catch (error) {
    logger.error('Theme search failed:', error);
    res.status(500).json({
      error: 'Theme search failed',
      theme: req.params.theme,
      chunks: []
    });
  }
});

/**
 * Search relevant chunks for a question
 */
async function searchRelevantChunks(question, limit = 5) {
  try {
    const db = getPostgreSQLPool();

    // Simple keyword matching for now
    // TODO: Implement semantic search with embeddings
    const searchTerms = question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2);

    if (searchTerms.length === 0) {
      return [];
    }

    // Build search query
    const searchConditions = searchTerms.map((_, i) =>
      `(LOWER(content) LIKE $${i + 2} OR LOWER(hebrew_text) LIKE $${i + 2})`
    ).join(' OR ');

    const searchValues = searchTerms.map(term => `%${term}%`);

    const query = `
      SELECT
        id, book_name, section_number, chunk_number,
        reference, exact_reference, content, hebrew_text,
        token_count, metadata
      FROM chunks
      WHERE ${searchConditions}
      ORDER BY
        (${searchTerms.map((_, i) =>
          `(CASE WHEN LOWER(content) LIKE $${i + 2} THEN 1 ELSE 0 END)`
        ).join(' + ')}) DESC,
        token_count DESC
      LIMIT $1
    `;

    const result = await db.query(query, [limit, ...searchValues]);

    logger.info(`🔍 Found ${result.rows.length} relevant chunks for query`);
    return result.rows;

  } catch (error) {
    logger.error('Chunk search failed:', error);
    return [];
  }
}

/**
 * Generate answer using OpenRouter
 */
async function generateAnswer(question, chunks) {
  try {
    const context = chunks.map(chunk => `
**${chunk.reference}**
${chunk.content}

**Hebrew:** ${chunk.hebrew_text || 'N/A'}
---
`).join('\n');

    const prompt = `Tu es un assistant spécialisé dans les enseignements de Rabbi Nachman de Breslov. Réponds à la question suivante en te basant UNIQUEMENT sur les textes fournis.

QUESTION: ${question}

SOURCES DISPONIBLES:
${context}

INSTRUCTIONS:
1. Réponds en français, de manière claire et accessible
2. Cite précisément les références (ex: "Dans Likutei Moharan I:24...")
3. Si la réponse n'est pas dans les sources, dis-le clairement
4. Reste fidèle aux enseignements originaux
5. Sois respectueux du contenu spirituel

RÉPONSE:`;

    const result = await openRouter.generatePreciseAnswer(question, chunks, {});
    return result.answer;

  } catch (error) {
    logger.error('Answer generation failed:', error);
    return "Je ne peux pas répondre à votre question pour le moment. Veuillez réessayer.";
  }
}

/**
 * Extract citations from chunks
 */
function extractCitations(chunks) {
  return chunks.map(chunk => ({
    reference: chunk.exact_reference,
    book: chunk.book_name,
    content_preview: chunk.content.substring(0, 150) + '...',
    token_count: chunk.token_count
  }));
}

/**
 * Calculate confidence score
 */
function calculateConfidence(question, chunks, answer) {
  let confidence = 50; // Base score

  // More chunks = higher confidence
  confidence += Math.min(chunks.length * 10, 30);

  // Longer, detailed answer = higher confidence
  if (answer.length > 200) confidence += 10;
  if (answer.length > 500) confidence += 10;

  // Question-chunk relevance (simple keyword matching)
  const questionWords = question.toLowerCase().split(/\s+/);
  const matchCount = chunks.reduce((count, chunk) => {
    const chunkText = chunk.content.toLowerCase();
    return count + questionWords.filter(word => chunkText.includes(word)).length;
  }, 0);

  confidence += Math.min(matchCount * 2, 20);

  return Math.min(Math.max(confidence, 30), 95);
}

/**
 * Log query for analytics
 */
async function logQuery(question, answer, citations, confidence) {
  try {
    const db = getPostgreSQLPool();

    // Store citations as comma-separated text for compatibility
    const citationsText = citations.map(c => c.reference).join(', ');

    await db.query(`
      INSERT INTO citations (query_text, response_text, cited_chunks, confidence_score, validation_status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      question,
      answer,
      citationsText,
      confidence,
      'pending'
    ]);

  } catch (error) {
    logger.error('Query logging failed:', error);
  }
}

/**
 * Load master index from file
 */
async function loadMasterIndex() {
  try {
    const indexPath = path.join(__dirname, '../../data/master_index.json');
    const indexData = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(indexData);
  } catch (error) {
    logger.error('Failed to load master index:', error);
    return null;
  }
}

export default router;