/**
 * arXiv Source
 * Fetches recent AI/ML research papers
 */

import { BaseSource } from '../base-source.js'

export class ArxivSource extends BaseSource {
  constructor() {
    super('arxiv', {
      priority: 'secondary',
      cacheTTL: 4 * 60 * 60 * 1000, // 4h (papers don't change fast)
      staleTTL: 24 * 60 * 60 * 1000, // 24h stale
      rateLimit: { requests: 3, perMinute: 1 } // arXiv asks for 3 req/sec max
    })
  }

  async fetch() {
    try {
      // Search for recent AI/ML papers
      // Categories: cs.AI (AI), cs.CL (NLP/Language), cs.LG (Machine Learning), cs.CV (Vision)
      const categories = ['cs.AI', 'cs.CL', 'cs.LG']
      const query = categories.map(c => `cat:${c}`).join('+OR+')

      const res = await fetch(
        `http://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending`,
        { headers: { 'User-Agent': 'BotXPosts/3.0' } }
      )

      if (!res.ok) {
        throw new Error(`arXiv: ${res.status}`)
      }

      const xml = await res.text()
      const papers = this.parseArxivXML(xml)

      return {
        papers: papers.slice(0, 15),
        timestamp: Date.now()
      }
    } catch (err) {
      console.error(`      [arxiv] Error:`, err.message)
      return null
    }
  }

  parseArxivXML(xml) {
    const papers = []

    // Simple XML parsing (no external deps)
    const entries = xml.split('<entry>').slice(1)

    for (const entry of entries) {
      try {
        const title = this.extractTag(entry, 'title')?.replace(/\s+/g, ' ').trim()
        const summary = this.extractTag(entry, 'summary')?.replace(/\s+/g, ' ').trim()
        const id = this.extractTag(entry, 'id')
        const published = this.extractTag(entry, 'published')

        // Extract authors
        const authorMatches = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g) || []
        const authors = authorMatches.map(a => {
          const nameMatch = a.match(/<name>(.*?)<\/name>/)
          return nameMatch ? nameMatch[1] : ''
        }).filter(Boolean).slice(0, 3)

        // Extract categories
        const categoryMatches = entry.match(/term="([^"]+)"/g) || []
        const categories = categoryMatches.map(c => c.match(/term="([^"]+)"/)?.[1]).filter(Boolean)

        if (title && id) {
          papers.push({
            title,
            summary: summary?.substring(0, 400) || '',
            authors,
            categories: categories.slice(0, 3),
            url: id,
            arxivId: id.split('/abs/')[1] || id,
            published
          })
        }
      } catch (e) {
        // Skip malformed entries
      }
    }

    return papers
  }

  extractTag(xml, tag) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
    const match = xml.match(regex)
    return match ? match[1] : null
  }

  normalize(data) {
    if (!data) return null

    return {
      arxivPapers: data.papers || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.papers?.length > 0) {
      keyData.push(`${data.papers.length} new arXiv papers`)

      // Find interesting keywords
      const keywords = ['GPT', 'LLM', 'transformer', 'attention', 'agent', 'reasoning', 'multimodal']
      const relevant = data.papers.filter(p =>
        keywords.some(k => p.title.toLowerCase().includes(k.toLowerCase()))
      )

      if (relevant.length > 0) {
        keyData.push(`Notable: "${relevant[0].title.substring(0, 60)}..."`)
      }
    }

    return keyData
  }
}

export default ArxivSource
