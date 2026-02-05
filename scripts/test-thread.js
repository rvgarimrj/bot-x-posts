/**
 * Test Thread Generation and Posting (with Image)
 *
 * Usage:
 *   node scripts/test-thread.js                    # Generate and preview thread
 *   node scripts/test-thread.js --post             # Generate and POST thread (be careful!)
 *   node scripts/test-thread.js crypto en          # Specific topic and language
 *   node scripts/test-thread.js crypto en --post   # Post specific thread
 *   node scripts/test-thread.js --no-image         # Without image generation
 */

import 'dotenv/config'
import { generateThread, generateBestThread } from '../src/claude-v2.js'
import { curateContentV3, formatForPrompt, getFallbackContentV3 } from '../src/curate-v3.js'
import { postThread } from '../src/puppeteer-post.js'
import { generateImage, generateImagePrompt, cleanupTempImages } from '../src/image-generator.js'

const args = process.argv.slice(2)
const shouldPost = args.includes('--post')
const noImage = args.includes('--no-image')
const topic = args.find(a => ['crypto', 'investing', 'ai', 'vibeCoding'].includes(a)) || null
const language = args.find(a => ['en', 'pt-BR'].includes(a)) || 'en'

async function main() {
  console.log('🧵 Thread Generator Test')
  console.log('='.repeat(50))
  console.log(`📋 Topic: ${topic || 'auto-select best'}`)
  console.log(`🌍 Language: ${language}`)
  console.log(`🖼️ Image: ${noImage ? 'NO' : 'YES'}`)
  console.log(`📤 Will post: ${shouldPost ? 'YES (be careful!)' : 'NO (preview only)'}`)
  console.log()

  // ========== 1. CURATE CONTENT ==========

  console.log('1. Curando conteúdo...')
  let content
  try {
    const topics = topic ? [topic] : ['crypto', 'investing', 'ai', 'vibeCoding']
    content = await curateContentV3(topics)
  } catch (err) {
    console.log(`   ⚠️ Erro na curadoria: ${err.message}`)
    console.log('   ⚠️ Usando fallback')
    content = getFallbackContentV3()
  }

  // Show what we got
  for (const t of Object.keys(content)) {
    const data = content[t]
    if (data) {
      console.log(`   ${t}: ${data.sentiment || 'neutral'} - ${data.narrative?.substring(0, 50) || 'no narrative'}...`)
    }
  }

  // ========== 2. GENERATE THREAD ==========

  console.log('\n2. Gerando thread...')

  let thread
  if (topic) {
    // Specific topic
    const ctx = formatForPrompt(content, topic, language)
    thread = await generateThread(topic, ctx, language, 5)
    thread.topic = topic
  } else {
    // Auto-select best topic
    thread = await generateBestThread(content, language)
  }

  // ========== 3. GENERATE IMAGE ==========

  let threadImage = null
  if (!noImage && thread.tweets.length > 0) {
    console.log('\n3. Gerando imagem para primeiro tweet...')

    const imagePrompt = generateImagePrompt(thread.tweets[0], thread.topic, 'cyber')
    console.log(`   Prompt: "${imagePrompt.substring(0, 60)}..."`)

    const imageResult = await generateImage(imagePrompt)
    if (imageResult.success) {
      threadImage = imageResult.path
      console.log(`   ✅ Imagem gerada: ${threadImage}`)
    } else {
      console.log(`   ⚠️ Imagem falhou: ${imageResult.error}`)
    }
  }

  // Cleanup old images
  cleanupTempImages()

  // ========== 4. DISPLAY THREAD ==========

  console.log('\n' + '='.repeat(50))
  console.log(`🧵 THREAD PREVIEW (${thread.topic.toUpperCase()})`)
  console.log(`📊 Framework: ${thread._metadata.framework}`)
  console.log(`📝 ${thread.tweets.length} tweets, ${thread._metadata.totalChars} chars total`)
  if (threadImage) {
    console.log(`🖼️ Imagem: ${threadImage}`)
  }
  console.log('='.repeat(50))

  for (let i = 0; i < thread.tweets.length; i++) {
    const tweet = thread.tweets[i]
    const imgIndicator = (i === 0 && threadImage) ? ' 🖼️' : ''
    console.log(`\n[Tweet ${i + 1}/${thread.tweets.length}]${imgIndicator} (${tweet.length} chars)`)
    console.log('-'.repeat(40))
    console.log(tweet)
  }

  console.log('\n' + '='.repeat(50))

  // ========== 5. POST IF REQUESTED ==========

  if (shouldPost) {
    console.log('\n5. Postando thread...')
    console.log('   ⚠️ Você tem 5 segundos para cancelar (Ctrl+C)...')
    await new Promise(r => setTimeout(r, 5000))

    console.log('\n   🚀 Postando...')

    const result = await postThread(thread.tweets, (idx, total, status) => {
      if (status === 'composing') {
        console.log(`   📝 Preparando tweet ${idx + 1}/${total}...`)
      } else if (status === 'posted') {
        console.log(`   ✅ Thread publicada!`)
      }
    }, threadImage)  // Pass image for first tweet

    if (result.success) {
      const imgStr = threadImage ? ' com imagem' : ''
      console.log(`\n✅ Thread publicada${imgStr}! (${result.postedCount} tweets)`)
    } else {
      console.log(`\n❌ Thread falhou: ${result.error}`)
      console.log(`   Posted: ${result.postedCount}/${thread.tweets.length} tweets`)
    }
  } else {
    console.log('\n💡 Para postar esta thread, rode:')
    console.log(`   node scripts/test-thread.js ${topic || ''} ${language} --post`)
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
