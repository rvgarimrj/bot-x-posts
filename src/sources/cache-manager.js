/**
 * Unified Cache Manager for all data sources
 * Provides in-memory caching with TTL support
 */

export class CacheManager {
  constructor() {
    this.cache = new Map()
    this.timestamps = new Map()
  }

  /**
   * Store data in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  set(key, data) {
    this.cache.set(key, data)
    this.timestamps.set(key, Date.now())
  }

  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @returns {*} Cached data or null
   */
  get(key) {
    return this.cache.get(key) || null
  }

  /**
   * Check if cache entry exists
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key)
  }

  /**
   * Get cache entry age in milliseconds
   * @param {string} key - Cache key
   * @returns {number} Age in ms, or Infinity if not cached
   */
  getAge(key) {
    const timestamp = this.timestamps.get(key)
    if (!timestamp) return Infinity
    return Date.now() - timestamp
  }

  /**
   * Check if cache entry is stale
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in ms
   * @returns {boolean} True if stale or missing
   */
  isStale(key, ttl) {
    return this.getAge(key) > ttl
  }

  /**
   * Check if cache is fresh
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in ms
   * @returns {boolean} True if fresh
   */
  isFresh(key, ttl) {
    return this.has(key) && !this.isStale(key, ttl)
  }

  /**
   * Delete cache entry
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key)
    this.timestamps.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear()
    this.timestamps.clear()
  }

  /**
   * Clear entries matching a prefix
   * @param {string} prefix - Key prefix to match
   */
  clearPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.delete(key)
      }
    }
  }

  /**
   * Clean up expired entries
   * @param {number} maxAge - Maximum age in ms
   */
  cleanup(maxAge) {
    const now = Date.now()
    for (const [key, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > maxAge) {
        this.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    const entries = []
    for (const [key, timestamp] of this.timestamps.entries()) {
      entries.push({
        key,
        age: Date.now() - timestamp,
        ageFormatted: this.formatAge(Date.now() - timestamp)
      })
    }
    return {
      size: this.cache.size,
      entries: entries.sort((a, b) => a.age - b.age)
    }
  }

  /**
   * Format age in human readable format
   * @param {number} ms - Age in milliseconds
   * @returns {string}
   */
  formatAge(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`
    if (ms < 3600000) return `${Math.round(ms / 60000)}min`
    return `${Math.round(ms / 3600000)}h`
  }
}

// Singleton instance for shared cache across sources
export const globalCache = new CacheManager()

export default CacheManager
