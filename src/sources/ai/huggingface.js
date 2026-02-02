/**
 * HuggingFace Hub Source
 * Fetches trending models and recent releases
 */

import { BaseSource } from '../base-source.js'

export class HuggingFaceSource extends BaseSource {
  constructor() {
    super('huggingface', {
      priority: 'primary',
      cacheTTL: 60 * 60 * 1000, // 1h (models don't change rapidly)
      staleTTL: 4 * 60 * 60 * 1000, // 4h stale
      rateLimit: { requests: 100, perMinute: 1 } // HF is generous
    })
  }

  async fetch() {
    const [trending, recent] = await Promise.all([
      this.fetchTrendingModels(),
      this.fetchRecentModels()
    ])

    return {
      trending: trending || [],
      recent: recent || [],
      timestamp: Date.now()
    }
  }

  async fetchTrendingModels() {
    try {
      // HuggingFace Hub API - sorted by downloads
      const res = await fetch(
        'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=15',
        { headers: { 'User-Agent': 'BotXPosts/3.0' } }
      )

      if (!res.ok) {
        throw new Error(`HuggingFace trending: ${res.status}`)
      }

      const data = await res.json()

      return data.slice(0, 10).map(model => ({
        id: model.id,
        author: model.author || model.id.split('/')[0],
        name: model.id.split('/')[1] || model.id,
        downloads: model.downloads,
        likes: model.likes,
        tags: model.tags?.slice(0, 5) || [],
        pipeline: model.pipeline_tag,
        url: `https://huggingface.co/${model.id}`
      }))
    } catch (err) {
      console.error(`      [huggingface] Trending error:`, err.message)
      return []
    }
  }

  async fetchRecentModels() {
    try {
      // Recent models sorted by last modified
      const res = await fetch(
        'https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=15',
        { headers: { 'User-Agent': 'BotXPosts/3.0' } }
      )

      if (!res.ok) {
        throw new Error(`HuggingFace recent: ${res.status}`)
      }

      const data = await res.json()

      // Filter for interesting models (LLMs, vision, audio)
      const interesting = data.filter(m => {
        const tags = m.tags || []
        return tags.some(t =>
          ['text-generation', 'text2text-generation', 'image-to-text',
            'text-to-image', 'automatic-speech-recognition', 'llm']
            .includes(t)
        )
      })

      return interesting.slice(0, 10).map(model => ({
        id: model.id,
        author: model.author || model.id.split('/')[0],
        name: model.id.split('/')[1] || model.id,
        downloads: model.downloads,
        likes: model.likes,
        tags: model.tags?.slice(0, 5) || [],
        pipeline: model.pipeline_tag,
        lastModified: model.lastModified,
        url: `https://huggingface.co/${model.id}`
      }))
    } catch (err) {
      console.error(`      [huggingface] Recent error:`, err.message)
      return []
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      hfTrending: data.trending || [],
      hfRecent: data.recent || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.trending?.length > 0) {
      const top = data.trending[0]
      keyData.push(`HF trending: ${top.id} (${(top.downloads / 1e6).toFixed(1)}M downloads)`)
    }

    if (data.recent?.length > 0) {
      // Find any notable new releases
      const pipelines = [...new Set(data.recent.map(m => m.pipeline).filter(Boolean))]
      keyData.push(`New models: ${pipelines.slice(0, 3).join(', ')}`)
    }

    return keyData
  }
}

export default HuggingFaceSource
