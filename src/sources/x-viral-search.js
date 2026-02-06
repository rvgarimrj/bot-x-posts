/**
 * X Viral Search
 * Uses Puppeteer to search X for viral tweets with media about our topics
 * Extracts tweet URLs for quote-tweeting with commentary
 */

import puppeteer from 'puppeteer-core'

// Search queries by topic
const SEARCH_QUERIES = {
  ai: [
    '"Claude Code" OR "AI agent" min_faves:100',
    '"Claude" OR "GPT-4" demo min_faves:200 filter:media',
    '"AI tool" OR "AI coding" min_faves:150 filter:media'
  ],
  vibeCoding: [
    '"vibe coding" OR "Cursor AI" min_faves:100',
    '"Claude Code" OR "AI pair programming" min_faves:100 filter:media',
    '"Copilot" OR "AI coding" demo min_faves:150'
  ],
  crypto: [
    'Bitcoin OR #BTC min_faves:500 filter:media',
    'crypto OR #crypto min_faves:500 filter:media',
    'Ethereum OR Solana min_faves:300 filter:media'
  ],
  investing: [
    'stocks OR market min_faves:500 filter:media',
    '$SPY OR $QQQ min_faves:300 filter:media',
    'earnings OR "stock market" min_faves:300 filter:media'
  ]
}

// In-memory cache (60 min)
const cache = new Map()
const CACHE_TTL = 60 * 60 * 1000

// Connection settings
const PROTOCOL_TIMEOUT = 120000
const PAGE_TIMEOUT = 30000

/**
 * Search X for viral tweets to quote
 * @param {string} topic - Topic to search for
 * @param {Object} options - Options
 * @param {number} options.limit - Max results (default 5)
 * @param {number} options.minLikes - Minimum likes (default 100)
 * @returns {Promise<Array>} Array of viral tweets
 */
export async function searchViralTweets(topic = 'ai', options = {}) {
  const { limit = 5, minLikes = 100 } = options

  // Check cache
  const cacheKey = `x-viral-${topic}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`   [x-search] Cache hit for ${topic} (${cached.data.length} items)`)
    return cached.data
  }

  const queries = SEARCH_QUERIES[topic] || SEARCH_QUERIES.ai
  // Use first query (most specific)
  const query = queries[0]

  console.log(`   [x-search] Searching X for: "${query}"`)

  let browser = null

  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
      protocolTimeout: PROTOCOL_TIMEOUT
    })

    const pages = await browser.pages()

    // Find an existing X tab or create one
    let page = null
    for (const p of pages) {
      const url = p.url()
      if ((url.includes('x.com') || url.includes('twitter.com')) && !url.includes('/compose')) {
        page = p
        break
      }
    }

    if (!page) {
      page = await browser.newPage()
    }

    page.setDefaultTimeout(PAGE_TIMEOUT)

    // Navigate to search
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&f=top`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT })
    await new Promise(r => setTimeout(r, 4000)) // Wait for tweets to load

    // Extract tweet data from the page
    const tweets = await page.evaluate((maxResults) => {
      const results = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      for (const article of articles) {
        if (results.length >= maxResults) break

        try {
          // Extract tweet URL from time link
          const timeLink = article.querySelector('time')?.parentElement
          const tweetUrl = timeLink?.getAttribute('href')
          if (!tweetUrl) continue

          // Extract author handle
          const authorEl = article.querySelector('[data-testid="User-Name"] a[role="link"]')
          const authorHandle = authorEl?.getAttribute('href')?.replace('/', '') || ''

          // Extract tweet text
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent || ''

          // Check for media (images, videos)
          const hasImage = article.querySelector('[data-testid="tweetPhoto"]') !== null
          const hasVideo = article.querySelector('[data-testid="videoPlayer"]') !== null ||
                          article.querySelector('video') !== null

          // Extract like count
          const likeBtn = article.querySelector('[data-testid="like"]') ||
                          article.querySelector('[data-testid="unlike"]')
          const likeText = likeBtn?.getAttribute('aria-label') || ''
          const likeMatch = likeText.match(/(\d[\d,]*)\s*(like|curtida)/i)
          const likes = likeMatch ? parseInt(likeMatch[1].replace(/,/g, '')) : 0

          // Extract retweet count
          const retweetBtn = article.querySelector('[data-testid="retweet"]') ||
                             article.querySelector('[data-testid="unretweet"]')
          const rtText = retweetBtn?.getAttribute('aria-label') || ''
          const rtMatch = rtText.match(/(\d[\d,]*)\s*(repost|retweet)/i)
          const retweets = rtMatch ? parseInt(rtMatch[1].replace(/,/g, '')) : 0

          results.push({
            tweetUrl: `https://x.com${tweetUrl}`,
            authorHandle,
            text: text.substring(0, 300),
            hasImage,
            hasVideo,
            hasMedia: hasImage || hasVideo,
            likes,
            retweets
          })
        } catch {
          // Skip malformed tweets
        }
      }

      return results
    }, limit * 2) // Fetch extra to allow filtering

    // Filter and sort
    const filtered = tweets
      .filter(t => t.likes >= minLikes)
      .filter(t => !t.authorHandle.includes('bot')) // Skip obvious bots
      .sort((a, b) => b.likes - a.likes)
      .slice(0, limit)
      .map(t => ({ ...t, topic }))

    console.log(`   [x-search] Found ${filtered.length} viral tweets for ${topic}`)

    // Cache results
    cache.set(cacheKey, { data: filtered, timestamp: Date.now() })

    browser.disconnect()
    return filtered

  } catch (err) {
    console.log(`   [x-search] Error: ${err.message}`)
    if (browser) browser.disconnect()
    return []
  }
}

/**
 * Clear the cache
 */
export function clearCache() {
  cache.clear()
}

export default { searchViralTweets, clearCache }
