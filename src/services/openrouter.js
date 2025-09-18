import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * OpenRouter API client for Gemini 2.0 Flash and Claude 3.5 Sonnet
 */
class OpenRouterClient {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseURL = 'https://openrouter.ai/api/v1';

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }

    this.models = {
      primary: process.env.PRIMARY_MODEL || 'google/gemini-2.5-flash',
      translation: process.env.TRANSLATION_MODEL || 'anthropic/claude-3.5-sonnet',
      embedding: process.env.EMBEDDING_MODEL || 'text-embedding-3-large'
    };

    logger.info('🤖 OpenRouter client initialized with models:', this.models);
  }

  /**
   * Make a chat completion request
   */
  async chatCompletion(messages, options = {}) {
    const {
      model = this.models.primary,
      temperature = 0.3,
      maxTokens = 4000,
      stream = false
    } = options;

    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream,
          top_p: 0.9
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://rabbi-nachman-assistant.com',
            'X-Title': 'Rabbi Nachman Voice Assistant'
          },
          timeout: 30000
        }
      );

      return response.data;

    } catch (error) {
      logger.error('OpenRouter API error:', error.response?.data || error.message);
      throw new Error(`OpenRouter API failed: ${error.message}`);
    }
  }

  /**
   * Analyze a French query and extract context
   */
  async analyzeQuery(frenchQuery) {
    const messages = [
      {
        role: 'system',
        content: `Tu es un expert en enseignements de Rabbi Nachman de Breslov.

Analyse cette question française et fournis UNIQUEMENT un JSON avec:
{
  "themes": ["theme1", "theme2"], // thèmes principaux en français
  "hebrew_themes": ["תפילה", "שמחה"], // équivalents hébreux
  "suspected_books": ["Likutei_Moharan", "Chayei_Moharan"], // livres probables
  "query_type": "teaching|biographical|reference", // type de question
  "key_terms": ["mot1", "mot2"], // termes clés à chercher
  "hebrew_query": "question traduite en hébreu contextuel"
}`
      },
      {
        role: 'user',
        content: frenchQuery
      }
    ];

    const response = await this.chatCompletion(messages, {
      model: this.models.primary,
      temperature: 0.1,
      maxTokens: 500
    });

    try {
      let content = response.choices[0].message.content;

      // Clean markdown formatting if present
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const analysis = JSON.parse(content);
      logger.query('Query analyzed:', frenchQuery, analysis);
      return analysis;
    } catch (parseError) {
      logger.error('Failed to parse query analysis:', parseError);
      logger.error('Raw response:', response.choices[0].message.content);
      throw new Error('Invalid query analysis response');
    }
  }

  /**
   * Translate text with religious context
   */
  async translateWithContext(text, sourceLanguage, targetLanguage, context = '') {
    const contextPrompt = context ? `\n\nContexte: ${context}` : '';

    const messages = [
      {
        role: 'system',
        content: `Tu es un traducteur expert en textes religieux juifs, spécialisé dans les enseignements de Rabbi Nachman de Breslov.

Traduis fidèlement en préservant:
- Le sens religieux et mystique
- Les termes techniques hébraïques importants (avec traduction)
- Les nuances hassidiques
- Les références scripturaires

Fournis UNIQUEMENT la traduction, sans explication.${contextPrompt}`
      },
      {
        role: 'user',
        content: `Traduis de ${sourceLanguage} vers ${targetLanguage}:\n\n${text}`
      }
    ];

    const response = await this.chatCompletion(messages, {
      model: this.models.translation,
      temperature: 0.2,
      maxTokens: 1000
    });

    return response.choices[0].message.content.trim();
  }

  /**
   * Generate precise answer with citations
   */
  async generatePreciseAnswer(query, chunks, queryAnalysis) {
    const chunksContext = chunks.map(chunk => `
RÉFÉRENCE: ${chunk.exact_reference}
HÉBREU: ${chunk.hebrew_text || 'N/A'}
FRANÇAIS: ${chunk.content}
CONTEXTE: ${chunk.section_title || 'N/A'}
---`).join('\n');

    const messages = [
      {
        role: 'system',
        content: `Tu es un expert en enseignements de Rabbi Nachman de Breslov.

RÈGLES ABSOLUES:
1. Réponds UNIQUEMENT avec les sources fournies ci-dessous
2. Cite la référence EXACTE pour chaque information (Livre:Section:Paragraphe)
3. Si l'information n'est pas dans les sources, dis "Information non trouvée dans les sources consultées"
4. Préserve les termes hébreux importants avec leur traduction
5. Structure ta réponse avec les citations exactes à la fin

FORMAT DE RÉPONSE:
- Réponse principale en français
- Termes hébreux importants: [terme] (traduction)
- Citations exactes à la fin

SOURCES DISPONIBLES:
${chunksContext}`
      },
      {
        role: 'user',
        content: `QUESTION: ${query}

Génère une réponse précise avec citations exactes.`
      }
    ];

    const response = await this.chatCompletion(messages, {
      model: this.models.primary,
      temperature: 0.3,
      maxTokens: 2000
    });

    const answer = response.choices[0].message.content;

    // Extract citations from the answer
    const citations = this.extractCitations(answer, chunks);

    return {
      answer,
      citations,
      confidence: this.calculateConfidence(citations, chunks),
      model_used: this.models.primary,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Extract citations from generated answer
   */
  extractCitations(answer, availableChunks) {
    const citations = [];
    const referencePattern = /(Likutei Moharan|Chayei Moharan|Sippurei Maasiyot|Sichot HaRan|Shivchei HaRan|Likutei Tefilot|Likutei Halachot|Sefer HaMidot|Tikkun HaKlali)[^:]*:[^:]*:[^\s,\.]+/gi;

    const matches = answer.match(referencePattern) || [];

    for (const match of matches) {
      const matchingChunk = availableChunks.find(chunk =>
        chunk.exact_reference && chunk.exact_reference.includes(match.trim())
      );

      if (matchingChunk) {
        citations.push({
          reference: match.trim(),
          chunk_id: matchingChunk.id,
          verified: true
        });
      } else {
        citations.push({
          reference: match.trim(),
          chunk_id: null,
          verified: false
        });
      }
    }

    return citations;
  }

  /**
   * Calculate confidence score based on citations
   */
  calculateConfidence(citations, chunks) {
    if (citations.length === 0) return 0.1;

    const verifiedCitations = citations.filter(c => c.verified).length;
    const citationScore = verifiedCitations / citations.length;

    // Bonus for having source chunks
    const sourceScore = chunks.length > 0 ? 0.3 : 0;

    return Math.min(citationScore * 0.7 + sourceScore, 1.0);
  }

  /**
   * Generate embeddings for text chunks
   */
  async generateEmbedding(text) {
    try {
      const response = await axios.post(
        `${this.baseURL}/embeddings`,
        {
          model: this.models.embedding,
          input: text
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      return response.data.data[0].embedding;

    } catch (error) {
      logger.error('Embedding generation failed:', error.message);
      throw new Error(`Embedding failed: ${error.message}`);
    }
  }

  /**
   * Health check for OpenRouter services
   */
  async healthCheck() {
    try {
      const testResponse = await this.chatCompletion([
        { role: 'user', content: 'Hello, respond with just "OK"' }
      ], {
        maxTokens: 5,
        temperature: 0
      });

      const isHealthy = testResponse.choices?.[0]?.message?.content?.includes('OK');

      return {
        healthy: isHealthy,
        models: this.models,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export { OpenRouterClient };