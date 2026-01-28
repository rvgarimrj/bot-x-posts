import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// Fontes por topico
const SOURCES = {
  crypto: [
    { name: 'CoinDesk', url: 'https://www.coindesk.com/' },
    { name: 'CoinTelegraph', url: 'https://cointelegraph.com/' },
    { name: 'Reddit Crypto', url: 'https://www.reddit.com/r/cryptocurrency/hot/.json?limit=5' },
  ],
  investing: [
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/' },
    { name: 'CNBC Markets', url: 'https://www.cnbc.com/markets/' },
    { name: 'Reddit Investing', url: 'https://www.reddit.com/r/investing/hot/.json?limit=5' },
  ],
  vibeCoding: [
    { name: 'Hacker News', url: 'https://news.ycombinator.com/' },
    { name: 'Reddit Programming', url: 'https://www.reddit.com/r/programming/hot/.json?limit=5' },
    { name: 'Dev.to', url: 'https://dev.to/' },
  ]
}

// Busca dados do Reddit (JSON publico)
async function fetchRedditHot(subreddit) {
  try {
    const response = await fetch(`https://www.reddit.com/r/${subreddit}/hot/.json?limit=10`, {
      headers: { 'User-Agent': 'BotXPosts/1.0' }
    })
    const data = await response.json()

    return data.data.children
      .filter(post => !post.data.stickied)
      .slice(0, 5)
      .map(post => ({
        title: post.data.title,
        score: post.data.score,
        comments: post.data.num_comments,
        url: `https://reddit.com${post.data.permalink}`
      }))
  } catch (err) {
    console.error(`Erro ao buscar r/${subreddit}:`, err.message)
    return []
  }
}

// Busca Hacker News top stories
async function fetchHackerNews() {
  try {
    const topIds = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
      .then(r => r.json())

    const stories = await Promise.all(
      topIds.slice(0, 8).map(id =>
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
    console.error('Erro ao buscar HN:', err.message)
    return []
  }
}

// Analisa e extrai insights com Claude
async function analyzeWithClaude(topic, rawData) {
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Voce e um curador de conteudo. Analise esses dados sobre ${topic} e extraia:
1. A noticia/tendencia MAIS relevante do momento
2. Dados concretos (numeros, %, valores)
3. Um angulo unico/contrarian para um post

Dados brutos:
${JSON.stringify(rawData, null, 2)}

Responda em JSON:
{
  "mainNews": "resumo da noticia principal",
  "data": ["dado1", "dado2", "dado3"],
  "angle": "angulo unico para post",
  "source": "fonte principal"
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

// Curadoria completa
export async function curateContent() {
  console.log('📡 Iniciando curadoria de conteudo...')

  const curated = {}

  // CRYPTO
  console.log('   Buscando: Crypto...')
  const cryptoReddit = await fetchRedditHot('cryptocurrency')
  const cryptoAnalysis = await analyzeWithClaude('crypto e Bitcoin', {
    reddit: cryptoReddit,
    note: 'Foque em movimentos de preco, ETFs, regulacao, adocao institucional'
  })
  curated.crypto = {
    context: cryptoAnalysis?.mainNews || 'Sem dados',
    data: cryptoAnalysis?.data || [],
    angles: [cryptoAnalysis?.angle || 'Analise do mercado crypto'],
    source: cryptoAnalysis?.source || 'Reddit'
  }

  // INVESTING (NASDAQ, S&P 500, Bloomberg)
  console.log('   Buscando: Investimentos (NASDAQ/S&P500)...')
  const investingReddit = await fetchRedditHot('investing')
  const stocksReddit = await fetchRedditHot('stocks')
  const wallstreetbetsReddit = await fetchRedditHot('wallstreetbets')

  const investingAnalysis = await analyzeWithClaude('mercado de acoes americano (NASDAQ, S&P 500)', {
    redditInvesting: investingReddit.slice(0, 5),
    redditStocks: stocksReddit.slice(0, 5),
    redditWSB: wallstreetbetsReddit.slice(0, 3),
    note: 'Foque em: NASDAQ, S&P 500, Dow Jones, earnings de big techs (Apple, Google, Microsoft, Nvidia, Tesla), decisoes do Fed, inflacao, juros, Bloomberg, CNBC. Dados concretos: variacao %, pontos, valores de mercado.'
  })
  curated.investing = {
    context: investingAnalysis?.mainNews || 'Sem dados',
    data: investingAnalysis?.data || [],
    angles: [investingAnalysis?.angle || 'Analise do mercado americano'],
    source: investingAnalysis?.source || 'Wall Street'
  }

  // VIBE CODING
  console.log('   Buscando: Vibe Coding...')
  const hnStories = await fetchHackerNews()
  const programmingReddit = await fetchRedditHot('programming')

  // Filtra por IA/coding
  const aiRelated = [...hnStories, ...programmingReddit].filter(item =>
    /ai|claude|gpt|cursor|copilot|llm|coding|developer/i.test(item.title)
  )

  const vibeCodingAnalysis = await analyzeWithClaude('vibe coding e programacao com IA', {
    hackerNews: hnStories.slice(0, 5),
    reddit: programmingReddit.slice(0, 5),
    aiRelated: aiRelated.slice(0, 5),
    note: 'Foque em ferramentas de AI coding, Claude Code, Cursor, produtividade dev'
  })
  curated.vibeCoding = {
    context: vibeCodingAnalysis?.mainNews || 'Sem dados',
    data: vibeCodingAnalysis?.data || [],
    angles: [vibeCodingAnalysis?.angle || 'Analise de vibe coding'],
    source: vibeCodingAnalysis?.source || 'HN/Reddit'
  }

  // IA (Inteligencia Artificial)
  console.log('   Buscando: IA...')
  const aiReddit = await fetchRedditHot('artificial')
  const localLlamaReddit = await fetchRedditHot('LocalLLaMA')

  // Filtra HN por IA geral (nao coding)
  const aiNews = hnStories.filter(item =>
    /openai|anthropic|claude|gpt|gemini|llama|mistral|ai|machine learning|neural|model/i.test(item.title) &&
    !/coding|cursor|copilot|developer|programming/i.test(item.title)
  )

  const iaAnalysis = await analyzeWithClaude('inteligencia artificial e LLMs', {
    hackerNews: aiNews.slice(0, 5),
    redditAI: aiReddit.slice(0, 5),
    redditLocalLLaMA: localLlamaReddit.slice(0, 5),
    note: 'Foque em lancamentos de modelos, OpenAI, Anthropic, Google, Meta, benchmarks, AGI, regulacao de IA'
  })
  curated.ia = {
    context: iaAnalysis?.mainNews || 'Sem dados',
    data: iaAnalysis?.data || [],
    angles: [iaAnalysis?.angle || 'Analise do mercado de IA'],
    source: iaAnalysis?.source || 'HN/Reddit'
  }

  console.log('✅ Curadoria completa')
  return curated
}

// Versao simplificada que usa dados estaticos quando curadoria falha
export function getFallbackContent() {
  return {
    crypto: {
      context: 'Bitcoin e mercado crypto em movimento. ETFs, regulacao e adocao institucional continuam sendo temas quentes.',
      data: ['Volatilidade do BTC', 'Fluxo de ETFs', 'Decisoes regulatorias'],
      angles: ['Analise contrarian do mercado crypto'],
      source: 'Mercado'
    },
    investing: {
      context: 'NASDAQ e S&P 500 reagindo a earnings das big techs e decisoes do Fed.',
      data: ['Variacao do S&P 500', 'Earnings FAANG', 'Taxa de juros Fed'],
      angles: ['O que Wall Street nao esta precificando'],
      source: 'Wall Street'
    },
    vibeCoding: {
      context: 'Ferramentas de AI coding evoluindo rapidamente. Claude Code, Cursor e Copilot disputam espaco.',
      data: ['Adocao de AI coding', 'Produtividade dev', 'Novos features'],
      angles: ['Critica honesta sobre AI coding tools'],
      source: 'Tech'
    },
    ia: {
      context: 'Corrida de LLMs continua. OpenAI, Anthropic, Google e Meta lancando novos modelos.',
      data: ['Benchmarks de modelos', 'Custos de inferencia', 'Adocao enterprise'],
      angles: ['O que realmente importa na guerra dos LLMs'],
      source: 'Tech'
    }
  }
}
