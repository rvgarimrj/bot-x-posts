#!/usr/bin/env node
/**
 * Test bilingual post generation
 *
 * Usage:
 *   node scripts/test-generate-v2.js                       # All topics, all languages
 *   node scripts/test-generate-v2.js crypto                # Single topic, both languages
 *   node scripts/test-generate-v2.js crypto en             # Single topic, single language
 *   node scripts/test-generate-v2.js vibeCoding pt-BR      # Single topic, single language
 */

import 'dotenv/config'
import { generatePost } from '../src/claude-v2.js'
import { curateContentV3, formatForPrompt, getFallbackContentV3 } from '../src/curate-v3.js'

const args = process.argv.slice(2)
const filterTopic = args[0]
const filterLanguage = args[1]

const allTopics = ['crypto', 'investing', 'ai', 'vibeCoding']
const allLanguages = ['en', 'pt-BR']

const topics = filterTopic ? [filterTopic] : allTopics
const languages = filterLanguage ? [filterLanguage] : allLanguages

console.log('🧪 Testing claude-v2 bilingual generation...')
console.log(`   Topics: ${topics.join(', ')}`)
console.log(`   Languages: ${languages.join(', ')}`)
console.log('='.repeat(60))

async function main() {
  // First, curate content (or use fallback)
  console.log('\n1. Curando conteúdo...')
  let content
  try {
    content = await curateContentV3(topics)
  } catch (err) {
    console.log(`   ⚠️ Curadoria falhou: ${err.message}`)
    console.log('   ⚠️ Usando fallback')
    content = getFallbackContentV3()
  }

  // Generate posts
  console.log('\n2. Gerando posts...')
  const posts = []

  for (const topic of topics) {
    const data = content[topic]
    if (!data) {
      console.log(`   ⚠️ Sem dados para ${topic}`)
      continue
    }

    for (const language of languages) {
      const langLabel = language === 'en' ? '🇺🇸 EN' : '🇧🇷 PT'
      console.log(`\n   ${topic.toUpperCase()} ${langLabel}:`)

      // Format context
      const context = formatForPrompt(content, topic, language)

      // Get angle
      let angle = language === 'en' ? 'Analysis based on data' : 'Análise baseada nos dados'
      if (data.suggestedAngles?.[0]) {
        const a = data.suggestedAngles[0]
        angle = `[${a.type}] ${a.hook} → ${a.insight}`
      }

      console.log(`   Angle: ${angle.substring(0, 80)}...`)

      try {
        const start = Date.now()
        const post = await generatePost(topic, context, angle, language)
        const elapsed = Date.now() - start

        posts.push({ topic, language, post, chars: post.length })

        console.log(`   ⏱️  ${elapsed}ms`)
        console.log(`   📝 (${post.length} chars):`)
        console.log(`   "${post}"`)
      } catch (err) {
        console.log(`   ❌ Erro: ${err.message}`)
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`   Generated: ${posts.length} posts`)

  if (posts.length > 0) {
    const avgChars = Math.round(posts.reduce((s, p) => s + p.chars, 0) / posts.length)
    console.log(`   Avg length: ${avgChars} chars`)

    console.log('\n   Posts:')
    posts.forEach((p, i) => {
      const flag = p.language === 'en' ? '🇺🇸' : '🇧🇷'
      console.log(`   ${i + 1}. ${flag} ${p.topic}: "${p.post.substring(0, 60)}..." (${p.chars} chars)`)
    })
  }

  console.log('\n✅ Test complete!')
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
