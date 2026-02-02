/**
 * Generic Reddit Source
 * Fetches hot posts from any subreddit
 */

import { BaseSource } from './base-source.js'

const USER_AGENT = 'BotXPosts/3.0'

// Subreddit configurations by topic
export const SUBREDDIT_CONFIG = {
  crypto: {
    subreddits: ['cryptocurrency', 'bitcoin', 'ethereum'],
    keywords: ['$BTC', '$ETH', 'Bitcoin', 'crypto'],
    extractTickers: true,
    tickerRegex: /\$([A-Z]{2,5})\b/g
  },
  investing: {
    subreddits: ['stocks', 'wallstreetbets', 'investing'],
    keywords: ['$NVDA', '$TSLA', 'earnings', 'market'],
    extractTickers: true,
    tickerRegex: /\$([A-Z]{1,5})\b/g
  },
  ai: {
    subreddits: ['MachineLearning', 'ChatGPT', 'LocalLLaMA', 'artificial'],
    keywords: ['GPT', 'Claude', 'LLM', 'AI model', 'neural'],
    extractTickers: false
  },
  vibeCoding: {
    subreddits: ['Cursor', 'LocalLLaMA', 'ClaudeAI'],
    keywords: ['Cursor', 'Claude Code', 'Copilot', 'AI coding', 'vibe coding'],
    extractTickers: false
  }
}

export class RedditSource extends BaseSource {
  constructor(topic, options = {}) {
    const config = SUBREDDIT_CONFIG[topic] || {}
    super(`reddit-${topic}`, {
      priority: options.priority || 'primary',
      cacheTTL: 15 * 60 * 1000, // 15 min
      staleTTL: 60 * 60 * 1000, // 1h stale
      rateLimit: { requests: 60, perMinute: 1 } // Reddit is generous
    })

    this.topic = topic
    this.subreddits = config.subreddits || []
    this.keywords = config.keywords || []
    this.extractTickers = config.extractTickers || false
    this.tickerRegex = config.tickerRegex
  }

  async fetch() {
    if (this.subreddits.length === 0) {
      return null
    }

    // Fetch from all configured subreddits in parallel
    const results = await Promise.allSettled(
      this.subreddits.map(sub => this.fetchSubreddit(sub))
    )

    // Merge all posts
    const allPosts = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allPosts.push(...result.value)
      }
    }

    // Sort by engagement score
    const sorted = allPosts
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 20)

    // Extract tickers if configured
    let tickers = []
    if (this.extractTickers && this.tickerRegex) {
      const tickerCount = new Map()
      for (const post of sorted) {
        const matches = (post.title + ' ' + (post.selftext || '')).match(this.tickerRegex) || []
        for (const ticker of matches) {
          tickerCount.set(ticker, (tickerCount.get(ticker) || 0) + 1)
        }
      }
      tickers = [...tickerCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ticker, count]) => ({ ticker, count }))
    }

    // Extract keywords/hashtags
    const keywordCount = new Map()
    for (const post of sorted) {
      const text = (post.title + ' ' + (post.selftext || '')).toLowerCase()
      for (const keyword of this.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          keywordCount.set(keyword, (keywordCount.get(keyword) || 0) + 1)
        }
      }
    }
    const topKeywords = [...keywordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([keyword, count]) => ({ keyword, count }))

    return {
      posts: sorted.slice(0, 10),
      tickers,
      topKeywords,
      totalPosts: sorted.length
    }
  }

  async fetchSubreddit(subreddit, limit = 15) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot/.json?limit=${limit}`, {
        headers: { 'User-Agent': USER_AGENT }
      })

      if (!res.ok) {
        throw new Error(`Reddit ${subreddit}: ${res.status}`)
      }

      const data = await res.json()

      return data.data.children
        .filter(p => !p.data.stickied)
        .map(p => {
          const post = p.data
          const age = (Date.now() - post.created_utc * 1000) / (1000 * 60 * 60) // hours

          return {
            title: post.title,
            selftext: post.selftext?.substring(0, 500) || '',
            score: post.score,
            comments: post.num_comments,
            upvoteRatio: post.upvote_ratio,
            subreddit,
            author: post.author,
            url: `https://reddit.com${post.permalink}`,
            ageHours: age.toFixed(1),
            // Engagement score: upvotes + comments*2, weighted by recency
            engagement: Math.round((post.score + post.num_comments * 2) / Math.max(1, age))
          }
        })
    } catch (err) {
      console.error(`      [reddit-${this.topic}] ${subreddit} error:`, err.message)
      return []
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      redditPosts: data.posts || [],
      redditTickers: data.tickers || [],
      redditKeywords: data.topKeywords || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.posts?.length > 0) {
      keyData.push(`Reddit: ${data.posts.length} hot posts from r/${this.subreddits.join(', r/')}`)
    }

    if (data.tickers?.length > 0) {
      keyData.push(`Trending tickers: ${data.tickers.slice(0, 5).map(t => t.ticker).join(', ')}`)
    }

    const topPost = data.posts?.[0]
    if (topPost) {
      keyData.push(`Top post: "${topPost.title.substring(0, 80)}..." (${topPost.score} upvotes)`)
    }

    return keyData
  }
}

export default RedditSource
