import { TwitterApi } from 'twitter-api-v2'

export function createTwitterClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })
}

// Delay helper
const delay = ms => new Promise(r => setTimeout(r, ms))

// Track last post time to avoid rate limits
let lastPostTime = 0
const MIN_DELAY_BETWEEN_POSTS = 10000 // 10 segundos entre posts

export async function postTweet(client, text, retries = 1) {
  // Garantir delay minimo entre posts
  const now = Date.now()
  const timeSinceLastPost = now - lastPostTime
  if (timeSinceLastPost < MIN_DELAY_BETWEEN_POSTS) {
    await delay(MIN_DELAY_BETWEEN_POSTS - timeSinceLastPost)
  }

  try {
    const { data } = await client.v2.tweet(text)
    lastPostTime = Date.now()
    return {
      id: data.id,
      text: data.text,
      url: `https://x.com/${process.env.X_USERNAME}/status/${data.id}`
    }
  } catch (err) {
    // Rate limit - aguarda brevemente e tenta mais uma vez
    if ((err.code === 429 || err.message?.includes('429')) && retries > 0) {
      console.log(`⏳ Rate limit atingido, aguardando 30s...`)
      await delay(30000) // Aguarda 30 segundos
      return postTweet(client, text, retries - 1)
    }

    // Erro especifico para rate limit persistente
    if (err.code === 429 || err.message?.includes('429')) {
      const rateLimitError = new Error('RATE_LIMIT_EXCEEDED')
      rateLimitError.isRateLimit = true
      rateLimitError.original = err
      throw rateLimitError
    }

    throw err
  }
}

export async function verifyCredentials(client) {
  const me = await client.v1.verifyCredentials()
  return { id: me.id_str, username: me.screen_name, name: me.name }
}
