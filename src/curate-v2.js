import Anthropic from '@anthropic-ai/sdk'
import { TwitterApi } from 'twitter-api-v2'

const anthropic = new Anthropic()

// ==================== CONFIGURAÇÃO ====================

// Queries otimizadas - uma query ampla por topico (menos requests = menos rate limit)
const TWITTER_SEARCHES = {
  crypto: ['Bitcoin OR #BTC OR #crypto -filter:retweets'],
  investing: ['stocks OR #SP500 OR $NVDA OR $TSLA -filter:retweets'],
  vibeCoding: ['Claude Code OR Cursor AI OR "vibe coding" OR "AI coding" -filter:retweets']
}

// Contas influentes para cada topico (para referencias)
const INFLUENCER_ACCOUNTS = {
  crypto: ['@sabortoothpete', '@CryptoCapo_', '@WClementeIII', '@documentingbtc', '@BitcoinMagazine'],
  investing: ['@jimcramer', '@StockMKTNewz', '@unusual_whales', '@DeItaone', '@zaborowski'],
  vibeCoding: ['@kaborowski', '@alexalbert__', '@cursor_ai', '@AnthropicAI', '@OpenAI']
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
const CACHE_TTL = 60 * 60 * 1000 // 60 minutos - cache mais longo
const STALE_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 horas - usa cache velho se rate limited
let lastTwitterCall = 0
let isRateLimited = false
let rateLimitResetTime = 0
const MIN_DELAY_BETWEEN_CALLS = 3000 // 3 segundos entre chamadas

// WOEID para trending (23424768 = Brasil, 1 = Worldwide)
const TRENDING_WOEID = 1 // Worldwide

/**
 * Busca trending topics globais do Twitter (requer acesso elevado)
 * Fallback: retorna null se não disponível
 */
async function fetchTwitterTrends() {
  try {
    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_KEY_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    })

    // Twitter API v1.1 trends (requer elevated access)
    const trends = await client.v1.trendsByPlace(TRENDING_WOEID)

    if (trends && trends[0]?.trends) {
      return trends[0].trends.slice(0, 10).map(t => ({
        name: t.name,
        tweetVolume: t.tweet_volume,
        url: t.url
      }))
    }
    return null
  } catch (err) {
    // Trends API requer elevated access - não é crítico
    if (err.code === 403 || err.message?.includes('403')) {
      console.log('      ℹ️ Trends API requer elevated access (ignorando)')
    } else if (err.code !== 429) {
      console.log('      ⚠️ Trends API indisponível:', err.message?.substring(0, 50))
    }
    return null
  }
}

/**
 * Busca tweets populares sobre um tópico (com cache e rate limit handling)
 */
async function searchTwitter(query, limit = 15) {
  // Verificar cache fresco
  const cacheKey = query.toLowerCase()
  const cached = twitterCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`      ✓ Usando cache (${Math.round((Date.now() - cached.timestamp) / 60000)}min)`)
    return cached.data
  }

  // Se estamos em rate limit, usar cache velho se disponível
  if (isRateLimited && Date.now() < rateLimitResetTime) {
    if (cached && Date.now() - cached.timestamp < STALE_CACHE_TTL) {
      console.log(`      ⚠️ Rate limited, usando cache antigo`)
      return cached.data
    }
    console.log(`      ⚠️ Rate limited, sem cache disponível`)
    return []
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
      'tweet.fields': ['public_metrics', 'created_at', 'lang', 'entities', 'author_id'],
      'user.fields': ['username', 'name', 'public_metrics'],
      'expansions': ['author_id'],
      sort_order: 'relevancy'
    })

    if (!result.data?.data) return []

    // Criar mapa de usuarios para lookup rapido
    const usersMap = new Map()
    if (result.data?.includes?.users) {
      result.data.includes.users.forEach(u => usersMap.set(u.id, u))
    }

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

        // Buscar info do autor
        const author = usersMap.get(tweet.author_id)
        const authorUsername = author?.username ? `@${author.username}` : null
        const authorFollowers = author?.public_metrics?.followers_count || 0

        // Extrair hashtags e mentions do tweet
        const hashtags = tweet.entities?.hashtags?.map(h => `#${h.tag}`) || []
        const mentions = tweet.entities?.mentions?.map(m => `@${m.username}`) || []

        return {
          text: tweet.text,
          author: authorUsername,
          authorFollowers,
          likes: metrics.like_count || 0,
          retweets: metrics.retweet_count || 0,
          replies: metrics.reply_count || 0,
          views: metrics.impression_count || 0,
          engagement,
          viralVelocity: viralVelocity.toFixed(1),
          ageHours: age.toFixed(1),
          hashtags,
          mentions
        }
      })
      .sort((a, b) => b.viralVelocity - a.viralVelocity)

    // Salvar no cache
    twitterCache.set(cacheKey, { data: tweets, timestamp: Date.now() })

    return tweets
  } catch (err) {
    // Se rate limit, marca e retorna cache antigo se existir
    if (err.code === 429 || err.message?.includes('429')) {
      isRateLimited = true
      rateLimitResetTime = Date.now() + 15 * 60 * 1000 // Reset em 15 min
      console.log(`      ⚠️ Rate limit para "${query.substring(0, 30)}...", reset em 15min`)
      if (cached && Date.now() - cached.timestamp < STALE_CACHE_TTL) {
        console.log(`      ✓ Usando cache antigo (${Math.round((Date.now() - cached.timestamp) / 60000)}min)`)
        return cached.data
      }
    } else {
      console.error(`   Erro Twitter search:`, err.message?.substring(0, 50))
    }
    return []
  }
}

/**
 * Busca trending topics do X para um tópico
 * Retorna tweets + metadados (autores, hashtags, mentions)
 */
async function fetchXTrending(topic) {
  const queries = TWITTER_SEARCHES[topic] || []
  const allTweets = []
  const hashtagCount = new Map()
  const authorCount = new Map()
  const mentionCount = new Map()

  // Limita a 1 query por topico para evitar rate limit
  // Usa a query mais especifica (primeira da lista)
  const query = queries[0]
  if (query) {
    console.log(`      Buscando: ${query}...`)
    const tweets = await searchTwitter(query, 15) // Busca mais tweets numa unica query

    if (tweets.length > 0) {
      allTweets.push(...tweets)
      console.log(`      ✓ ${tweets.length} tweets encontrados`)

      // Contabilizar hashtags, autores e mentions
      tweets.forEach(t => {
        // Hashtags
        t.hashtags?.forEach(h => {
          hashtagCount.set(h, (hashtagCount.get(h) || 0) + 1)
        })
        // Autores com mais engajamento
        if (t.author && t.authorFollowers > 500) { // Reduzido de 1000 para 500
          const current = authorCount.get(t.author) || { count: 0, followers: 0, engagement: 0 }
          authorCount.set(t.author, {
            count: current.count + 1,
            followers: Math.max(current.followers, t.authorFollowers),
            engagement: current.engagement + t.engagement
          })
        }
        // Mentions
        t.mentions?.forEach(m => {
          mentionCount.set(m, (mentionCount.get(m) || 0) + 1)
        })
      })
    }

    // Delay maior entre topicos para evitar rate limit
    await new Promise(r => setTimeout(r, 5000))
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

  // Top hashtags, autores e mentions
  const trendingHashtags = [...hashtagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }))

  const topAuthors = [...authorCount.entries()]
    .sort((a, b) => b[1].engagement - a[1].engagement)
    .slice(0, 5)
    .map(([author, data]) => ({ author, ...data }))

  const topMentions = [...mentionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mention, count]) => ({ mention, count }))

  return {
    tweets: unique.sort((a, b) => parseFloat(b.viralVelocity) - parseFloat(a.viralVelocity)).slice(0, 10),
    trendingHashtags,
    topAuthors,
    topMentions,
    influencers: INFLUENCER_ACCOUNTS[topic] || []
  }
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

  // Tentar buscar trends globais (opcional)
  console.log('\n   🌍 TRENDS GLOBAIS:')
  console.log('      Buscando trending topics...')
  const globalTrends = await fetchTwitterTrends()
  if (globalTrends) {
    console.log(`      ✓ ${globalTrends.length} trends encontrados`)
    curated.globalTrends = globalTrends
  } else {
    console.log('      ℹ️ Usando busca por hashtags (trends API indisponível)')
    curated.globalTrends = []
  }

  // ========== CRYPTO ==========
  console.log('\n   🪙 CRYPTO:')
  console.log('      Buscando dados CoinGecko...')
  const cryptoData = await fetchCryptoData()

  console.log('      Buscando trending no X...')
  const cryptoX = await fetchXTrending('crypto')

  console.log('      Analisando sentimento...')
  const cryptoAnalysis = await analyzeSentimentAndRelevance('crypto e Bitcoin', cryptoX.tweets, {
    btcPrice: cryptoData?.bitcoin?.price,
    btcChange: cryptoData?.bitcoin?.change24h + '%',
    fearGreed: cryptoData?.fearGreed?.label,
    trending: cryptoData?.trending,
    trendingHashtags: cryptoX.trendingHashtags?.map(h => h.tag),
    topAuthors: cryptoX.topAuthors?.map(a => a.author),
    topMentions: cryptoX.topMentions?.map(m => m.mention)
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
    topTweets: cryptoX.tweets?.slice(0, 3) || [],
    trendingHashtags: cryptoX.trendingHashtags || [],
    topAuthors: cryptoX.topAuthors || [],
    topMentions: cryptoX.topMentions || [],
    influencers: cryptoX.influencers || []
  }

  // ========== INVESTING ==========
  console.log('\n   📊 INVESTING:')
  console.log('      Buscando dados de mercado...')
  const stockData = await fetchStockData()

  console.log('      Buscando trending no X...')
  const investingX = await fetchXTrending('investing')

  console.log('      Analisando sentimento...')
  const investingAnalysis = await analyzeSentimentAndRelevance('mercado de ações e NASDAQ', investingX.tweets, {
    hotTopics: stockData?.hotTopics?.map(t => t.title),
    tickers: stockData?.mentionedTickers,
    trendingHashtags: investingX.trendingHashtags?.map(h => h.tag),
    topAuthors: investingX.topAuthors?.map(a => a.author),
    topMentions: investingX.topMentions?.map(m => m.mention)
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
    topTweets: investingX.tweets?.slice(0, 3) || [],
    trendingHashtags: investingX.trendingHashtags || [],
    topAuthors: investingX.topAuthors || [],
    topMentions: investingX.topMentions || [],
    influencers: investingX.influencers || []
  }

  // ========== VIBE CODING ==========
  console.log('\n   💻 VIBE CODING:')
  console.log('      Buscando Hacker News...')
  const hnStories = await fetchHackerNews()

  console.log('      Buscando trending no X...')
  const vibeX = await fetchXTrending('vibeCoding')

  console.log('      Analisando sentimento...')
  const vibeAnalysis = await analyzeSentimentAndRelevance('AI coding e vibe coding', vibeX.tweets, {
    hackerNews: hnStories?.slice(0, 5).map(s => s.title),
    trendingHashtags: vibeX.trendingHashtags?.map(h => h.tag),
    topAuthors: vibeX.topAuthors?.map(a => a.author),
    topMentions: vibeX.topMentions?.map(m => m.mention)
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
    topTweets: vibeX.tweets?.slice(0, 3) || [],
    trendingHashtags: vibeX.trendingHashtags || [],
    topAuthors: vibeX.topAuthors || [],
    topMentions: vibeX.topMentions || [],
    influencers: vibeX.influencers || []
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

  // Hashtags trending
  if (data.trendingHashtags?.length > 0) {
    prompt += `\nHASHTAGS EM ALTA: ${data.trendingHashtags.map(h => h.tag).join(' ')}\n`
  }

  // Autores influentes
  if (data.topAuthors?.length > 0) {
    prompt += `CONTAS ATIVAS: ${data.topAuthors.map(a => a.author).join(', ')}\n`
  }

  // Mentions populares
  if (data.topMentions?.length > 0) {
    prompt += `MAIS MENCIONADOS: ${data.topMentions.map(m => m.mention).join(', ')}\n`
  }

  // Influencers do nicho (para referencia)
  if (data.influencers?.length > 0) {
    prompt += `INFLUENCERS DO NICHO: ${data.influencers.join(', ')}\n`
  }

  if (data.topTweets?.length > 0) {
    prompt += `\nTWEETS VIRAIS NO MOMENTO:\n`
    data.topTweets.forEach((t, i) => {
      const authorInfo = t.author ? ` por ${t.author}` : ''
      prompt += `${i + 1}. [${t.viralVelocity}/h${authorInfo}] "${t.text.substring(0, 150)}..."\n`
    })
  }

  if (data.angles?.length > 0) {
    prompt += `\nÂNGULOS SUGERIDOS:\n`
    data.angles.forEach((a, i) => {
      prompt += `${i + 1}. [${a.type}] ${a.hook} → ${a.insight}\n`
    })
  }

  prompt += `\nINSTRUÇÕES EXTRAS:\n`
  prompt += `- Use 1-2 hashtags relevantes do trending\n`
  prompt += `- Se fizer sentido, mencione ou referencie uma conta ativa\n`
  prompt += `- Mantenha o tom autêntico e não pareça bot\n`

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
