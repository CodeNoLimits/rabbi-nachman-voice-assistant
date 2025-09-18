import fs from 'fs';
import path from 'path';

// Read and debug one file
const filePath = '/Users/codenolimits-dreamai-nanach/rabbi-nachman-voice-assistant/data/raw/Sippurei_Maasiyot_API_v2_1758152438417.json';

try {
  const rawData = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(rawData);

  console.log('📄 File structure:');
  console.log('Keys in jsonData:', Object.keys(jsonData));
  console.log('\n🔍 Data.data structure:');
  console.log('Keys in data.data:', Object.keys(jsonData.data));

  const bookData = jsonData.data;

  // Check text arrays
  console.log('\n📊 Text analysis:');
  console.log('Has he array:', !!bookData.he, 'Length:', bookData.he ? bookData.he.length : 0);
  console.log('Has text array:', !!bookData.text, 'Length:', bookData.text ? bookData.text.length : 0);
  console.log('Has sections:', !!bookData.sections);

  if (bookData.text && bookData.text.length > 0) {
    console.log('\n📝 First English text sample:');
    console.log(bookData.text[0].substring(0, 200) + '...');
  }

  if (bookData.he && bookData.he.length > 0) {
    console.log('\n📝 First Hebrew text sample:');
    console.log(bookData.he[0].substring(0, 200) + '...');
  }

  // Simple chunk test
  console.log('\n🔧 Testing chunking logic:');

  const englishText = Array.isArray(bookData.text) ? bookData.text.join('\n\n') : (bookData.text || '');
  const hebrewText = Array.isArray(bookData.he) ? bookData.he.join('\n\n') : (bookData.he || '');

  console.log('Combined English length:', englishText.length);
  console.log('Combined Hebrew length:', hebrewText.length);

  if (englishText || hebrewText) {
    console.log('✅ Text content available for chunking');

    // Simple chunking test
    const textToChunk = englishText || hebrewText;
    const cleanText = textToChunk.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '');

    console.log('Clean text length:', cleanText.length);
    console.log('Sample clean text:', cleanText.substring(0, 300) + '...');

    if (cleanText.length > 0) {
      console.log('🎉 Ready for chunking!');
    } else {
      console.log('❌ No content after cleaning');
    }
  } else {
    console.log('❌ No text content found');
  }

} catch (error) {
  console.error('❌ Error:', error.message);
}