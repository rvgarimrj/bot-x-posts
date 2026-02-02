/**
 * Finnhub Source
 * Fetches market news, earnings, analyst ratings
 */

import { BaseSource } from '../base-source.js'

export class FinnhubSource extends BaseSource {
  constructor() {
    super('finnhub', {
      priority: 'primary',
      cacheTTL: 15 * 60 * 1000, // 15 min
      staleTTL: 60 * 60 * 1000, // 1h stale
      rateLimit: { requests: 60, perMinute: 1 } // Finnhub free tier
    })

    this.apiKey = process.env.FINNHUB_API_KEY || process.env.FINNHUB_API
  }

  async fetch() {
    if (!this.apiKey) {
      console.log(`      [finnhub] No API key configured`)
      return null
    }

    const [news, earnings] = await Promise.all([
      this.fetchMarketNews(),
      this.fetchUpcomingEarnings()
    ])

    return {
      news: news || [],
      earnings: earnings || [],
      timestamp: Date.now()
    }
  }

  async fetchMarketNews() {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/news?category=general&token=${this.apiKey}`
      )

      if (!res.ok) {
        throw new Error(`Finnhub news: ${res.status}`)
      }

      const data = await res.json()

      return data.slice(0, 15).map(article => ({
        headline: article.headline,
        summary: article.summary?.substring(0, 300) || '',
        source: article.source,
        url: article.url,
        category: article.category,
        datetime: new Date(article.datetime * 1000).toISOString(),
        related: article.related // Related stock symbols
      }))
    } catch (err) {
      console.error(`      [finnhub] News error:`, err.message)
      return []
    }
  }

  async fetchUpcomingEarnings() {
    try {
      // Get earnings for next 7 days
      const from = new Date().toISOString().split('T')[0]
      const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const res = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${this.apiKey}`
      )

      if (!res.ok) {
        throw new Error(`Finnhub earnings: ${res.status}`)
      }

      const data = await res.json()

      // Filter to notable companies (high revenue estimate or well-known symbols)
      const notable = (data.earningsCalendar || [])
        .filter(e => e.revenueEstimate > 1e9 || // >$1B revenue
          ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'AMD', 'NFLX', 'CRM']
            .includes(e.symbol))
        .slice(0, 10)

      return notable.map(e => ({
        symbol: e.symbol,
        date: e.date,
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate,
        hour: e.hour // 'bmo' (before market open) or 'amc' (after market close)
      }))
    } catch (err) {
      console.error(`      [finnhub] Earnings error:`, err.message)
      return []
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      marketNews: data.news || [],
      upcomingEarnings: data.earnings || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.news?.length > 0) {
      keyData.push(`${data.news.length} market news articles`)
      // Add top headline
      const topNews = data.news[0]
      if (topNews) {
        keyData.push(`Top story: "${topNews.headline.substring(0, 60)}..."`)
      }
    }

    if (data.earnings?.length > 0) {
      const symbols = data.earnings.map(e => e.symbol).slice(0, 5).join(', ')
      keyData.push(`Upcoming earnings: ${symbols}`)
    }

    return keyData
  }
}

export default FinnhubSource
