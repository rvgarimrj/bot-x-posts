/**
 * Reddit Media Source
 * Fetches viral video, image and GIF posts from meme/tech subreddits
 * Standalone module - NOT registered in curate-v3 pipeline, called on-demand
 */

const USER_AGENT = 'BotXPosts/3.0'

// Subreddits by topic for media content
const MEDIA_SUBREDDITS = {
  crypto: ['CryptoCurrency', 'wallstreetbets', 'Bitcoin'],
  investing: ['wallstreetbets', 'stocks'],
  ai: ['ProgrammerHumor', 'ChatGPT', 'ClaudeAI', 'LocalLLaMA'],
  vibeCoding: ['ProgrammerHumor', 'programmingmemes', 'Cursor'],
  general: ['funny', 'Unexpected', 'MadeMeSmile']
}

// Keywords for relevance validation per topic
const TOPIC_KEYWORDS = {
  crypto: ['bitcoin', 'btc', 'eth', 'ethereum', 'crypto', 'blockchain', 'defi', 'nft', 'hodl', 'moon', 'bear', 'bull', 'altcoin', 'wallet', 'mining', 'satoshi', 'doge', 'solana', 'sol'],
  investing: ['stock', 'market', 'portfolio', 'trade', 'invest', 'earnings', 'dividend', 'bull', 'bear', 'sp500', 'nasdaq', 'dow', 'fed', 'inflation', 'recession', 'ipo', 'etf', 'options', 'puts', 'calls', 'wsb'],
  ai: ['ai', 'gpt', 'claude', 'llm', 'chatgpt', 'openai', 'anthropic', 'copilot', 'machine learning', 'neural', 'model', 'prompt', 'transformer', 'gemini', 'midjourney', 'stable diffusion', 'artificial intelligence'],
  vibeCoding: ['code', 'coding', 'programming', 'developer', 'dev', 'software', 'bug', 'debug', 'cursor', 'copilot', 'github', 'stack overflow', 'javascript', 'python', 'react', 'api', 'deploy', 'git', 'vibe coding', 'claude code'],
  general: [] // No keyword filter for general - all content accepted
}

// Known NSFW subreddits to always skip
const NSFW_SUBREDDITS = new Set([
  'nsfw', 'gonewild', 'realgirls', 'holdthemoan', 'rule34',
  'hentai', 'porn', 'sex', 'xxx', 'adult'
])

// In-memory cache (30 min)
const cache = new Map()
const CACHE_TTL = 30 * 60 * 1000

/**
 * Fetch viral media posts from Reddit for a given topic
 * @param {string} topic - Topic (crypto, investing, ai, vibeCoding, general)
 * @param {Object} options - Options
 * @param {number} options.minScore - Minimum upvotes (default 500)
 * @param {number} options.maxAgeDays - Max post age in days (default 7)
 * @param {number} options.limit - Max results to return (default 10)
 * @returns {Promise<Array>} Array of media posts
 */
export async function fetchRedditMedia(topic = 'general', options = {}) {
  const {
    minScore = 500,
    maxAgeDays = 7,
    limit = 10
  } = options

  // Check cache
  const cacheKey = `reddit-media-${topic}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`   [reddit-media] Cache hit for ${topic} (${cached.data.length} items)`)
    return cached.data
  }

  const subreddits = MEDIA_SUBREDDITS[topic] || MEDIA_SUBREDDITS.general
  const keywords = TOPIC_KEYWORDS[topic] || []

  console.log(`   [reddit-media] Fetching from: ${subreddits.map(s => `r/${s}`).join(', ')}`)

  // Fetch from all subreddits in parallel
  const results = await Promise.allSettled(
    subreddits.map(sub => fetchSubredditMedia(sub, 25))
  )

  // Merge all posts
  const allPosts = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      allPosts.push(...result.value)
    }
  }

  // Filter by criteria
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const now = Date.now()

  const filtered = allPosts.filter(post => {
    // Score filter
    if (post.score < minScore) return false

    // Age filter
    if (now - post.createdAt > maxAgeMs) return false

    // NSFW filter
    if (post.over18) return false
    if (post.spoiler) return false
    if (NSFW_SUBREDDITS.has(post.subreddit.toLowerCase())) return false

    // Must have media
    if (!post.mediaUrl) return false

    // Video duration filter (max 60s)
    if (post.mediaType === 'video' && post.duration > 60) return false

    // Keyword relevance (skip for 'general' topic)
    if (keywords.length > 0) {
      const titleLower = post.title.toLowerCase()
      const hasKeyword = keywords.some(kw => titleLower.includes(kw.toLowerCase()))
      if (!hasKeyword) return false
    }

    return true
  })

  // Sort by score (most viral first)
  const sorted = filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  console.log(`   [reddit-media] Found ${sorted.length} media posts for ${topic} (from ${allPosts.length} total)`)

  // Cache results
  cache.set(cacheKey, { data: sorted, timestamp: Date.now() })

  return sorted
}

/**
 * Fetch media posts from a single subreddit
 * @param {string} subreddit - Subreddit name
 * @param {number} limit - Posts to fetch
 * @returns {Promise<Array>} Media posts
 */
async function fetchSubredditMedia(subreddit, limit = 25) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot/.json?limit=${limit}`, {
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!res.ok) {
      console.log(`   [reddit-media] r/${subreddit}: HTTP ${res.status}`)
      return []
    }

    const data = await res.json()

    return data.data.children
      .filter(p => !p.data.stickied)
      .map(p => {
        const post = p.data
        const media = detectMedia(post)

        return {
          title: post.title,
          subreddit,
          score: post.score,
          comments: post.num_comments,
          upvoteRatio: post.upvote_ratio,
          over18: post.over_18,
          spoiler: post.spoiler,
          mediaUrl: media.url,
          mediaType: media.type, // 'video', 'image', 'gif'
          thumbnailUrl: post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : null,
          duration: media.duration || null,
          permalink: `https://reddit.com${post.permalink}`,
          createdAt: post.created_utc * 1000,
          author: post.author,
          topic: null // Will be set by caller
        }
      })
      .filter(p => p.mediaUrl) // Only posts with detected media
  } catch (err) {
    console.log(`   [reddit-media] r/${subreddit} error: ${err.message}`)
    return []
  }
}

/**
 * Detect media type and URL from Reddit post data
 * @param {Object} post - Reddit post data
 * @returns {{ type: string|null, url: string|null, duration: number|null }}
 */
function detectMedia(post) {
  // 1. Reddit-hosted video
  if (post.is_video && post.media?.reddit_video?.fallback_url) {
    return {
      type: 'video',
      url: post.media.reddit_video.fallback_url,
      duration: post.media.reddit_video.duration || null
    }
  }

  // 2. Direct image (i.redd.it)
  if (post.post_hint === 'image' && post.url) {
    // Check if it's a GIF
    if (post.url.endsWith('.gif')) {
      return { type: 'gif', url: post.url, duration: null }
    }
    return { type: 'image', url: post.url, duration: null }
  }

  // 3. Reddit preview images (higher quality)
  if (post.preview?.images?.[0]?.source?.url) {
    const previewUrl = post.preview.images[0].source.url.replace(/&amp;/g, '&')

    // Check for animated GIF variant
    if (post.preview.images[0].variants?.gif?.source?.url) {
      const gifUrl = post.preview.images[0].variants.gif.source.url.replace(/&amp;/g, '&')
      return { type: 'gif', url: gifUrl, duration: null }
    }

    // Check for MP4 variant (better for videos)
    if (post.preview.images[0].variants?.mp4?.source?.url) {
      const mp4Url = post.preview.images[0].variants.mp4.source.url.replace(/&amp;/g, '&')
      return { type: 'video', url: mp4Url, duration: null }
    }

    // Check if URL looks like an image
    if (/\.(jpg|jpeg|png|gif|webp)/i.test(post.url)) {
      return { type: 'image', url: post.url, duration: null }
    }

    return { type: 'image', url: previewUrl, duration: null }
  }

  // 4. Imgur links
  if (post.url && post.domain === 'i.imgur.com') {
    if (post.url.endsWith('.gif') || post.url.endsWith('.gifv')) {
      // Convert .gifv to .mp4 for better compatibility
      const mp4Url = post.url.replace('.gifv', '.mp4')
      return { type: post.url.endsWith('.gifv') ? 'video' : 'gif', url: mp4Url, duration: null }
    }
    return { type: 'image', url: post.url, duration: null }
  }

  // 5. Direct URL ending in media extension
  if (post.url && /\.(jpg|jpeg|png|gif|mp4|webm)(\?.*)?$/i.test(post.url)) {
    const isVideo = /\.(mp4|webm)(\?.*)?$/i.test(post.url)
    const isGif = /\.gif(\?.*)?$/i.test(post.url)
    return {
      type: isVideo ? 'video' : isGif ? 'gif' : 'image',
      url: post.url,
      duration: null
    }
  }

  return { type: null, url: null, duration: null }
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache() {
  cache.clear()
}

export default { fetchRedditMedia, clearCache }
