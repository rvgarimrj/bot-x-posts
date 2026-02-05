/**
 * Image Generator using Google Gemini API (Imagen / Nano Banana)
 * Generates images from text prompts for tweets/threads
 */

import fs from 'fs'
import path from 'path'
import 'dotenv/config'

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY

// Gemini Image Generation endpoint
const GEMINI_IMAGE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict'

// Temp directory for generated images
const TEMP_DIR = '/tmp/bot-x-images'

// Default image settings optimized for X/Twitter
const DEFAULT_OPTIONS = {
  numberOfImages: 1,
  aspectRatio: '16:9',  // Good for X timeline
  personGeneration: 'DONT_ALLOW',  // Avoid people for safer content
  safetyFilterLevel: 'BLOCK_MEDIUM_AND_ABOVE'
}

/**
 * Ensure temp directory exists
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }
}

/**
 * Generate image from prompt using Gemini Imagen API
 * @param {string} prompt - Image description
 * @param {Object} options - Optional settings
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function generateImage(prompt, options = {}) {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GOOGLE_GEMINI_API_KEY não configurada no .env' }
  }

  ensureTempDir()

  const opts = { ...DEFAULT_OPTIONS, ...options }

  console.log(`   🎨 Gerando imagem com Gemini...`)
  console.log(`   Prompt: "${prompt.substring(0, 60)}..."`)

  try {
    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: opts.numberOfImages,
          aspectRatio: opts.aspectRatio,
          personGeneration: opts.personGeneration,
          safetyFilterLevel: opts.safetyFilterLevel
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.log(`   ❌ Erro API: ${response.status}`)

      // Try alternative model if Imagen fails
      if (response.status === 404 || response.status === 400) {
        console.log(`   🔄 Tentando modelo alternativo (gemini-2.0-flash)...`)
        return await generateImageWithGeminiFlash(prompt, opts)
      }

      return { success: false, error: `API error: ${response.status} - ${errorText}` }
    }

    const data = await response.json()

    if (!data.predictions || data.predictions.length === 0) {
      return { success: false, error: 'Nenhuma imagem gerada' }
    }

    // Decode base64 image
    const imageData = data.predictions[0].bytesBase64Encoded
    if (!imageData) {
      return { success: false, error: 'Imagem sem dados base64' }
    }

    // Save to file
    const filename = `tweet-img-${Date.now()}.png`
    const filepath = path.join(TEMP_DIR, filename)

    const buffer = Buffer.from(imageData, 'base64')
    fs.writeFileSync(filepath, buffer)

    const stats = fs.statSync(filepath)
    console.log(`   ✅ Imagem gerada: ${filepath} (${Math.round(stats.size/1024)}KB)`)

    return { success: true, path: filepath }

  } catch (err) {
    console.log(`   ❌ Erro: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Alternative: Generate image using Gemini 2.0 Flash Image Generation
 */
async function generateImageWithGeminiFlash(prompt, options = {}) {
  // Correct model name for image generation
  const FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent'

  try {
    const response = await fetch(`${FLASH_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate an image: ${prompt}`
          }]
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `Flash API error: ${response.status} - ${errorText}` }
    }

    const data = await response.json()

    // Extract image from response
    const candidates = data.candidates || []
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || []
      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          const imageData = part.inlineData.data
          const filename = `tweet-img-${Date.now()}.png`
          const filepath = path.join(TEMP_DIR, filename)

          const buffer = Buffer.from(imageData, 'base64')
          fs.writeFileSync(filepath, buffer)

          const stats = fs.statSync(filepath)
          console.log(`   ✅ Imagem gerada (Flash): ${filepath} (${Math.round(stats.size/1024)}KB)`)

          return { success: true, path: filepath }
        }
      }
    }

    return { success: false, error: 'Nenhuma imagem na resposta do Flash' }

  } catch (err) {
    return { success: false, error: `Flash error: ${err.message}` }
  }
}

/**
 * Generate image prompt based on tweet content and topic
 * @param {string} tweetText - The tweet text
 * @param {string} topic - Topic (crypto, investing, ai, vibeCoding)
 * @param {string} style - Visual style preference
 * @returns {string} Image prompt
 */
export function generateImagePrompt(tweetText, topic, style = 'modern') {
  // Base style modifiers for consistent aesthetic
  const styleModifiers = {
    modern: 'minimalist, clean design, modern aesthetic, professional, dark background',
    cyber: 'cyberpunk, neon colors, futuristic, dark background with neon accents',
    chart: 'data visualization, clean chart, infographic style, dark theme',
    abstract: 'abstract art, geometric shapes, gradient colors, modern design',
    photo: 'photorealistic, high quality, cinematic lighting, professional'
  }

  // Topic-specific visual elements
  const topicElements = {
    crypto: 'bitcoin symbol, cryptocurrency, blockchain visualization, digital gold, financial chart',
    investing: 'stock market chart, financial graphs, candlestick chart, green and red colors',
    ai: 'artificial intelligence, neural network visualization, futuristic technology, digital brain',
    vibeCoding: 'code editor, programming, developer workspace, terminal, syntax highlighting'
  }

  // Extract mood from tweet
  const hasBullish = /bull|up|green|pump|moon|profit|buy|growth/i.test(tweetText)
  const hasBearish = /bear|down|red|dump|fear|crash|sell|drop/i.test(tweetText)
  const hasData = /\d+%|\$\d+|\d+x/i.test(tweetText)

  // Build prompt
  let prompt = ''

  // Add topic elements
  prompt += topicElements[topic] || topicElements.crypto
  prompt += ', '

  // Add mood-based colors
  if (hasBearish) {
    prompt += 'red and orange color scheme, dramatic lighting, '
  } else if (hasBullish) {
    prompt += 'green and gold color scheme, optimistic mood, upward arrows, '
  } else {
    prompt += 'blue and purple color scheme, neutral mood, '
  }

  // Add data visualization if numbers present
  if (hasData) {
    prompt += 'with data visualization elements, '
  }

  // Add style
  prompt += styleModifiers[style] || styleModifiers.modern

  // Add quality and safety modifiers
  prompt += ', high quality, 4k resolution, no text, no watermark, no people, safe for work'

  return prompt
}

/**
 * Clean up old temporary images
 * @param {number} maxAgeMs - Max age in milliseconds (default 1 hour)
 */
export function cleanupTempImages(maxAgeMs = 3600000) {
  ensureTempDir()

  const now = Date.now()
  let cleaned = 0

  try {
    const files = fs.readdirSync(TEMP_DIR)

    for (const file of files) {
      const filepath = path.join(TEMP_DIR, file)
      const stats = fs.statSync(filepath)

      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filepath)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`   🧹 Limpou ${cleaned} imagens antigas`)
    }
  } catch (err) {
    // Ignore errors during cleanup
  }
}

/**
 * Test image generation
 */
export async function testImageGeneration() {
  console.log('🧪 Testando geração de imagem com Gemini...\n')

  if (!GEMINI_API_KEY) {
    console.log('❌ GOOGLE_GEMINI_API_KEY não encontrada no .env')
    return { success: false, error: 'API key não configurada' }
  }

  console.log('✅ API key encontrada\n')

  const testPrompt = generateImagePrompt(
    'Fear & Greed at 12 while BTC holds $69k. Everyone panicking but this is historically a buying signal.',
    'crypto',
    'cyber'
  )

  console.log('Prompt gerado:')
  console.log(testPrompt)
  console.log('')

  const result = await generateImage(testPrompt)

  if (result.success) {
    console.log('\n✅ Teste bem sucedido!')
    console.log(`Imagem salva em: ${result.path}`)
  } else {
    console.log('\n❌ Teste falhou:', result.error)
  }

  return result
}

// Run test if called directly
const isMainModule = process.argv[1]?.includes('image-generator')
if (isMainModule) {
  testImageGeneration()
}
