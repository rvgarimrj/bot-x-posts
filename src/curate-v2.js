import Anthropic from '@anthropic-ai/sdk'
import { TwitterApi } from 'twitter-api-v2'

const anthropic = new Anthropic()

// ==================== CONFIGURAÇÃO ====================

const TWITTER_SEARCHES = {
  crypto: ['#Bitcoin', '#BTC', '#Crypto', '#ETF Bitcoin', 'Bitcoin ETF'],
  investing: ['#NASDAQ', '#SP500', 'earnings', '$AAPL', '$NVDA', '$TSLA'],
  vibeCoding: ['#ClaudeCode', '#Cursor', 'AI coding', 'vibe coding', 'Copilot']
}

// ==================== FONTES DE DADOS ====================

/**
 * Busca dados do CoinGecko (grátis, sem API key)
 */
async function fetchCryptoData() {
  try {
    // Preços principais
    const pricesRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true'
    )
    const prices = await pricesRes.json()

    // Fear & Greed Index
    const fgiRes = await fetch('https://api.alternative.me/fng/?limit=1')
    const fgi = await fgiRes.json()

    // Trending coins
    const trendingRes = await fetch('https://api.coingecko.com/api/v3/search/trending')
    const trending = await trendingRes.json()

    return {
      bitcoin: {
        price: prices.bitcoin?.usd,
        change24h: prices.bitcoin?.usd_24h_change?.toFixed(2),
        volume24h: (prices.bitcoin?.usd_24h_vol / 1e9).toFixed(2) + 'B'
      },
      ethereum: {
        price: prices.ethereum?.usd,
        change24h: prices.ethereum?.usd_24h_change?.toFixed(2)
      },
      fearGreed: {
        value: fgi.data?.[0]?.value,
        label: fgi.data?.[0]?.value_classification // Extreme Fear, Fear, Neutral, Greed, Extreme Greed
      },
      trending: trending.coins?.slice(0, 5).map(c => c.item.name) || []
    }
  } catch (err) {
    console.error('   Erro CoinGecko:', err.message)
    return null
  }
}

/**
 * Busca dados do mercado de ações (Yahoo Finance via query)
 */
async function fetchStockData() {
  try {
    // Usar Reddit como proxy para dados de mercado (mais confiável que scraping)
    const res = await fetch('https://www.reddit.com/r/stocks/hot/.json?limit=10', {
      headers: { 'User-Agent': 'BotXPosts/2.0' }
    })
    const data = await res.json()

    const posts = data.data.children
      .filter(p => !p.data.stickied)
      .slice(0, 8)
      .map(p => ({
        title: p.data.title,
        score: p.data.score,
        comments: p.data.num_comments
      }))

    // Extrair tickers mencionados
    const tickerRegex = /\$([A-Z]{1,5})\b/g
    const tickers = {}
    posts.forEach(p => {
      const matches = p.title.match(tickerRegex) || []
      matches.forEach(t => {
        tickers[t] = (tickers[t] || 0) + 1
      })
    })

    return {
      hotTopics: posts.slice(0, 5),
      mentionedTickers: Object.entries(tickers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ticker]) => ticker)
    }
  } catch (err) {
    console.error('   Erro stocks:', err.message)
    return null
  }
}

// Cache simples para evitar rate limits
const twitterCache = new Map()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutos
let lastTwitterCall = 0
const MIN_DELAY_BETWEEN_CALLS = 2000 // 2 segundos entre chamadas

/**
 * Busca tweets populares sobre um tópico (com cache e rate limit handling)
 */
async function searchTwitter(query, limit = 15) {
  // Verificar cache
  const cacheKey = query.toLowerCase()
  const cached = twitterCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  // Rate limit: esperar entre chamadas
  const timeSinceLastCall = Date.now() - lastTwitterCall
  if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall))
  }

  try {
    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_KEY_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    })

    lastTwitterCall = Date.now()

    const result = await client.v2.search(query, {
      max_results: limit,
      'tweet.fields': ['public_metrics', 'created_at', 'lang'],
      sort_order: 'relevancy'
    })

    if (!result.data?.data) return []

    const tweets = result.data.data
      .filter(t => t.lang === 'en' || t.lang === 'pt')
      .map(tweet => {
        const metrics = tweet.public_metrics || {}
        const age = (Date.now() - new Date(tweet.created_at).getTime()) / (1000 * 60 * 60) // horas

        // Calcular engagement score
        const engagement = (metrics.like_count || 0) +
                          (metrics.retweet_count || 0) * 2 +
                          (metrics.reply_count || 0) * 3

        // Calcular velocidade viral (engagement/hora)
        const viralVelocity = age > 0 ? engagement / age : engagement

        return {
          text: tweet.text,
          likes: metrics.like_count || 0,
          retweets: metrics.retweet_count || 0,
          replies: metrics.reply_count || 0,
          views: metrics.impression_count || 0,
          engagement,
          viralVelocity: viralVelocity.toFixed(1),
          ageHours: age.toFixed(1)
        }
      })
      .sort((a, b) => b.viralVelocity - a.viralVelocity)

    // Salvar no cache
    twitterCache.set(cacheKey, { data: tweets, timestamp: Date.now() })

    return tweets
  } catch (err) {
    // Se rate limit, retorna cache antigo se existir
    if (err.code === 429 || err.message?.includes('429')) {
      console.log(`      ⚠️ Rate limit para "${query}", usando cache ou pulando...`)
      if (cached) return cached.data
    } else {
      console.error(`   Erro Twitter search "${query}":`, err.message)
    }
    return []
  }
}

/**
 * Busca trending topics do X para um tópico
 */
async function fetchXTrending(topic) {
  const queries = TWITTER_SEARCHES[topic] || []
  const allTweets = []

  // Limita a 1-2 queries para evitar rate limit
  for (const query of queries.slice(0, 2)) {
    console.log(`      Buscando: ${query}...`)
    const tweets = await searchTwitter(query, 10)

    if (tweets.length > 0) {
      allTweets.push(...tweets)
      console.log(`      ✓ ${tweets.length} tweets encontrados`)
    }

    // Delay maior para evitar rate limit
    await new Promise(r => setTimeout(r, 3000))
  }

  // Se não conseguiu nada do Twitter, não é crítico
  if (allTweets.length === 0) {
    console.log(`      ⚠️ Sem dados do X para ${topic} (rate limit ou sem resultados)`)
  }

  // Remove duplicatas e ordena por velocidade viral
  const unique = allTweets.reduce((acc, t) => {
    if (!acc.find(x => x.text === t.text)) acc.push(t)
    return acc
  }, [])

  return unique.sort((a, b) => parseFloat(b.viralVelocity) - parseFloat(a.viralVelocity)).slice(0, 10)
}

// ==================== ANÁLISE COM CLAUDE ====================

/**
 * Analisa sentimento e relevância dos tweets
 */
async function analyzeSentimentAndRelevance(topic, tweets, extraData = {}) {
  // Mesmo sem tweets, podemos analisar com os dados extras
  const hasData = tweets.length > 0 || Object.keys(extraData).length > 0

  if (!hasData) {
    return { sentiment: 'neutral', relevantTweets: [], insights: [] }
  }

  const tweetSection = tweets.length > 0
    ? `TWEETS TRENDING (ordenados por velocidade viral):
${tweets.slice(0, 8).map((t, i) =>
  `${i + 1}. [${t.viralVelocity}/h] "${t.text.substring(0, 200)}"`
).join('\n')}`
    : 'SEM DADOS DO TWITTER (use os dados extras para análise)'

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `Analise os dados sobre ${topic} e extraia insights para posts.

${tweetSection}

DADOS DE MERCADO/CONTEXTO:
${JSON.stringify(extraData, null, 2)}

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

  try {
    const text = message.content[0].text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null
  } catch {
    return null
  }
}

// ==================== CURADORIA PRINCIPAL ====================

/**
 * Curadoria completa v2 com dados frescos e análise do X
 */
export async function curateContentV2() {
  console.log('📡 Iniciando curadoria v2 (dados frescos + análise X)...')

  const curated = {}

  // ========== CRYPTO ==========
  console.log('\n   🪙 CRYPTO:')
  console.log('      Buscando dados CoinGecko...')
  const cryptoData = await fetchCryptoData()

  console.log('      Buscando trending no X...')
  const cryptoTweets = await fetchXTrending('crypto')

  console.log('      Analisando sentimento...')
  const cryptoAnalysis = await analyzeSentimentAndRelevance('crypto e Bitcoin', cryptoTweets, {
    btcPrice: cryptoData?.bitcoin?.price,
    btcChange: cryptoData?.bitcoin?.change24h + '%',
    fearGreed: cryptoData?.fearGreed?.label,
    trending: cryptoData?.trending
  })

  curated.crypto = {
    realTimeData: {
      btcPrice: cryptoData?.bitcoin?.price,
      btcChange: cryptoData?.bitcoin?.change24h,
      ethPrice: cryptoData?.ethereum?.price,
      fearGreed: cryptoData?.fearGreed,
      trending: cryptoData?.trending
    },
    sentiment: cryptoAnalysis?.sentiment || 'neutral',
    sentimentScore: cryptoAnalysis?.sentimentScore || 0,
    narrative: cryptoAnalysis?.dominantNarrative || 'Mercado em movimento',
    contrarian: cryptoAnalysis?.contrarian,
    keyData: cryptoAnalysis?.keyData || [],
    angles: cryptoAnalysis?.suggestedAngles || [],
    viralPotential: cryptoAnalysis?.viralPotential || [],
    topTweets: cryptoTweets.slice(0, 3)
  }

  // ========== INVESTING ==========
  console.log('\n   📊 INVESTING:')
  console.log('      Buscando dados de mercado...')
  const stockData = await fetchStockData()

  console.log('      Buscando trending no X...')
  const investingTweets = await fetchXTrending('investing')

  console.log('      Analisando sentimento...')
  const investingAnalysis = await analyzeSentimentAndRelevance('mercado de ações e NASDAQ', investingTweets, {
    hotTopics: stockData?.hotTopics?.map(t => t.title),
    tickers: stockData?.mentionedTickers
  })

  curated.investing = {
    realTimeData: {
      hotTopics: stockData?.hotTopics?.slice(0, 3),
      mentionedTickers: stockData?.mentionedTickers
    },
    sentiment: investingAnalysis?.sentiment || 'neutral',
    sentimentScore: investingAnalysis?.sentimentScore || 0,
    narrative: investingAnalysis?.dominantNarrative || 'Mercado reagindo',
    contrarian: investingAnalysis?.contrarian,
    keyData: investingAnalysis?.keyData || [],
    angles: investingAnalysis?.suggestedAngles || [],
    viralPotential: investingAnalysis?.viralPotential || [],
    topTweets: investingTweets.slice(0, 3)
  }

  // ========== VIBE CODING ==========
  console.log('\n   💻 VIBE CODING:')
  console.log('      Buscando Hacker News...')
  const hnStories = await fetchHackerNews()

  console.log('      Buscando trending no X...')
  const vibeTweets = await fetchXTrending('vibeCoding')

  console.log('      Analisando sentimento...')
  const vibeAnalysis = await analyzeSentimentAndRelevance('AI coding e vibe coding', vibeTweets, {
    hackerNews: hnStories?.slice(0, 5).map(s => s.title)
  })

  curated.vibeCoding = {
    realTimeData: {
      hackerNews: hnStories?.slice(0, 5)
    },
    sentiment: vibeAnalysis?.sentiment || 'neutral',
    sentimentScore: vibeAnalysis?.sentimentScore || 0,
    narrative: vibeAnalysis?.dominantNarrative || 'AI coding evoluindo',
    contrarian: vibeAnalysis?.contrarian,
    keyData: vibeAnalysis?.keyData || [],
    angles: vibeAnalysis?.suggestedAngles || [],
    viralPotential: vibeAnalysis?.viralPotential || [],
    topTweets: vibeTweets.slice(0, 3)
  }

  console.log('\n✅ Curadoria v2 completa!')
  return curated
}

// ==================== HELPERS ====================

async function fetchHackerNews() {
  try {
    const topIds = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
      .then(r => r.json())

    const stories = await Promise.all(
      topIds.slice(0, 10).map(id =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
      )
    )

    return stories
      .filter(s => s && s.title)
      .map(s => ({
        title: s.title,
        score: s.score,
        comments: s.descendants || 0,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`
      }))
  } catch (err) {
    console.error('   Erro HN:', err.message)
    return []
  }
}

/**
 * Formata dados curados para o prompt de geração
 */
export function formatForPrompt(curated, topic) {
  const data = curated[topic]
  if (!data) return 'Sem dados disponíveis'

  let prompt = `DADOS EM TEMPO REAL:\n`

  if (topic === 'crypto' && data.realTimeData) {
    prompt += `- BTC: $${data.realTimeData.btcPrice} (${data.realTimeData.btcChange}%)\n`
    prompt += `- Fear & Greed: ${data.realTimeData.fearGreed?.value} (${data.realTimeData.fearGreed?.label})\n`
  }

  prompt += `\nSENTIMENTO DO X: ${data.sentiment} (score: ${data.sentimentScore})\n`
  prompt += `NARRATIVA DOMINANTE: ${data.narrative}\n`

  if (data.contrarian) {
    prompt += `ÂNGULO CONTRARIAN: ${data.contrarian}\n`
  }

  if (data.keyData?.length > 0) {
    prompt += `DADOS-CHAVE: ${data.keyData.join(', ')}\n`
  }

  if (data.topTweets?.length > 0) {
    prompt += `\nTWEETS VIRAIS NO MOMENTO:\n`
    data.topTweets.forEach((t, i) => {
      prompt += `${i + 1}. [${t.viralVelocity}/h] "${t.text.substring(0, 150)}..."\n`
    })
  }

  if (data.angles?.length > 0) {
    prompt += `\nÂNGULOS SUGERIDOS:\n`
    data.angles.forEach((a, i) => {
      prompt += `${i + 1}. [${a.type}] ${a.hook} → ${a.insight}\n`
    })
  }

  return prompt
}

// ==================== FALLBACK ====================

export function getFallbackContentV2() {
  return {
    crypto: {
      realTimeData: { btcPrice: 'N/A', btcChange: 'N/A' },
      sentiment: 'neutral',
      sentimentScore: 0,
      narrative: 'Mercado crypto em movimento',
      keyData: ['Volatilidade presente', 'Fluxo de ETFs em destaque'],
      angles: [{ type: 'CONTRARIAN', hook: 'Enquanto todos olham pra cima...', insight: 'O risco ignorado' }]
    },
    investing: {
      realTimeData: {},
      sentiment: 'neutral',
      sentimentScore: 0,
      narrative: 'Wall Street reagindo a dados',
      keyData: ['Earnings season', 'Fed em foco'],
      angles: [{ type: 'CONSEQUENCIA', hook: 'O efeito de segunda ordem...', insight: 'Ninguém está vendo' }]
    },
    vibeCoding: {
      realTimeData: {},
      sentiment: 'neutral',
      sentimentScore: 0,
      narrative: 'AI coding tools evoluindo',
      keyData: ['Novas features', 'Produtividade em debate'],
      angles: [{ type: 'TIP_TEASE', hook: 'Feature escondida que muda tudo...', insight: 'Poucos conhecem' }]
    }
  }
}
