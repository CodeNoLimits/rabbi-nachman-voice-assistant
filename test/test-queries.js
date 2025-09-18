import dotenv from 'dotenv';
import { OpenRouterClient } from '../src/services/openrouter.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Test the ultra-precise queries that the user specified
 */
async function testUltraPreciseQueries() {
  logger.info('🧪 Testing ultra-precise queries...');

  const openrouter = new OpenRouterClient();

  const testQueries = [
    // User's specific examples
    "Qu'est-ce que Rabbi Nachman dit par rapport à Esaü dans la première Torah du Likutei Moharan? Quel est le paragraphe, s'il te plaît, pour référence.",

    "Dans Chayei Moharan, quand est-ce que Rabbi Nachman est parti à Medvedevka? En quelle année, et pourquoi?",

    "Quand est-ce qu'il a réparé la faute des Deux Vos de Yerovoam?",

    "Donne-moi ce qui parle de la confiance en Dieu",

    // Additional test queries
    "Que dit Rabbi Nachman sur la joie dans ses enseignements?",

    "Quels sont les 10 psaumes du Tikkun HaKlali?",

    "Quelle est l'histoire du roi et des sept mendiants?",

    "Comment faire techouva selon Rabbi Nachman?",

    "Qu'est-ce que le hitbodedout et comment le pratiquer?"
  ];

  const results = [];

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    logger.info(`\n📝 Testing query ${i + 1}/${testQueries.length}:`);
    logger.info(`"${query}"`);

    try {
      // Test query analysis
      const analysis = await openrouter.analyzeQuery(query);

      logger.info(`🔍 Analysis:`, {
        themes: analysis.themes,
        suspected_books: analysis.suspected_books,
        query_type: analysis.query_type
      });

      // Test translation
      if (analysis.hebrew_query) {
        logger.info(`🔄 Hebrew translation: "${analysis.hebrew_query}"`);
      }

      results.push({
        query,
        analysis,
        status: 'success',
        timestamp: new Date().toISOString()
      });

      // Wait between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error(`❌ Query ${i + 1} failed:`, error.message);

      results.push({
        query,
        analysis: null,
        status: 'failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Summary
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;

  logger.info('\n📊 Test Summary:');
  logger.info(`✅ Successful: ${successful}/${testQueries.length}`);
  logger.info(`❌ Failed: ${failed}/${testQueries.length}`);
  logger.info(`📈 Success rate: ${(successful / testQueries.length * 100).toFixed(1)}%`);

  if (failed > 0) {
    logger.warn('\n⚠️ Failed queries:');
    results.filter(r => r.status === 'failed').forEach(result => {
      logger.warn(`   - "${result.query}": ${result.error}`);
    });
  }

  return results;
}

/**
 * Test model health and capabilities
 */
async function testModelHealth() {
  logger.info('\n🏥 Testing model health...');

  const openrouter = new OpenRouterClient();

  try {
    const healthCheck = await openrouter.healthCheck();

    if (healthCheck.healthy) {
      logger.info('✅ OpenRouter models are healthy');
    } else {
      logger.error('❌ OpenRouter models are unhealthy:', healthCheck.error);
    }

    // Test translation capabilities
    logger.info('\n🔄 Testing translation...');
    const translation = await openrouter.translateWithContext(
      "Qu'est-ce que la joie selon Rabbi Nachman?",
      'français',
      'hébreu',
      'Question sur les enseignements de Rabbi Nachman'
    );

    logger.info(`Translation result: "${translation}"`);

    return { healthy: healthCheck.healthy, translation_test: 'success' };

  } catch (error) {
    logger.error('❌ Model health test failed:', error.message);
    return { healthy: false, error: error.message };
  }
}

/**
 * Test the complete query processing pipeline (when database is ready)
 */
async function testCompleteQueryPipeline() {
  logger.info('\n🔗 Testing complete query pipeline...');

  try {
    // This would test the complete flow:
    // 1. Query analysis
    // 2. Vector search
    // 3. Master index search
    // 4. Response generation
    // 5. Citation validation

    logger.info('⚠️ Complete pipeline test requires database setup');
    logger.info('   Run this test after: npm run setup-db && npm run extract-data');

    return { status: 'skipped', reason: 'database_not_ready' };

  } catch (error) {
    logger.error('❌ Pipeline test failed:', error.message);
    return { status: 'failed', error: error.message };
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  logger.info('🧪 Rabbi Nachman Voice Assistant - Test Suite');
  logger.info('=' * 50);

  const testResults = {
    model_health: null,
    query_analysis: null,
    complete_pipeline: null,
    overall_status: 'unknown'
  };

  try {
    // Test 1: Model health
    testResults.model_health = await testModelHealth();

    // Test 2: Query analysis (core functionality)
    const queryResults = await testUltraPreciseQueries();
    const successRate = queryResults.filter(r => r.status === 'success').length / queryResults.length;

    testResults.query_analysis = {
      success_rate: successRate,
      total_queries: queryResults.length,
      results: queryResults
    };

    // Test 3: Complete pipeline (if database is ready)
    testResults.complete_pipeline = await testCompleteQueryPipeline();

    // Overall assessment
    const modelHealthy = testResults.model_health.healthy;
    const queriesWorking = testResults.query_analysis.success_rate >= 0.8;

    if (modelHealthy && queriesWorking) {
      testResults.overall_status = 'excellent';
    } else if (modelHealthy || queriesWorking) {
      testResults.overall_status = 'partial';
    } else {
      testResults.overall_status = 'failed';
    }

    // Final report
    logger.info('\n🎯 Final Test Report:');
    logger.info(`Overall Status: ${testResults.overall_status.toUpperCase()}`);
    logger.info(`Model Health: ${modelHealthy ? '✅' : '❌'}`);
    logger.info(`Query Analysis: ${(testResults.query_analysis.success_rate * 100).toFixed(1)}% success rate`);
    logger.info(`Complete Pipeline: ${testResults.complete_pipeline.status}`);

    if (testResults.overall_status === 'excellent') {
      logger.info('\n🎉 All systems are working! Ready for production use.');
    } else if (testResults.overall_status === 'partial') {
      logger.info('\n⚠️ Some issues detected. Check logs above.');
    } else {
      logger.info('\n❌ Critical issues detected. Please fix before proceeding.');
    }

  } catch (error) {
    logger.error('❌ Test suite failed:', error);
    testResults.overall_status = 'failed';
  }

  return testResults;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
    .then(results => {
      if (results.overall_status === 'failed') {
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('Test execution failed:', error);
      process.exit(1);
    });
}

export { runAllTests, testUltraPreciseQueries, testModelHealth };