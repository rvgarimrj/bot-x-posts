/**
 * Media Downloader
 * Downloads video/image/GIF from Reddit to /tmp/bot-x-media/
 * Includes Gemini Vision safety check for content moderation
 */

import fs from 'fs'
import path from 'path'
import 'dotenv/config'

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY
const TEMP_DIR = '/tmp/bot-x-media'

// File size limits
const MAX_VIDEO_SIZE = 50 * 1024 * 1024  // 50MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024  // 10MB

const USER_AGENT = 'BotXPosts/3.0'

/**
 * Ensure temp directory exists
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }
}

/**
 * Download media file from URL
 * @param {string} url - Media URL
 * @param {string} type - Media type: 'video', 'image', 'gif'
 * @returns {Promise<{success: boolean, path?: string, size?: number, error?: string}>}
 */
export async function downloadMedia(url, type = 'video') {
  ensureTempDir()

  const maxSize = type === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
  const ext = getExtension(url, type)
  const filename = `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`
  const filepath = path.join(TEMP_DIR, filename)

  console.log(`   [media-dl] Downloading ${type}: ${url.substring(0, 80)}...`)

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow'
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    // Check content length if available
    const contentLength = parseInt(response.headers.get('content-length') || '0')
    if (contentLength > maxSize) {
      return { success: false, error: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB (max ${Math.round(maxSize / 1024 / 1024)}MB)` }
    }

    // Stream to file
    const buffer = Buffer.from(await response.arrayBuffer())

    if (buffer.length > maxSize) {
      return { success: false, error: `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB` }
    }

    fs.writeFileSync(filepath, buffer)

    const size = buffer.length
    console.log(`   [media-dl] Downloaded: ${filepath} (${Math.round(size / 1024)}KB)`)

    return { success: true, path: filepath, size }
  } catch (err) {
    // Cleanup on error
    try { fs.unlinkSync(filepath) } catch {}
    return { success: false, error: err.message }
  }
}

/**
 * Check media safety using Gemini Vision API
 * Sends image/thumbnail to Gemini for content moderation
 * @param {string} imagePath - Path to image file (or thumbnail for videos)
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
export async function checkMediaSafety(imagePath) {
  if (!GEMINI_API_KEY) {
    console.log('   [safety] No Gemini API key, skipping safety check')
    return { safe: true, reason: 'No API key - skipped' }
  }

  if (!fs.existsSync(imagePath)) {
    return { safe: false, reason: 'File not found' }
  }

  console.log('   [safety] Running Gemini Vision safety check...')

  try {
    // Read image as base64
    const imageBuffer = fs.readFileSync(imagePath)
    const base64Image = imageBuffer.toString('base64')

    // Detect mime type from extension
    const ext = path.extname(imagePath).toLowerCase()
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.mp4': 'video/mp4'
    }
    const mimeType = mimeTypes[ext] || 'image/jpeg'

    const FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

    const response = await fetch(`${FLASH_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image
              }
            },
            {
              text: 'Is this image safe for a professional Twitter account? Check for: nudity, sexual content, violence, gore, hate symbols, illegal content, drug use. Reply with ONLY "SAFE" or "UNSAFE: reason".'
            }
          ]
        }],
        safetySettings: [
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      })
    })

    if (!response.ok) {
      // If API fails, err on the side of caution but don't block
      console.log(`   [safety] API error ${response.status}, proceeding with caution`)
      return { safe: true, reason: `API error ${response.status} - skipped` }
    }

    const data = await response.json()

    // Check if blocked by safety filters
    if (data.promptFeedback?.blockReason) {
      console.log(`   [safety] BLOCKED by Gemini: ${data.promptFeedback.blockReason}`)
      return { safe: false, reason: `Gemini blocked: ${data.promptFeedback.blockReason}` }
    }

    // Parse response text
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const isSafe = responseText.trim().toUpperCase().startsWith('SAFE')

    if (isSafe) {
      console.log('   [safety] Content is SAFE')
      return { safe: true }
    } else {
      const reason = responseText.replace(/^UNSAFE:\s*/i, '').trim()
      console.log(`   [safety] Content is UNSAFE: ${reason}`)
      return { safe: false, reason }
    }
  } catch (err) {
    // On error, allow but log warning
    console.log(`   [safety] Check failed: ${err.message}, proceeding with caution`)
    return { safe: true, reason: `Error: ${err.message} - skipped` }
  }
}

/**
 * Download thumbnail for safety check (for videos)
 * Uses Reddit's thumbnail URL instead of downloading full video first
 * @param {string} thumbnailUrl - Reddit thumbnail URL
 * @returns {Promise<{success: boolean, path?: string}>}
 */
export async function downloadThumbnail(thumbnailUrl) {
  if (!thumbnailUrl || !thumbnailUrl.startsWith('http')) {
    return { success: false }
  }

  ensureTempDir()

  const filename = `thumb-${Date.now()}.jpg`
  const filepath = path.join(TEMP_DIR, filename)

  try {
    const response = await fetch(thumbnailUrl, {
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!response.ok) return { success: false }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(filepath, buffer)

    return { success: true, path: filepath }
  } catch {
    return { success: false }
  }
}

/**
 * Clean up old temporary media files
 * @param {number} maxAgeMs - Max age in milliseconds (default 1 hour)
 */
export function cleanupTempMedia(maxAgeMs = 3600000) {
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
      console.log(`   [media-dl] Cleaned ${cleaned} old media files`)
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Get file extension from URL and type
 */
function getExtension(url, type) {
  // Try to extract from URL
  const urlMatch = url.match(/\.(jpg|jpeg|png|gif|mp4|webm|webp)(\?|$)/i)
  if (urlMatch) return `.${urlMatch[1].toLowerCase()}`

  // Fallback by type
  const defaults = { video: '.mp4', image: '.jpg', gif: '.gif' }
  return defaults[type] || '.bin'
}

export default { downloadMedia, checkMediaSafety, downloadThumbnail, cleanupTempMedia }
