#!/usr/bin/env node
/**
 * Test individual sources
 *
 * Usage:
 *   node scripts/test-source.js coingecko
 *   node scripts/test-source.js reddit crypto
 *   node scripts/test-source.js finnhub
 *   node scripts/test-source.js hackernews
 *   node scripts/test-source.js github
 *   node scripts/test-source.js huggingface
 *   node scripts/test-source.js arxiv
 *   node scripts/test-source.js rss ai
 */

import 'dotenv/config'
import { CacheManager } from '../src/sources/cache-manager.js'

// Import all sources
import { CoinGeckoSource } from '../src/sources/crypto/coingecko.js'
import { RedditSource } from '../src/sources/reddit.js'
import { FinnhubSource } from '../src/sources/investing/finnhub.js'
import { HackerNewsSource } from '../src/sources/vibecoding/hackernews.js'
import { GitHubSource } from '../src/sources/vibecoding/github.js'
import { HuggingFaceSource } from '../src/sources/ai/huggingface.js'
import { ArxivSource } from '../src/sources/ai/arxiv.js'
import { RSSSource } from '../src/sources/rss.js'

const args = process.argv.slice(2)
const sourceName = args[0]?.toLowerCase()
const topic = args[1] || 'crypto'

if (!sourceName) {
  console.log('Usage: node scripts/test-source.js <source> [topic]')
  console.log('\nAvailable sources:')
  console.log('  coingecko           - Crypto prices, Fear & Greed')
  console.log('  reddit <topic>      - Reddit hot posts (crypto, investing, ai, vibeCoding)')
  console.log('  finnhub             - Market news, earnings')
  console.log('  hackernews          - HN top stories')
  console.log('  github              - Trending repos')
  console.log('  huggingface         - Trending models')
  console.log('  arxiv               - Recent AI papers')
  console.log('  rss <topic>         - RSS feeds')
  process.exit(0)
}

async function testSource(source, cache) {
  console.log(`\n🔍 Testing ${source.name}...`)
  console.log(`   Priority: ${source.priority}`)
  console.log(`   Cache TTL: ${source.cacheTTL / 1000}s`)
  console.log(`   Rate Limit: ${source.rateLimit.requests}/min\n`)

  const start = Date.now()
  const result = await source.fetchWithCache(topic, cache)
  const elapsed = Date.now() - start

  console.log(`   ⏱️  Fetch took ${elapsed}ms`)
  console.log(`   📦 From cache: ${result.fromCache}`)

  if (result.error) {
    console.log(`   ⚠️  Error: ${result.error}`)
  }

  if (result.data) {
    console.log(`   ✅ Data received:`)
    console.log(JSON.stringify(result.data, null, 2).substring(0, 2000))

    // Test normalize
    const normalized = source.normalize(result.data)
    if (normalized) {
      console.log(`\n   📊 Normalized:`)
      console.log(JSON.stringify(normalized, null, 2).substring(0, 1000))
    }
  } else {
    console.log(`   ❌ No data`)
  }

  return result
}

async function main() {
  const cache = new CacheManager()

  let source

  switch (sourceName) {
    case 'coingecko':
      source = new CoinGeckoSource()
      break
    case 'reddit':
      source = new RedditSource(topic)
      break
    case 'finnhub':
      source = new FinnhubSource()
      break
    case 'hackernews':
    case 'hn':
      source = new HackerNewsSource()
      break
    case 'github':
    case 'gh':
      source = new GitHubSource()
      break
    case 'huggingface':
    case 'hf':
      source = new HuggingFaceSource()
      break
    case 'arxiv':
      source = new ArxivSource()
      break
    case 'rss':
      source = new RSSSource(topic)
      break
    default:
      console.log(`Unknown source: ${sourceName}`)
      process.exit(1)
  }

  await testSource(source, cache)

  // Test cache hit
  console.log('\n\n📦 Testing cache hit...')
  const result2 = await source.fetchWithCache(topic, cache)
  console.log(`   From cache: ${result2.fromCache}`)
  console.log(`   Cache age: ${cache.getAge(source.getCacheKey(topic))}ms`)

  console.log('\n✅ Test complete!')
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
