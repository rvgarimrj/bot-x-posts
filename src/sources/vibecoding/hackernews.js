/**
 * Hacker News Source
 * Fetches top stories for tech/coding content
 */

import { BaseSource } from '../base-source.js'

export class HackerNewsSource extends BaseSource {
  constructor() {
    super('hackernews', {
      priority: 'primary',
      cacheTTL: 30 * 60 * 1000, // 30 min
      staleTTL: 2 * 60 * 60 * 1000, // 2h stale
      rateLimit: { requests: 100, perMinute: 1 } // HN is generous
    })
  }

  async fetch() {
    try {
      // Get top story IDs
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
        .then(r => r.json())

      if (!topIds?.length) {
        throw new Error('No stories found')
      }

      // Fetch top 20 stories in parallel
      const stories = await Promise.all(
        topIds.slice(0, 20).map(id =>
          fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
            .then(r => r.json())
            .catch(() => null)
        )
      )

      // Filter and process stories
      const processed = stories
        .filter(s => s && s.title)
        .map(s => {
          const age = (Date.now() - s.time * 1000) / (1000 * 60 * 60) // hours

          return {
            title: s.title,
            score: s.score,
            comments: s.descendants || 0,
            author: s.by,
            url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
            hnUrl: `https://news.ycombinator.com/item?id=${s.id}`,
            ageHours: age.toFixed(1),
            // Velocity: points per hour
            velocity: (s.score / Math.max(1, age)).toFixed(1)
          }
        })

      // Filter for AI/coding related stories
      const aiCodingKeywords = [
        'ai', 'gpt', 'claude', 'llm', 'cursor', 'copilot', 'openai', 'anthropic',
        'coding', 'programming', 'developer', 'typescript', 'rust', 'python',
        'ml', 'machine learning', 'neural', 'transformer', 'agent'
      ]

      const relevantStories = processed.filter(s => {
        const titleLower = s.title.toLowerCase()
        return aiCodingKeywords.some(keyword => titleLower.includes(keyword))
      })

      return {
        allStories: processed.slice(0, 10),
        relevantStories: relevantStories.slice(0, 10),
        timestamp: Date.now()
      }
    } catch (err) {
      console.error(`      [hackernews] Error:`, err.message)
      return null
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      hackerNews: data.allStories || [],
      relevantHN: data.relevantStories || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.allStories?.length > 0) {
      keyData.push(`${data.allStories.length} HN top stories`)
    }

    if (data.relevantStories?.length > 0) {
      keyData.push(`${data.relevantStories.length} AI/coding stories on HN`)
      const top = data.relevantStories[0]
      if (top) {
        keyData.push(`Top: "${top.title.substring(0, 60)}..." (${top.score} pts)`)
      }
    }

    return keyData
  }
}

export default HackerNewsSource
