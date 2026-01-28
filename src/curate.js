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
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `Voce e um curador de conteudo especializado em encontrar ANGULOS VIRAIS.

TOPICO: ${topic}

DADOS BRUTOS:
${JSON.stringify(rawData, null, 2)}

TAREFA: Extraia a noticia mais relevante e crie 3 ANGULOS diferentes para posts.

TIPOS DE ANGULOS (use variedade):
1. CONTRARIAN: O oposto do que todos estao dizendo
2. CONSEQUENCIA: O efeito de segunda ordem que ninguem ve
3. CONEXAO: Ligacao inesperada com outro assunto
4. HISTORICO: Paralelo com evento passado
5. PREVISAO: O que vai acontecer se continuar assim
6. TIP_TEASE: Revela que existe dica/truque util mas NAO entrega tudo (gera curiosidade para replies)

Responda em JSON:
{
  "mainNews": "resumo factual da noticia (max 100 chars)",
  "keyData": ["numero/dado concreto 1", "numero/dado concreto 2"],
  "angles": [
    {"type": "CONTRARIAN", "hook": "gancho em 40 chars", "insight": "a opiniao/conclusao"},
    {"type": "CONSEQUENCIA", "hook": "gancho em 40 chars", "insight": "a opiniao/conclusao"},
    {"type": "CONEXAO", "hook": "gancho em 40 chars", "insight": "a opiniao/conclusao"}
  ],
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

// Formata angulos do novo formato para string
function formatAngles(angles) {
  if (!angles || !Array.isArray(angles)) return null
  return angles.map(a => {
    if (typeof a === 'string') return a
    return `[${a.type}] ${a.hook} → ${a.insight}`
  })
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
    data: cryptoAnalysis?.keyData || cryptoAnalysis?.data || [],
    angles: formatAngles(cryptoAnalysis?.angles) || ['Analise do mercado crypto'],
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
    data: investingAnalysis?.keyData || investingAnalysis?.data || [],
    angles: formatAngles(investingAnalysis?.angles) || ['Analise do mercado americano'],
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
    note: `Foque em ferramentas de AI coding: Claude Code, Cursor, Copilot, Windsurf.
IMPORTANTE: Alem de noticias, procure DICAS/TIPS escondidas - configs secretas, features pouco conhecidas, truques de produtividade.
Tipo de angulo especial: TIP_TEASE - revela que existe algo util mas nao entrega tudo (gera curiosidade).
Exemplo: "Claude Code tem 2 features desligadas por padrao que mudam tudo" (sem dizer quais)`
  })
  curated.vibeCoding = {
    context: vibeCodingAnalysis?.mainNews || 'Sem dados',
    data: vibeCodingAnalysis?.keyData || vibeCodingAnalysis?.data || [],
    angles: formatAngles(vibeCodingAnalysis?.angles) || ['Analise de vibe coding'],
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
    data: iaAnalysis?.keyData || iaAnalysis?.data || [],
    angles: formatAngles(iaAnalysis?.angles) || ['Analise do mercado de IA'],
    source: iaAnalysis?.source || 'HN/Reddit'
  }

  console.log('✅ Curadoria completa')
  return curated
}

// Versao simplificada que usa dados estaticos quando curadoria falha
export function getFallbackContent() {
  return {
    crypto: {
      context: 'Bitcoin e mercado crypto em movimento',
      data: ['Volatilidade BTC', 'Fluxo ETFs', 'Regulacao'],
      angles: ['[CONTRARIAN] Enquanto todos comemoram... → O risco que ninguem ve'],
      source: 'Mercado'
    },
    investing: {
      context: 'NASDAQ e S&P 500 reagindo a earnings e Fed',
      data: ['Variacao S&P 500', 'Earnings big techs', 'Decisao juros'],
      angles: ['[CONSEQUENCIA] Wall Street celebra, mas... → O efeito de segunda ordem'],
      source: 'Wall Street'
    },
    vibeCoding: {
      context: 'AI coding tools evoluindo rapidamente',
      data: ['Claude Code', 'Cursor', 'Produtividade'],
      angles: ['[TIP_TEASE] Feature escondida que muda tudo... → Revela que existe mas gera curiosidade'],
      source: 'Tech'
    },
    ia: {
      context: 'Corrida de LLMs entre OpenAI, Anthropic, Google',
      data: ['Novos modelos', 'Custos', 'Benchmarks'],
      angles: ['[CONEXAO] Enquanto discutem qual modelo e melhor... → Quem realmente ganha'],
      source: 'Tech'
    }
  }
}
