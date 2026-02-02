/**
 * GitHub Source
 * Fetches trending repos and releases
 */

import { BaseSource } from '../base-source.js'

export class GitHubSource extends BaseSource {
  constructor() {
    super('github', {
      priority: 'primary',
      cacheTTL: 60 * 60 * 1000, // 1h (GitHub data doesn't change rapidly)
      staleTTL: 4 * 60 * 60 * 1000, // 4h stale
      rateLimit: { requests: 60, perMinute: 1 } // GitHub unauthenticated limit
    })

    this.token = process.env.GITHUB_TOKEN // Optional, increases rate limit
  }

  async fetch() {
    const [trending, aiRepos] = await Promise.all([
      this.fetchTrending(),
      this.fetchAIRepos()
    ])

    return {
      trending: trending || [],
      aiRepos: aiRepos || [],
      timestamp: Date.now()
    }
  }

  getHeaders() {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'BotXPosts/3.0'
    }
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`
    }
    return headers
  }

  async fetchTrending() {
    try {
      // GitHub doesn't have an official trending API
      // Use search with created date filter for recent popular repos
      const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0]

      const res = await fetch(
        `https://api.github.com/search/repositories?q=created:>${date}&sort=stars&order=desc&per_page=15`,
        { headers: this.getHeaders() }
      )

      if (!res.ok) {
        throw new Error(`GitHub trending: ${res.status}`)
      }

      const data = await res.json()

      return data.items?.slice(0, 10).map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description?.substring(0, 200) || '',
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        topics: repo.topics?.slice(0, 5) || [],
        url: repo.html_url,
        createdAt: repo.created_at
      })) || []
    } catch (err) {
      console.error(`      [github] Trending error:`, err.message)
      return []
    }
  }

  async fetchAIRepos() {
    try {
      // Search for AI/LLM related repos updated recently
      const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0]

      const res = await fetch(
        `https://api.github.com/search/repositories?q=llm+OR+ai+OR+gpt+pushed:>${date}&sort=stars&order=desc&per_page=15`,
        { headers: this.getHeaders() }
      )

      if (!res.ok) {
        throw new Error(`GitHub AI repos: ${res.status}`)
      }

      const data = await res.json()

      return data.items?.slice(0, 10).map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description?.substring(0, 200) || '',
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        topics: repo.topics?.slice(0, 5) || [],
        url: repo.html_url,
        updatedAt: repo.updated_at
      })) || []
    } catch (err) {
      console.error(`      [github] AI repos error:`, err.message)
      return []
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      githubTrending: data.trending || [],
      githubAI: data.aiRepos || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.trending?.length > 0) {
      const top = data.trending[0]
      keyData.push(`GitHub trending: ${top.fullName} (${top.stars} stars)`)
    }

    if (data.aiRepos?.length > 0) {
      const languages = [...new Set(data.aiRepos.map(r => r.language).filter(Boolean))]
      keyData.push(`AI repos trending in: ${languages.slice(0, 3).join(', ')}`)
    }

    return keyData
  }
}

export default GitHubSource
