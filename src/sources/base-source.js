/**
 * Base class for all data sources
 * Provides common functionality: caching, rate limiting, error handling
 */

import { CacheManager } from './cache-manager.js'

export class BaseSource {
  constructor(name, options = {}) {
    this.name = name
    this.priority = options.priority || 'primary' // primary, secondary, fallback
    this.cacheTTL = options.cacheTTL || 30 * 60 * 1000 // 30 min default
    this.staleTTL = options.staleTTL || 4 * 60 * 60 * 1000 // 4h stale cache
    this.rateLimit = options.rateLimit || { requests: 60, perMinute: 1 }
    this.lastRequest = 0
    this.requestCount = 0
    this.rateLimitReset = 0
    this.isRateLimited = false
  }

  /**
   * Fetch data from the source - must be implemented by subclass
   * @returns {Promise<Object>} Source data
   */
  async fetch() {
    throw new Error('fetch() must be implemented by subclass')
  }

  /**
   * Get cache key for this source
   * @param {string} topic - Topic being queried
   * @returns {string} Cache key
   */
  getCacheKey(topic = 'default') {
    return `${this.name}:${topic}`
  }

  /**
   * Check if we're rate limited
   * @returns {boolean}
   */
  checkRateLimit() {
    const now = Date.now()

    // Reset counter if minute passed
    if (now - this.rateLimitReset > 60000) {
      this.requestCount = 0
      this.rateLimitReset = now
      this.isRateLimited = false
    }

    return this.requestCount >= this.rateLimit.requests
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest() {
    this.requestCount++
    this.lastRequest = Date.now()
  }

  /**
   * Fetch with caching and error handling
   * @param {string} topic - Topic to fetch
   * @param {CacheManager} cache - Cache manager instance
   * @returns {Promise<{data: Object|null, fromCache: boolean, error: string|null}>}
   */
  async fetchWithCache(topic, cache) {
    const cacheKey = this.getCacheKey(topic)

    // Try fresh cache first
    const cached = cache.get(cacheKey)
    if (cached && !cache.isStale(cacheKey, this.cacheTTL)) {
      return { data: cached, fromCache: true, error: null, cacheAge: cache.getAge(cacheKey) }
    }

    // Check rate limit
    if (this.checkRateLimit()) {
      // If rate limited, try stale cache
      if (cached && !cache.isStale(cacheKey, this.staleTTL)) {
        console.log(`      [${this.name}] Rate limited, using stale cache`)
        return { data: cached, fromCache: true, error: 'rate_limited', cacheAge: cache.getAge(cacheKey) }
      }
      return { data: null, fromCache: false, error: 'rate_limited' }
    }

    // Fetch fresh data
    try {
      this.recordRequest()
      const data = await this.fetch(topic)

      if (data) {
        cache.set(cacheKey, data)
        return { data, fromCache: false, error: null }
      }

      // Fetch returned null - try stale cache
      if (cached) {
        return { data: cached, fromCache: true, error: 'fetch_empty', cacheAge: cache.getAge(cacheKey) }
      }

      return { data: null, fromCache: false, error: 'fetch_empty' }
    } catch (err) {
      console.error(`      [${this.name}] Error:`, err.message)

      // Handle rate limit error specifically
      if (err.message?.includes('429') || err.code === 429) {
        this.isRateLimited = true
        this.requestCount = this.rateLimit.requests // Max out counter
      }

      // Try stale cache on error
      if (cached && !cache.isStale(cacheKey, this.staleTTL)) {
        console.log(`      [${this.name}] Using stale cache after error`)
        return { data: cached, fromCache: true, error: err.message, cacheAge: cache.getAge(cacheKey) }
      }

      return { data: null, fromCache: false, error: err.message }
    }
  }

  /**
   * Transform raw API data to normalized format
   * @param {Object} raw - Raw API response
   * @returns {Object} Normalized data
   */
  normalize(raw) {
    return raw // Override in subclass for custom normalization
  }

  /**
   * Get source metadata
   * @returns {Object}
   */
  getInfo() {
    return {
      name: this.name,
      priority: this.priority,
      cacheTTL: this.cacheTTL,
      rateLimit: this.rateLimit,
      isRateLimited: this.isRateLimited,
      requestCount: this.requestCount
    }
  }
}

export default BaseSource
