/**
 * CoinGecko Source
 * Fetches crypto prices, Fear & Greed index, trending coins
 */

import { BaseSource } from '../base-source.js'

export class CoinGeckoSource extends BaseSource {
  constructor() {
    super('coingecko', {
      priority: 'primary',
      cacheTTL: 5 * 60 * 1000, // 5 min (crypto is volatile)
      staleTTL: 30 * 60 * 1000, // 30 min stale
      rateLimit: { requests: 30, perMinute: 1 } // CoinGecko free tier
    })
  }

  async fetch() {
    const [prices, fgi, trending] = await Promise.all([
      this.fetchPrices(),
      this.fetchFearGreed(),
      this.fetchTrending()
    ])

    return {
      prices: {
        bitcoin: prices?.bitcoin,
        ethereum: prices?.ethereum,
        solana: prices?.solana
      },
      fearGreed: fgi,
      trending: trending
    }
  }

  async fetchPrices() {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true'
      )

      if (!res.ok) {
        throw new Error(`CoinGecko prices: ${res.status}`)
      }

      const data = await res.json()

      return {
        bitcoin: {
          price: data.bitcoin?.usd,
          change24h: data.bitcoin?.usd_24h_change?.toFixed(2),
          volume24h: data.bitcoin?.usd_24h_vol ? (data.bitcoin.usd_24h_vol / 1e9).toFixed(2) + 'B' : null
        },
        ethereum: {
          price: data.ethereum?.usd,
          change24h: data.ethereum?.usd_24h_change?.toFixed(2)
        },
        solana: {
          price: data.solana?.usd,
          change24h: data.solana?.usd_24h_change?.toFixed(2)
        }
      }
    } catch (err) {
      console.error(`      [coingecko] Prices error:`, err.message)
      return null
    }
  }

  async fetchFearGreed() {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1')

      if (!res.ok) {
        throw new Error(`Fear & Greed: ${res.status}`)
      }

      const data = await res.json()

      return {
        value: parseInt(data.data?.[0]?.value) || null,
        label: data.data?.[0]?.value_classification || null // Extreme Fear, Fear, Neutral, Greed, Extreme Greed
      }
    } catch (err) {
      console.error(`      [coingecko] Fear & Greed error:`, err.message)
      return null
    }
  }

  async fetchTrending() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/search/trending')

      if (!res.ok) {
        throw new Error(`CoinGecko trending: ${res.status}`)
      }

      const data = await res.json()

      return data.coins?.slice(0, 5).map(c => ({
        name: c.item.name,
        symbol: c.item.symbol,
        marketCapRank: c.item.market_cap_rank
      })) || []
    } catch (err) {
      console.error(`      [coingecko] Trending error:`, err.message)
      return []
    }
  }

  normalize(data) {
    if (!data) return null

    return {
      realTimeData: {
        btcPrice: data.prices?.bitcoin?.price,
        btcChange: data.prices?.bitcoin?.change24h,
        btcVolume: data.prices?.bitcoin?.volume24h,
        ethPrice: data.prices?.ethereum?.price,
        ethChange: data.prices?.ethereum?.change24h,
        solPrice: data.prices?.solana?.price,
        solChange: data.prices?.solana?.change24h,
        fearGreed: data.fearGreed
      },
      trending: data.trending || [],
      keyData: this.extractKeyData(data)
    }
  }

  extractKeyData(data) {
    const keyData = []

    if (data.prices?.bitcoin) {
      const btc = data.prices.bitcoin
      const direction = parseFloat(btc.change24h) >= 0 ? 'up' : 'down'
      keyData.push(`BTC $${btc.price?.toLocaleString()} (${btc.change24h}% ${direction})`)
    }

    if (data.fearGreed) {
      keyData.push(`Fear & Greed: ${data.fearGreed.value} (${data.fearGreed.label})`)
    }

    if (data.trending?.length > 0) {
      keyData.push(`Trending: ${data.trending.slice(0, 3).map(t => t.symbol).join(', ')}`)
    }

    return keyData
  }
}

export default CoinGeckoSource
