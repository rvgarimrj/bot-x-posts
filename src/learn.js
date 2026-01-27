import { TwitterApi } from 'twitter-api-v2'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// Busca tweets recentes da conta com metricas de engajamento
export async function fetchRecentTweets(limit = 20) {
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })

  try {
    // Buscar ID do usuario
    const me = await client.v2.me()
    const userId = me.data.id

    // Buscar tweets com metricas
    const tweets = await client.v2.userTimeline(userId, {
      max_results: limit,
      'tweet.fields': ['public_metrics', 'created_at'],
      exclude: ['retweets', 'replies']
    })

    if (!tweets.data?.data) {
      console.log('   Nenhum tweet encontrado')
      return []
    }

    // Formatar com metricas
    return tweets.data.data.map(tweet => ({
      text: tweet.text,
      likes: tweet.public_metrics?.like_count || 0,
      retweets: tweet.public_metrics?.retweet_count || 0,
      replies: tweet.public_metrics?.reply_count || 0,
      views: tweet.public_metrics?.impression_count || 0,
      engagement: (tweet.public_metrics?.like_count || 0) +
                  (tweet.public_metrics?.retweet_count || 0) * 2 +
                  (tweet.public_metrics?.reply_count || 0) * 3,
      created_at: tweet.created_at
    }))
  } catch (err) {
    console.error('   Erro ao buscar tweets:', err.message)
    return []
  }
}

// Analisa padroes de engajamento com Claude
export async function analyzeEngagement(tweets) {
  if (tweets.length === 0) {
    return null
  }

  // Ordenar por engajamento
  const sorted = [...tweets].sort((a, b) => b.engagement - a.engagement)
  const topPosts = sorted.slice(0, 5)
  const lowPosts = sorted.slice(-3)

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Analise esses posts do X e identifique PADROES de engajamento.

POSTS COM MAIS ENGAJAMENTO:
${topPosts.map((t, i) => `${i + 1}. [${t.likes} likes, ${t.retweets} RTs] "${t.text}"`).join('\n')}

POSTS COM MENOS ENGAJAMENTO:
${lowPosts.map((t, i) => `${i + 1}. [${t.likes} likes, ${t.retweets} RTs] "${t.text}"`).join('\n')}

Responda em JSON:
{
  "topPatterns": ["padrao1", "padrao2", "padrao3"],
  "avoid": ["o que evitar1", "o que evitar2"],
  "bestTone": "descricao do tom que funciona",
  "bestLength": "curto/medio/longo",
  "bestTopics": ["topico1", "topico2"],
  "tip": "uma dica especifica baseada nos dados"
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

// Gera contexto de aprendizado para o prompt
export async function getEngagementContext() {
  console.log('   Analisando posts anteriores...')

  const tweets = await fetchRecentTweets(20)

  if (tweets.length < 5) {
    console.log('   Poucos posts para analisar, pulando aprendizado')
    return null
  }

  const analysis = await analyzeEngagement(tweets)

  if (!analysis) {
    console.log('   Nao foi possivel analisar engajamento')
    return null
  }

  console.log('   ✓ Padroes de engajamento identificados')

  return `
APRENDIZADO DOS SEUS POSTS ANTERIORES:
- O que funciona: ${analysis.topPatterns?.join(', ') || 'N/A'}
- O que evitar: ${analysis.avoid?.join(', ') || 'N/A'}
- Tom ideal: ${analysis.bestTone || 'N/A'}
- Tamanho ideal: ${analysis.bestLength || 'N/A'}
- Topicos que engajam: ${analysis.bestTopics?.join(', ') || 'N/A'}
- Dica: ${analysis.tip || 'N/A'}

USE ESSES INSIGHTS para criar posts que engajem mais.
`
}
