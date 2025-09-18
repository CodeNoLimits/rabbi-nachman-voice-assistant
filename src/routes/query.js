import express from 'express';
import { OpenRouterClient } from '../services/openrouter.js';
import { VectorSearchService } from '../services/vector-search.js';
import { MasterIndexService } from '../services/master-index.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Initialize services
const openrouter = new OpenRouterClient();
let vectorSearch = null;
let masterIndex = null;

// Lazy initialization
async function initServices() {
  if (!vectorSearch) {
    vectorSearch = new VectorSearchService();
    await vectorSearch.init();
  }
  if (!masterIndex) {
    masterIndex = new MasterIndexService();
    await masterIndex.init();
  }
}

/**
 * Main query endpoint - the heart of the application
 * POST /api/query/ask
 */
router.post('/ask', async (req, res) => {
  try {
    const { question, maxResults = 10, includeAudio = false } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Question is required',
        example: 'Qu\'est-ce que Rabbi Nachman dit par rapport à Esaü dans la première Torah du Likutei Moharan?'
      });
    }

    await initServices();

    logger.info(`🔍 New query: "${question}"`);

    // Step 1: Analyze the French query
    const queryAnalysis = await openrouter.analyzeQuery(question);

    // Step 2: Multi-level search strategy
    const searchResults = await Promise.all([
      // Search master index for quick routing
      masterIndex.search(queryAnalysis),
      // Vector similarity search
      vectorSearch.search(queryAnalysis.hebrew_query, maxResults),
      // Theme-based search
      masterIndex.searchByThemes(queryAnalysis.themes)
    ]);

    // Step 3: Combine and rank results
    const combinedResults = combineSearchResults(searchResults);
    const topChunks = await selectBestChunks(combinedResults, queryAnalysis);

    if (topChunks.length === 0) {
      return res.json({
        answer: "Je n'ai pas trouvé d'information pertinente dans les sources consultées pour cette question.",
        confidence: 0,
        sources: [],
        suggestions: await generateSuggestions(queryAnalysis)
      });
    }

    // Step 4: Generate precise answer with citations
    const response = await openrouter.generatePreciseAnswer(
      question,
      topChunks,
      queryAnalysis
    );

    // Step 5: Generate audio if requested
    let audioUrl = null;
    if (includeAudio) {
      // This would integrate with TTS service
      // audioUrl = await generateAudio(response.answer);
    }

    // Step 6: Log for analytics
    await logQuery(question, response, queryAnalysis);

    res.json({
      answer: response.answer,
      confidence: response.confidence,
      sources: response.citations,
      query_analysis: queryAnalysis,
      chunks_used: topChunks.length,
      audio_url: audioUrl,
      generated_at: response.generated_at
    });

  } catch (error) {
    logger.error('Query processing failed:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process your question. Please try again.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Advanced search endpoint
 * POST /api/query/search
 */
router.post('/search', async (req, res) => {
  try {
    const {
      query,
      books = [],
      themes = [],
      searchType = 'semantic', // 'semantic' or 'keyword'
      limit = 20
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    await initServices();

    let results = [];

    if (searchType === 'semantic') {
      results = await vectorSearch.search(query, limit, { books, themes });
    } else {
      results = await masterIndex.keywordSearch(query, { books, themes, limit });
    }

    res.json({
      query,
      results: results.map(chunk => ({
        id: chunk.id,
        reference: chunk.exact_reference,
        content: chunk.content.substring(0, 300) + '...',
        hebrew_text: chunk.hebrew_text?.substring(0, 200) + '...',
        score: chunk.score,
        book: chunk.book_title,
        themes: chunk.themes
      })),
      total: results.length,
      search_type: searchType
    });

  } catch (error) {
    logger.error('Search failed:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

/**
 * Get available books and their statistics
 * GET /api/query/books
 */
router.get('/books', async (req, res) => {
  try {
    await initServices();

    const books = await masterIndex.getAvailableBooks();

    res.json({
      books: books.map(book => ({
        id: book.id,
        title: book.title,
        hebrew_title: book.hebrew_title,
        total_chunks: book.total_chunks,
        category: book.category,
        popular_themes: book.popular_themes || [],
        last_updated: book.updated_at
      })),
      total_books: books.length
    });

  } catch (error) {
    logger.error('Failed to get books:', error);
    res.status(500).json({ error: 'Failed to retrieve books' });
  }
});

/**
 * Get popular themes across all books
 * GET /api/query/themes
 */
router.get('/themes', async (req, res) => {
  try {
    await initServices();

    const themes = await masterIndex.getPopularThemes();

    res.json({
      themes: themes.map(theme => ({
        name: theme.key_term,
        hebrew: theme.hebrew_term,
        frequency: theme.frequency,
        books: theme.book_references,
        importance: theme.importance_score
      }))
    });

  } catch (error) {
    logger.error('Failed to get themes:', error);
    res.status(500).json({ error: 'Failed to retrieve themes' });
  }
});

/**
 * Get specific chunk by reference
 * GET /api/query/chunk/:reference
 */
router.get('/chunk/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const { includeContext = false } = req.query;

    await initServices();

    const chunk = await vectorSearch.getChunkByReference(reference);

    if (!chunk) {
      return res.status(404).json({
        error: 'Chunk not found',
        reference: reference
      });
    }

    let context = null;
    if (includeContext) {
      context = await vectorSearch.getChunkContext(chunk.id);
    }

    res.json({
      chunk: {
        id: chunk.id,
        reference: chunk.exact_reference,
        content: chunk.content,
        hebrew_text: chunk.hebrew_text,
        section_title: chunk.section_title,
        themes: chunk.themes,
        keywords: chunk.keywords
      },
      context: context
    });

  } catch (error) {
    logger.error('Failed to get chunk:', error);
    res.status(500).json({ error: 'Failed to retrieve chunk' });
  }
});

/**
 * Helper functions
 */

function combineSearchResults(searchResults) {
  const [masterResults, vectorResults, themeResults] = searchResults;
  const combined = new Map();

  // Add vector results (highest priority)
  vectorResults.forEach((chunk, index) => {
    combined.set(chunk.id, {
      ...chunk,
      score: chunk.score * 1.0, // Full weight
      source: 'vector'
    });
  });

  // Add master index results
  masterResults.forEach(chunk => {
    if (combined.has(chunk.id)) {
      combined.get(chunk.id).score += 0.3; // Boost existing
    } else {
      combined.set(chunk.id, {
        ...chunk,
        score: 0.7, // Lower base score
        source: 'master'
      });
    }
  });

  // Add theme results
  themeResults.forEach(chunk => {
    if (combined.has(chunk.id)) {
      combined.get(chunk.id).score += 0.2; // Small boost
    } else {
      combined.set(chunk.id, {
        ...chunk,
        score: 0.5,
        source: 'theme'
      });
    }
  });

  // Sort by score and return
  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score);
}

async function selectBestChunks(results, queryAnalysis) {
  // Select top chunks that fit within context window
  const maxTokens = parseInt(process.env.MAX_CONTEXT_TOKENS) || 800000;
  let totalTokens = 0;
  const selectedChunks = [];

  for (const chunk of results) {
    if (totalTokens + chunk.token_count < maxTokens) {
      selectedChunks.push(chunk);
      totalTokens += chunk.token_count;
    }

    // Limit to reasonable number of chunks
    if (selectedChunks.length >= 20) break;
  }

  return selectedChunks;
}

async function generateSuggestions(queryAnalysis) {
  // Generate helpful suggestions based on failed query
  const suggestions = [];

  if (queryAnalysis.suspected_books.length > 0) {
    suggestions.push(`Essayez de chercher dans ${queryAnalysis.suspected_books[0]}`);
  }

  if (queryAnalysis.themes.length > 0) {
    suggestions.push(`Recherchez des enseignements sur: ${queryAnalysis.themes.join(', ')}`);
  }

  suggestions.push('Reformulez votre question avec des termes plus généraux');
  suggestions.push('Vérifiez l\'orthographe des noms et termes hébreux');

  return suggestions;
}

async function logQuery(question, response, analysis) {
  // Log query for analytics and improvement
  logger.query('Query processed', question, {
    confidence: response.confidence,
    citations: response.citations.length,
    themes: analysis.themes
  });
}

export { router as queryRoutes };