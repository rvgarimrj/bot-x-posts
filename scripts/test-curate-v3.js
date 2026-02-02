#!/usr/bin/env node
/**
 * Test curate-v3 curation
 *
 * Usage:
 *   node scripts/test-curate-v3.js                    # All topics
 *   node scripts/test-curate-v3.js crypto             # Single topic
 *   node scripts/test-curate-v3.js crypto investing   # Multiple topics
 */

import 'dotenv/config'
import { curateContentV3, formatForPrompt, globalCache } from '../src/curate-v3.js'

const args = process.argv.slice(2)
const topics = args.length > 0 ? args : ['crypto', 'investing', 'ai', 'vibeCoding']

console.log('🧪 Testing curate-v3...')
console.log(`   Topics: ${topics.join(', ')}`)
console.log('='.repeat(60))

async function main() {
  const start = Date.now()

  // Run curation
  const curated = await curateContentV3(topics)

  const elapsed = Date.now() - start
  console.log(`\n⏱️  Total curation took ${elapsed}ms`)

  // Show results for each topic
  for (const topic of topics) {
    const data = curated[topic]
    if (!data) {
      console.log(`\n❌ ${topic}: No data`)
      continue
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 ${topic.toUpperCase()}`)
    console.log('='.repeat(60))

    console.log(`\n   Sentiment: ${data.sentiment} (${data.sentimentScore})`)
    console.log(`   Narrative: ${data.dominantNarrative}`)

    if (data.contrarian) {
      console.log(`   Contrarian: ${data.contrarian}`)
    }

    if (data.keyData?.length > 0) {
      console.log(`\n   Key Data:`)
      data.keyData.forEach((d, i) => console.log(`      ${i + 1}. ${d}`))
    }

    if (data.suggestedAngles?.length > 0) {
      console.log(`\n   Suggested Angles:`)
      data.suggestedAngles.forEach((a, i) => {
        console.log(`      ${i + 1}. [${a.type}] ${a.hook}`)
        console.log(`         → ${a.insight}`)
      })
    }

    if (data.sources?.length > 0) {
      console.log(`\n   Sources used:`)
      data.sources.forEach(s => {
        const cacheInfo = s.fromCache ? ` (cache ${s.cacheAge}ms)` : ''
        console.log(`      - ${s.name}${cacheInfo}`)
      })
    }

    if (data.errors?.length > 0) {
      console.log(`\n   Errors:`)
      data.errors.forEach(e => console.log(`      ⚠️ ${e.source}: ${e.error}`))
    }

    // Show formatted prompt
    console.log(`\n   📝 Formatted Prompt (EN):`)
    const promptEN = formatForPrompt(curated, topic, 'en')
    console.log(promptEN.split('\n').map(l => `      ${l}`).join('\n').substring(0, 1500))

    console.log(`\n   📝 Formatted Prompt (PT-BR):`)
    const promptPT = formatForPrompt(curated, topic, 'pt-BR')
    console.log(promptPT.split('\n').map(l => `      ${l}`).join('\n').substring(0, 1500))
  }

  // Cache stats
  console.log(`\n${'='.repeat(60)}`)
  console.log('📦 Cache Stats:')
  const stats = globalCache.getStats()
  console.log(`   Size: ${stats.size} entries`)
  stats.entries.forEach(e => {
    console.log(`   - ${e.key}: ${e.ageFormatted}`)
  })

  console.log('\n✅ Test complete!')
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
