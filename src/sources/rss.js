/**
 * Generic RSS Source
 * Fetches and parses RSS feeds
 */

import { BaseSource } from './base-source.js'

// RSS feed configurations by topic
export const RSS_CONFIG = {
  crypto: [
    { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph' },
    { url: 'https://cryptonews.com/news/feed/', name: 'CryptoNews' }
  ],
  investing: [
    { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', name: 'MarketWatch' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg' }
  ],
  ai: [
    { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', name: 'TechCrunch AI' },
    { url: 'https://www.anthropic.com/feed', name: 'Anthropic' },
    { url: 'https://openai.com/blog/rss/', name: 'OpenAI' }
  ],
  vibeCoding: [
    { url: 'https://dev.to/feed', name: 'Dev.to' },
    { url: 'https://hnrss.org/frontpage', name: 'HN RSS' }
  ]
}

export class RSSSource extends BaseSource {
  constructor(topic, options = {}) {
    const config = RSS_CONFIG[topic] || []
    super(`rss-${topic}`, {
      priority: options.priority || 'fallback',
      cacheTTL: 30 * 60 * 1000, // 30 min
      staleTTL: 2 * 60 * 60 * 1000, // 2h stale
      rateLimit: { requests: 100, perMinute: 1 } // RSS is unlimited
    })

    this.topic = topic
    this.feeds = config
  }

  async fetch() {
    if (this.feeds.length === 0) {
      return null
    }

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      this.feeds.map(feed => this.fetchFeed(feed))
    )

    // Merge all items
    const allItems = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allItems.push(...result.value)
      }
    }

    // Sort by date (most recent first)
    const sorted = allItems.sort((a, b) =>
      new Date(b.pubDate) - new Date(a.pubDate)
    )

    return {
      items: sorted.slice(0, 20),
      sources: this.feeds.map(f => f.name),
      timestamp: Date.now()
    }
  }

  async fetchFeed(feed) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'BotXPosts/3.0' }
      })

      if (!res.ok) {
        throw new Error(`RSS ${feed.name}: ${res.status}`)
      }

      const xml = await res.text()
      return this.parseRSS(xml, feed.name)
    } catch (err) {
      console.error(`      [rss-${this.topic}] ${feed.name} error:`, err.message)
      return []
    }
  }

  parseRSS(xml, sourceName) {
    const items = []

    // Try RSS 2.0 format
    const rssItems = xml.split('<item>').slice(1)
    for (const item of rssItems) {
      try {
        const title = this.extractTag(item, 'title')
        const link = this.extractTag(item, 'link')
        const description = this.extractTag(item, 'description')
        const pubDate = this.extractTag(item, 'pubDate')

        if (title) {
          items.push({
            title: this.cleanText(title),
            link,
            description: this.cleanText(description || '').substring(0, 300),
            pubDate: pubDate || new Date().toISOString(),
            source: sourceName
          })
        }
      } catch (e) {
        // Skip malformed items
      }
    }

    // Try Atom format if no RSS items found
    if (items.length === 0) {
      const atomEntries = xml.split('<entry>').slice(1)
      for (const entry of atomEntries) {
        try {
          const title = this.extractTag(entry, 'title')
          const linkMatch = entry.match(/<link[^>]*href="([^"]*)"/)
          const link = linkMatch ? linkMatch[1] : this.extractTag(entry, 'link')
          const summary = this.extractTag(entry, 'summary') || this.extractTag(entry, 'content')
          const published = this.extractTag(entry, 'published') || this.extractTag(entry, 'updated')

          if (title) {
            items.push({
              title: this.cleanText(title),
              link,
              description: this.cleanText(summary || '').substring(0, 300),
              pubDate: published || new Date().toISOString(),
              source: sourceName
            })
          }
        } catch (e) {
          // Skip malformed entries
        }
      }
    }

    return items.slice(0, 10)
  }

  extractTag(xml, tag) {
    // Handle CDATA
    const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)
    const cdataMatch = xml.match(cdataRegex)
    if (cdataMatch) return cdataMatch[1]

    // Regular tag
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
    const match = xml.match(regex)
    return match ? match[1] : null
  }

  cleanText(text) {
    if (!text) return ''
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  normalize(data) {
    if (!data) return null

    return {
      rssItems: data.items || [],
      rssSources: data.sources || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.items?.length > 0) {
      keyData.push(`${data.items.length} RSS articles from ${data.sources?.length || 0} feeds`)

      const top = data.items[0]
      if (top) {
        keyData.push(`Latest: "${top.title.substring(0, 60)}..." (${top.source})`)
      }
    }

    return keyData
  }
}

export default RSSSource
