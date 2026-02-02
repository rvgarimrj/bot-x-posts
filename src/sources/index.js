/**
 * Source Registry and Orchestrator
 * Manages all data sources and provides unified fetching
 */

import { CacheManager, globalCache } from './cache-manager.js'

// Source imports - will be dynamically registered
const sourceRegistry = new Map()

/**
 * Register a source for a topic
 * @param {string} topic - Topic name (crypto, investing, ai, vibeCoding)
 * @param {BaseSource} source - Source instance
 */
export function registerSource(topic, source) {
  if (!sourceRegistry.has(topic)) {
    sourceRegistry.set(topic, [])
  }
  sourceRegistry.get(topic).push(source)

  // Sort by priority: primary > secondary > fallback
  const priorityOrder = { primary: 0, secondary: 1, fallback: 2 }
  sourceRegistry.get(topic).sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority]
  )
}

/**
 * Get all sources for a topic
 * @param {string} topic - Topic name
 * @returns {BaseSource[]}
 */
export function getSources(topic) {
  return sourceRegistry.get(topic) || []
}

/**
 * Get all registered topics
 * @returns {string[]}
 */
export function getTopics() {
  return Array.from(sourceRegistry.keys())
}

/**
 * Fetch data from all sources for a topic with fallback chain
 * @param {string} topic - Topic to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Merged data from all sources
 */
export async function fetchTopic(topic, options = {}) {
  const sources = getSources(topic)
  if (sources.length === 0) {
    console.log(`      No sources registered for topic: ${topic}`)
    return null
  }

  const cache = options.cache || globalCache
  const results = []
  const errors = []

  // Fetch from primary sources first (in parallel)
  const primarySources = sources.filter(s => s.priority === 'primary')
  const secondarySources = sources.filter(s => s.priority === 'secondary')
  const fallbackSources = sources.filter(s => s.priority === 'fallback')

  // Try primary sources in parallel
  if (primarySources.length > 0) {
    console.log(`      Fetching from ${primarySources.length} primary sources...`)
    const primaryResults = await Promise.allSettled(
      primarySources.map(s => s.fetchWithCache(topic, cache))
    )

    for (let i = 0; i < primaryResults.length; i++) {
      const result = primaryResults[i]
      const source = primarySources[i]
      if (result.status === 'fulfilled' && result.value.data) {
        results.push({ source: source.name, ...result.value })
      } else if (result.status === 'rejected') {
        errors.push({ source: source.name, error: result.reason?.message })
      } else if (result.value?.error) {
        errors.push({ source: source.name, error: result.value.error })
      }
    }
  }

  // If no primary data, try secondary sources
  if (results.length === 0 && secondarySources.length > 0) {
    console.log(`      Primary failed, trying ${secondarySources.length} secondary sources...`)
    const secondaryResults = await Promise.allSettled(
      secondarySources.map(s => s.fetchWithCache(topic, cache))
    )

    for (let i = 0; i < secondaryResults.length; i++) {
      const result = secondaryResults[i]
      const source = secondarySources[i]
      if (result.status === 'fulfilled' && result.value.data) {
        results.push({ source: source.name, ...result.value })
      }
    }
  }

  // If still no data, try fallback sources
  if (results.length === 0 && fallbackSources.length > 0) {
    console.log(`      Secondary failed, trying ${fallbackSources.length} fallback sources...`)
    for (const source of fallbackSources) {
      const result = await source.fetchWithCache(topic, cache)
      if (result.data) {
        results.push({ source: source.name, ...result })
        break // Only need one fallback to succeed
      }
    }
  }

  // Merge results from all successful sources
  const merged = mergeResults(results)

  return {
    topic,
    sources: results.map(r => ({
      name: r.source,
      fromCache: r.fromCache,
      cacheAge: r.cacheAge
    })),
    errors,
    data: merged
  }
}

/**
 * Merge results from multiple sources
 * @param {Array} results - Array of source results
 * @returns {Object} Merged data
 */
function mergeResults(results) {
  if (results.length === 0) return null
  if (results.length === 1) return results[0].data

  // Merge all data objects
  const merged = {}
  for (const result of results) {
    const data = result.data
    if (!data) continue

    for (const [key, value] of Object.entries(data)) {
      if (!merged[key]) {
        merged[key] = value
      } else if (Array.isArray(merged[key]) && Array.isArray(value)) {
        // Merge arrays, deduplicating by text/title if present
        const existing = new Set(merged[key].map(item =>
          item.text || item.title || JSON.stringify(item)
        ))
        for (const item of value) {
          const itemKey = item.text || item.title || JSON.stringify(item)
          if (!existing.has(itemKey)) {
            merged[key].push(item)
            existing.add(itemKey)
          }
        }
      } else if (typeof merged[key] === 'object' && typeof value === 'object') {
        // Merge objects
        merged[key] = { ...merged[key], ...value }
      }
      // Otherwise keep first value
    }
  }

  return merged
}

/**
 * Fetch all topics in parallel
 * @param {string[]} topics - Topics to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Map of topic -> data
 */
export async function fetchAllTopics(topics, options = {}) {
  const results = await Promise.allSettled(
    topics.map(topic => fetchTopic(topic, options))
  )

  const data = {}
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    const result = results[i]
    if (result.status === 'fulfilled') {
      data[topic] = result.value
    } else {
      data[topic] = { topic, errors: [result.reason?.message], data: null }
    }
  }

  return data
}

/**
 * Get registry status
 * @returns {Object}
 */
export function getRegistryStatus() {
  const status = {}
  for (const [topic, sources] of sourceRegistry.entries()) {
    status[topic] = sources.map(s => s.getInfo())
  }
  return status
}

export { globalCache, CacheManager }
export { BaseSource } from './base-source.js'
