/**
 * Curate V3 - Multi-Source Orchestrator
 *
 * Fetches data from multiple sources per topic with fallback chains.
 * Supports 4 topics: crypto, investing, ai, vibeCoding
 */

import Anthropic from '@anthropic-ai/sdk'
import { globalCache, registerSource, fetchTopic, fetchAllTopics } from './sources/index.js'

// Import all sources
import { CoinGeckoSource } from './sources/crypto/coingecko.js'
import { RedditSource } from './sources/reddit.js'
import { FinnhubSource } from './sources/investing/finnhub.js'
import { HackerNewsSource } from './sources/vibecoding/hackernews.js'
import { GitHubSource } from './sources/vibecoding/github.js'
import { HuggingFaceSource } from './sources/ai/huggingface.js'
import { ArxivSource } from './sources/ai/arxiv.js'
import { RSSSource } from './sources/rss.js'

const anthropic = new Anthropic()

// ==================== SOURCE REGISTRATION ====================

let sourcesRegistered = false

function registerAllSources() {
  if (sourcesRegistered) return
  sourcesRegistered = true

  // CRYPTO sources
  registerSource('crypto', new CoinGeckoSource())
  registerSource('crypto', new RedditSource('crypto', { priority: 'primary' }))
  registerSource('crypto', new RSSSource('crypto', { priority: 'fallback' }))

  // INVESTING sources
  registerSource('investing', new FinnhubSource())
  registerSource('investing', new RedditSource('investing', { priority: 'primary' }))
  registerSource('investing', new RSSSource('investing', { priority: 'fallback' }))

  // AI sources
  registerSource('ai', new HuggingFaceSource())
  registerSource('ai', new RedditSource('ai', { priority: 'primary' }))
  registerSource('ai', new ArxivSource())
  registerSource('ai', new RSSSource('ai', { priority: 'fallback' }))

  // VIBECODING sources
  registerSource('vibeCoding', new HackerNewsSource())
  registerSource('vibeCoding', new GitHubSource())
  registerSource('vibeCoding', new RedditSource('vibeCoding', { priority: 'secondary' }))
  registerSource('vibeCoding', new RSSSource('vibeCoding', { priority: 'fallback' }))

  console.log('   ✓ All sources registered')
}

// ==================== ANALYSIS WITH CLAUDE ====================

/**
 * Analyze curated data with Claude to extract insights
 */
async function analyzeWithClaude(topic, data) {
  if (!data || Object.keys(data).length === 0) {
    return getDefaultAnalysis(topic)
  }

  const dataPreview = JSON.stringify(data, null, 2).substring(0, 3000)

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Analise os dados sobre ${topic} e extraia insights para posts.

DADOS COLETADOS:
${dataPreview}

TAREFA:
1. Qual o SENTIMENTO geral? (bullish/bearish/neutral/mixed)
2. O que tem POTENCIAL VIRAL real?
3. Qual a NARRATIVA dominante?
4. O que esta sendo IGNORADO mas e importante?

Responda em JSON:
{
  "sentiment": "bullish|bearish|neutral|mixed",
  "sentimentScore": -100 a 100,
  "dominantNarrative": "a narrativa principal em 1 frase",
  "contrarian": "o que ninguem esta falando mas deveria",
  "viralPotential": [
    {"topic": "assunto", "why": "por que pode viralizar", "angle": "angulo sugerido"}
  ],
  "keyData": ["dado concreto 1", "dado concreto 2"],
  "suggestedAngles": [
    {"type": "CONTRARIAN|CONSEQUENCIA|TIP_TEASE", "hook": "gancho curto", "insight": "a sacada"}
  ]
}`
      }]
    })

    const text = message.content[0].text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    return jsonMatch ? JSON.parse(jsonMatch[0]) : getDefaultAnalysis(topic)
  } catch (err) {
    console.error(`      [claude] Analysis error:`, err.message)
    return getDefaultAnalysis(topic)
  }
}

function getDefaultAnalysis(topic) {
  const defaults = {
    crypto: {
      sentiment: 'neutral',
      sentimentScore: 0,
      dominantNarrative: 'Mercado crypto em movimento',
      keyData: ['Volatilidade presente'],
      suggestedAngles: [{ type: 'CONTRARIAN', hook: 'Enquanto todos olham pra cima...', insight: 'O risco ignorado' }]
    },
    investing: {
      sentiment: 'neutral',
      sentimentScore: 0,
      dominantNarrative: 'Wall Street reagindo a dados',
      keyData: ['Mercado em foco'],
      suggestedAngles: [{ type: 'CONSEQUENCIA', hook: 'O efeito de segunda ordem...', insight: 'Ninguem esta vendo' }]
    },
    ai: {
      sentiment: 'neutral',
      sentimentScore: 0,
      dominantNarrative: 'AI evoluindo rapidamente',
      keyData: ['Novos modelos surgindo'],
      suggestedAngles: [{ type: 'TIP_TEASE', hook: 'Feature escondida...', insight: 'Poucos conhecem' }]
    },
    vibeCoding: {
      sentiment: 'neutral',
      sentimentScore: 0,
      dominantNarrative: 'AI coding tools evoluindo',
      keyData: ['Novas features', 'Produtividade em debate'],
      suggestedAngles: [{ type: 'TIP_TEASE', hook: 'Feature escondida que muda tudo...', insight: 'Poucos conhecem' }]
    }
  }
  return defaults[topic] || defaults.vibeCoding
}

// ==================== MAIN CURATION ====================

/**
 * Curate content for all topics
 * @param {string[]} topics - Topics to curate (default: all)
 * @returns {Promise<Object>} Curated data by topic
 */
export async function curateContentV3(topics = ['crypto', 'investing', 'ai', 'vibeCoding']) {
  console.log('📡 Iniciando curadoria v3 (multi-source)...')
  console.log(`   Topicos: ${topics.join(', ')}`)

  // Register sources on first call
  registerAllSources()

  const curated = {}

  // Fetch all topics in parallel
  console.log('\n   Buscando dados...')
  const results = await fetchAllTopics(topics, { cache: globalCache })

  // Process each topic
  for (const topic of topics) {
    console.log(`\n   📊 ${topic.toUpperCase()}:`)

    const result = results[topic]

    if (!result || !result.data) {
      console.log(`      ⚠️ Sem dados para ${topic}`)
      curated[topic] = {
        ...getDefaultAnalysis(topic),
        realTimeData: {},
        sources: [],
        errors: result?.errors || []
      }
      continue
    }

    // Log sources used
    const sourcesUsed = result.sources?.map(s =>
      `${s.name}${s.fromCache ? ' (cache)' : ''}`
    ).join(', ') || 'none'
    console.log(`      Fontes: ${sourcesUsed}`)

    // Analyze with Claude
    console.log(`      Analisando...`)
    const analysis = await analyzeWithClaude(topic, result.data)

    // Merge raw data with analysis
    curated[topic] = {
      ...analysis,
      realTimeData: extractRealTimeData(topic, result.data),
      rawData: result.data,
      sources: result.sources || [],
      errors: result.errors || []
    }

    console.log(`      ✓ Sentimento: ${analysis.sentiment} (${analysis.sentimentScore})`)
  }

  console.log('\n✅ Curadoria v3 completa!')
  return curated
}

/**
 * Extract real-time data for prompt formatting
 */
function extractRealTimeData(topic, data) {
  const realTime = {}

  if (topic === 'crypto') {
    if (data.prices?.bitcoin) {
      realTime.btcPrice = data.prices.bitcoin.price
      realTime.btcChange = data.prices.bitcoin.change24h
    }
    if (data.fearGreed) {
      realTime.fearGreed = data.fearGreed
    }
    if (data.trending) {
      realTime.trending = data.trending
    }
  }

  if (topic === 'investing') {
    if (data.marketNews) {
      realTime.topNews = data.marketNews.slice(0, 3)
    }
    if (data.upcomingEarnings) {
      realTime.earnings = data.upcomingEarnings.slice(0, 5)
    }
    if (data.redditTickers) {
      realTime.tickers = data.redditTickers.slice(0, 5)
    }
  }

  if (topic === 'ai') {
    if (data.hfTrending) {
      realTime.trendingModels = data.hfTrending.slice(0, 5)
    }
    if (data.arxivPapers) {
      realTime.recentPapers = data.arxivPapers.slice(0, 5)
    }
    if (data.rssItems) {
      realTime.news = data.rssItems.slice(0, 5)
    }
  }

  if (topic === 'vibeCoding') {
    if (data.hackerNews) {
      realTime.hnStories = data.hackerNews.slice(0, 5)
    }
    if (data.relevantHN) {
      realTime.relevantHN = data.relevantHN.slice(0, 5)
    }
    if (data.githubTrending) {
      realTime.githubTrending = data.githubTrending.slice(0, 5)
    }
    if (data.githubAI) {
      realTime.aiRepos = data.githubAI.slice(0, 5)
    }
  }

  // Reddit posts (all topics)
  if (data.redditPosts) {
    realTime.redditHot = data.redditPosts.slice(0, 5)
  }

  return realTime
}

// ==================== PROMPT FORMATTING ====================

/**
 * Format curated data for Claude post generation
 */
export function formatForPrompt(curated, topic, language = 'pt-BR') {
  const data = curated[topic]
  if (!data) return 'Sem dados disponíveis'

  let prompt = `DADOS EM TEMPO REAL:\n`

  // Topic-specific data
  if (topic === 'crypto' && data.realTimeData) {
    const rt = data.realTimeData
    if (rt.btcPrice) {
      prompt += `- BTC: $${rt.btcPrice?.toLocaleString()} (${rt.btcChange}%)\n`
    }
    if (rt.fearGreed) {
      prompt += `- Fear & Greed: ${rt.fearGreed.value} (${rt.fearGreed.label})\n`
    }
    if (rt.trending?.length > 0) {
      prompt += `- Trending: ${rt.trending.map(t => t.symbol || t.name).slice(0, 5).join(', ')}\n`
    }
  }

  if (topic === 'investing' && data.realTimeData) {
    const rt = data.realTimeData
    if (rt.tickers?.length > 0) {
      prompt += `- Hot tickers: ${rt.tickers.map(t => t.ticker).join(', ')}\n`
    }
    if (rt.earnings?.length > 0) {
      prompt += `- Upcoming earnings: ${rt.earnings.map(e => e.symbol).join(', ')}\n`
    }
    if (rt.topNews?.length > 0) {
      prompt += `- Top story: "${rt.topNews[0].headline?.substring(0, 80)}..."\n`
    }
  }

  if (topic === 'ai' && data.realTimeData) {
    const rt = data.realTimeData
    if (rt.trendingModels?.length > 0) {
      prompt += `- HuggingFace trending: ${rt.trendingModels.map(m => m.name || m.id).slice(0, 3).join(', ')}\n`
    }
    if (rt.recentPapers?.length > 0) {
      prompt += `- New paper: "${rt.recentPapers[0].title?.substring(0, 80)}..."\n`
    }
    if (rt.news?.length > 0) {
      prompt += `- AI news: "${rt.news[0].title?.substring(0, 80)}..."\n`
    }
  }

  if (topic === 'vibeCoding' && data.realTimeData) {
    const rt = data.realTimeData
    if (rt.relevantHN?.length > 0) {
      prompt += `- HN trending: "${rt.relevantHN[0].title?.substring(0, 80)}..."\n`
    }
    if (rt.githubTrending?.length > 0) {
      prompt += `- GitHub hot: ${rt.githubTrending[0].fullName} (${rt.githubTrending[0].stars} stars)\n`
    }
    if (rt.aiRepos?.length > 0) {
      prompt += `- AI repos: ${rt.aiRepos.slice(0, 3).map(r => r.name).join(', ')}\n`
    }
  }

  // Reddit hot posts (all topics)
  if (data.realTimeData?.redditHot?.length > 0) {
    prompt += `\nREDDIT HOT POSTS:\n`
    data.realTimeData.redditHot.slice(0, 3).forEach((p, i) => {
      prompt += `${i + 1}. "${p.title.substring(0, 100)}..." (${p.score} pts, r/${p.subreddit})\n`
    })
  }

  // Analysis results
  prompt += `\nSENTIMENTO: ${data.sentiment} (score: ${data.sentimentScore})\n`
  prompt += `NARRATIVA DOMINANTE: ${data.dominantNarrative}\n`

  if (data.contrarian) {
    prompt += `ÂNGULO CONTRARIAN: ${data.contrarian}\n`
  }

  if (data.keyData?.length > 0) {
    prompt += `DADOS-CHAVE: ${data.keyData.join(', ')}\n`
  }

  if (data.suggestedAngles?.length > 0) {
    prompt += `\nÂNGULOS SUGERIDOS:\n`
    data.suggestedAngles.forEach((a, i) => {
      prompt += `${i + 1}. [${a.type}] ${a.hook} → ${a.insight}\n`
    })
  }

  // Language-specific instructions
  if (language === 'en') {
    prompt += `\nLANGUAGE: Write in English. International developer perspective.\n`
    prompt += `HASHTAGS: Use relevant English hashtags like #AI #VibeCoding #ClaudeCode #Cursor\n`
  } else {
    prompt += `\nLANGUAGE: Write in Portuguese (BR). @garim perspective.\n`
    prompt += `HASHTAGS: Use relevant hashtags like #ClaudeCode #Cursor #VibeCoding #DevBR\n`
  }

  prompt += `\nINSTRUÇÕES:\n`
  prompt += `- Mantenha o tom autêntico e não pareça bot\n`
  prompt += `- Use dados concretos quando disponíveis\n`
  prompt += `- 1-2 hashtags relevantes no final\n`

  return prompt
}

// ==================== FALLBACK ====================

export function getFallbackContentV3() {
  return {
    crypto: {
      realTimeData: { btcPrice: 'N/A', btcChange: 'N/A' },
      ...getDefaultAnalysis('crypto'),
      sources: [],
      errors: ['Using fallback data']
    },
    investing: {
      realTimeData: {},
      ...getDefaultAnalysis('investing'),
      sources: [],
      errors: ['Using fallback data']
    },
    ai: {
      realTimeData: {},
      ...getDefaultAnalysis('ai'),
      sources: [],
      errors: ['Using fallback data']
    },
    vibeCoding: {
      realTimeData: {},
      ...getDefaultAnalysis('vibeCoding'),
      sources: [],
      errors: ['Using fallback data']
    }
  }
}

// Export cache for monitoring
export { globalCache }
