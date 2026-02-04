/**
 * Reply Monitor - Monitors and responds to comments on posts
 *
 * Features:
 * - Fetches replies/mentions on recent posts
 * - Generates humanized responses with Claude
 * - Uses emojis and friendly tone
 * - Tracks reply performance for learning
 * - Avoids duplicate responses
 */

import Anthropic from '@anthropic-ai/sdk'
import { TwitterApi } from 'twitter-api-v2'
import fs from 'fs'
import path from 'path'

const anthropic = new Anthropic()

// ==================== CONFIGURATION ====================

const DATA_DIR = '/Users/user/AppsCalude/Bot-X-Posts/data'
const REPLIES_LOG_FILE = path.join(DATA_DIR, 'replies-log.json')
const REPLIED_IDS_FILE = path.join(DATA_DIR, 'replied-ids.json')

// Reply styles for variety
const REPLY_STYLES = [
  { name: 'friendly', instruction: 'Super amigável e caloroso. Use emojis como 😊🙌✨' },
  { name: 'helpful', instruction: 'Prestativo e informativo, mas leve. Use emojis como 💡👍📚' },
  { name: 'funny', instruction: 'Bem humorado, faça uma piada leve se couber. Use emojis como 😂🤣💀' },
  { name: 'grateful', instruction: 'Agradeça genuinamente. Use emojis como 🙏❤️🔥' },
  { name: 'curious', instruction: 'Mostre interesse genuíno, faça uma pergunta de volta. Use emojis como 🤔👀💭' }
]

// Types of comments and how to handle them
const COMMENT_TYPES = {
  question: {
    detect: ['?', 'como', 'how', 'what', 'why', 'quando', 'where', 'qual', 'quem', 'can you', 'could you', 'pode', 'consegue'],
    priority: 'high',
    styles: ['helpful', 'friendly']
  },
  agreement: {
    detect: ['concordo', 'agree', 'exactly', 'isso', 'true', 'real', 'fato', 'based', 'this', '100%', 'facts'],
    priority: 'medium',
    styles: ['grateful', 'friendly']
  },
  disagreement: {
    detect: ['discordo', 'disagree', 'but', 'mas', 'however', 'nah', 'wrong', 'errado', 'não é bem assim'],
    priority: 'high',
    styles: ['friendly', 'curious']
  },
  compliment: {
    detect: ['great', 'awesome', 'love', 'best', 'amazing', 'top', 'boa', 'otimo', 'excelente', 'genial', 'mito', 'crack'],
    priority: 'medium',
    styles: ['grateful', 'funny']
  },
  joke: {
    detect: ['kk', 'lol', 'lmao', 'haha', '😂', '🤣', 'kkk', 'rsrs'],
    priority: 'low',
    styles: ['funny', 'friendly']
  },
  generic: {
    detect: [],
    priority: 'low',
    styles: ['friendly', 'grateful']
  }
}

// ==================== TWITTER API ====================

async function getTwitterClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })
}

/**
 * Fetch recent mentions/replies to our account
 */
async function fetchMentions(sinceId = null, limit = 50) {
  try {
    const client = await getTwitterClient()
    const me = await client.v2.me()
    const userId = me.data.id

    const params = {
      max_results: Math.min(limit, 100),
      'tweet.fields': ['author_id', 'created_at', 'text', 'in_reply_to_user_id', 'referenced_tweets', 'public_metrics'],
      'user.fields': ['username', 'name', 'verified'],
      expansions: ['author_id', 'referenced_tweets.id']
    }

    if (sinceId) {
      params.since_id = sinceId
    }

    const mentions = await client.v2.userMentionTimeline(userId, params)

    if (!mentions.data?.data) {
      return []
    }

    // Build user map from includes
    const userMap = {}
    if (mentions.includes?.users) {
      mentions.includes.users.forEach(u => {
        userMap[u.id] = u
      })
    }

    return mentions.data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      authorUsername: userMap[tweet.author_id]?.username || 'unknown',
      authorName: userMap[tweet.author_id]?.name || 'Unknown',
      authorVerified: userMap[tweet.author_id]?.verified || false,
      createdAt: tweet.created_at,
      inReplyToUserId: tweet.in_reply_to_user_id,
      referencedTweets: tweet.referenced_tweets || [],
      metrics: tweet.public_metrics || {}
    }))
  } catch (err) {
    console.log(`   Error fetching mentions: ${err.message}`)
    return []
  }
}

/**
 * Fetch replies to a specific tweet
 */
async function fetchRepliesToTweet(tweetId, limit = 20) {
  try {
    const client = await getTwitterClient()

    const replies = await client.v2.search(`conversation_id:${tweetId}`, {
      max_results: Math.min(limit, 100),
      'tweet.fields': ['author_id', 'created_at', 'text', 'in_reply_to_user_id', 'public_metrics'],
      'user.fields': ['username', 'name', 'verified'],
      expansions: ['author_id']
    })

    if (!replies.data?.data) {
      return []
    }

    // Build user map
    const userMap = {}
    if (replies.includes?.users) {
      replies.includes.users.forEach(u => {
        userMap[u.id] = u
      })
    }

    return replies.data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      authorUsername: userMap[tweet.author_id]?.username || 'unknown',
      authorName: userMap[tweet.author_id]?.name || 'Unknown',
      authorVerified: userMap[tweet.author_id]?.verified || false,
      createdAt: tweet.created_at,
      conversationId: tweetId,
      metrics: tweet.public_metrics || {}
    }))
  } catch (err) {
    console.log(`   Error fetching replies: ${err.message}`)
    return []
  }
}

// ==================== COMMENT CLASSIFICATION ====================

/**
 * Detect the type of comment
 */
function classifyComment(text) {
  const textLower = text.toLowerCase()

  for (const [type, config] of Object.entries(COMMENT_TYPES)) {
    if (type === 'generic') continue

    for (const keyword of config.detect) {
      if (textLower.includes(keyword.toLowerCase())) {
        return { type, ...config }
      }
    }
  }

  return { type: 'generic', ...COMMENT_TYPES.generic }
}

/**
 * Select reply style based on comment type
 */
function selectReplyStyle(commentType) {
  const styles = commentType.styles || ['friendly']
  const styleName = styles[Math.floor(Math.random() * styles.length)]
  return REPLY_STYLES.find(s => s.name === styleName) || REPLY_STYLES[0]
}

// ==================== REPLY GENERATION ====================

/**
 * Generate a reply using Claude
 */
async function generateReply(comment, originalPost = null, retries = 2) {
  const commentType = classifyComment(comment.text)
  const style = selectReplyStyle(commentType)

  const systemPrompt = `Você é o @garim no X (Twitter). Responda comentários de forma HUMANA.

=== REGRAS ABSOLUTAS ===
- SEMPRE use emojis (2-4 por resposta)
- Seja educado, gentil e bem humorado
- Respostas CURTAS (max 200 chars)
- NUNCA pareça robô ou formal
- Use português brasileiro casual
- Se for pergunta, responda de forma útil
- Se for elogio, agradeça genuinamente
- Se for crítica, seja respeitoso mas mantenha sua opinião
- Se for piada, entre na brincadeira

=== ESTILO DESTA RESPOSTA ===
${style.instruction}

=== PALAVRAS PROIBIDAS ===
NUNCA use: "Interestingly", "Notably", "Certainly", "Absolutely", "Indeed", "Furthermore", "comprehensive", "leverage", "utilize"

=== EXEMPLOS BONS ===
- "boa pergunta! 🤔 na real, depende muito do contexto, mas geralmente..."
- "kkkk exatamente isso 😂🙌"
- "valeu demais pelo feedback! ❤️🔥"
- "hmm interessante ponto de vista 👀 mas e se..."
- "opa! então, o lance é... 💡✨"`

  const contextInfo = originalPost
    ? `\nSEU POST ORIGINAL: "${originalPost.substring(0, 200)}"`
    : ''

  const userPrompt = `COMENTÁRIO de @${comment.authorUsername}:
"${comment.text}"
${contextInfo}

TIPO DETECTADO: ${commentType.type}

Responda de forma ${style.name}. Max 200 chars. Use emojis!`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    })

    let reply = message.content[0].text.trim()

    // Ensure it starts with @ mention
    if (!reply.startsWith('@')) {
      reply = `@${comment.authorUsername} ${reply}`
    }

    // Ensure max length
    if (reply.length > 280) {
      reply = reply.substring(0, 277) + '...'
    }

    return {
      text: reply,
      style: style.name,
      commentType: commentType.type,
      generatedAt: new Date().toISOString()
    }
  } catch (err) {
    console.log(`   Error generating reply: ${err.message}`)
    if (retries > 0) {
      return generateReply(comment, originalPost, retries - 1)
    }
    return null
  }
}

// ==================== REPLY POSTING ====================

/**
 * Post a reply to a tweet
 */
async function postReply(replyText, inReplyToId) {
  try {
    const client = await getTwitterClient()

    const result = await client.v2.tweet({
      text: replyText,
      reply: {
        in_reply_to_tweet_id: inReplyToId
      }
    })

    return {
      success: true,
      tweetId: result.data.id
    }
  } catch (err) {
    console.log(`   Error posting reply: ${err.message}`)
    return {
      success: false,
      error: err.message
    }
  }
}

// ==================== TRACKING ====================

function loadRepliedIds() {
  try {
    if (fs.existsSync(REPLIED_IDS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(REPLIED_IDS_FILE, 'utf-8')))
    }
  } catch (err) {
    console.log(`   Warning: Could not load replied IDs: ${err.message}`)
  }
  return new Set()
}

function saveRepliedIds(ids) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(REPLIED_IDS_FILE, JSON.stringify([...ids]))
  } catch (err) {
    console.log(`   Warning: Could not save replied IDs: ${err.message}`)
  }
}

function loadRepliesLog() {
  try {
    if (fs.existsSync(REPLIES_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(REPLIES_LOG_FILE, 'utf-8'))
    }
  } catch (err) {
    console.log(`   Warning: Could not load replies log: ${err.message}`)
  }
  return { replies: [], stats: { total: 0, byType: {}, byStyle: {} } }
}

function saveRepliesLog(log) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(REPLIES_LOG_FILE, JSON.stringify(log, null, 2))
  } catch (err) {
    console.log(`   Warning: Could not save replies log: ${err.message}`)
  }
}

function logReply(comment, reply, result) {
  const log = loadRepliesLog()

  const entry = {
    id: result.tweetId || null,
    commentId: comment.id,
    commentText: comment.text,
    commentAuthor: comment.authorUsername,
    commentType: reply.commentType,
    replyText: reply.text,
    replyStyle: reply.style,
    success: result.success,
    error: result.error || null,
    timestamp: new Date().toISOString()
  }

  log.replies.push(entry)
  log.stats.total++
  log.stats.byType[reply.commentType] = (log.stats.byType[reply.commentType] || 0) + 1
  log.stats.byStyle[reply.style] = (log.stats.byStyle[reply.style] || 0) + 1

  // Keep only last 500 replies
  if (log.replies.length > 500) {
    log.replies = log.replies.slice(-500)
  }

  saveRepliesLog(log)
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Process and reply to pending mentions
 */
export async function processReplies(maxReplies = 10, dryRun = false) {
  console.log('Reply Monitor - Processing mentions')
  console.log('=' .repeat(50))

  const repliedIds = loadRepliedIds()

  // Fetch recent mentions
  console.log('\n1. Fetching mentions...')
  const mentions = await fetchMentions(null, 50)
  console.log(`   Found ${mentions.length} mentions`)

  if (mentions.length === 0) {
    console.log('   No mentions to process')
    return { processed: 0, replied: 0 }
  }

  // Filter out already replied
  const pending = mentions.filter(m => !repliedIds.has(m.id))
  console.log(`   ${pending.length} new mentions to process`)

  if (pending.length === 0) {
    console.log('   All mentions already processed')
    return { processed: 0, replied: 0 }
  }

  // Sort by priority (questions first, then others)
  const sorted = pending.sort((a, b) => {
    const typeA = classifyComment(a.text)
    const typeB = classifyComment(b.text)
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    return (priorityOrder[typeA.priority] || 2) - (priorityOrder[typeB.priority] || 2)
  })

  // Process top N
  const toProcess = sorted.slice(0, maxReplies)
  let repliedCount = 0

  console.log(`\n2. Processing ${toProcess.length} mentions...`)

  for (const comment of toProcess) {
    const commentType = classifyComment(comment.text)
    console.log(`\n   [@${comment.authorUsername}] (${commentType.type})`)
    console.log(`   "${comment.text.substring(0, 60)}${comment.text.length > 60 ? '...' : ''}"`)

    // Generate reply
    const reply = await generateReply(comment)

    if (!reply) {
      console.log('   ❌ Failed to generate reply')
      continue
    }

    console.log(`   Reply (${reply.style}): "${reply.text.substring(0, 60)}..."`)

    if (dryRun) {
      console.log('   [DRY RUN] Would post reply')
      repliedIds.add(comment.id)
      continue
    }

    // Post reply
    const result = await postReply(reply.text, comment.id)

    if (result.success) {
      console.log(`   ✅ Posted! ID: ${result.tweetId}`)
      repliedIds.add(comment.id)
      repliedCount++

      // Log for learning
      logReply(comment, reply, result)

      // Wait between replies to avoid rate limits
      await new Promise(r => setTimeout(r, 30000)) // 30 seconds
    } else {
      console.log(`   ❌ Failed: ${result.error}`)
      logReply(comment, reply, result)
    }
  }

  // Save replied IDs
  saveRepliedIds(repliedIds)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Processed: ${toProcess.length}, Replied: ${repliedCount}`)

  return { processed: toProcess.length, replied: repliedCount }
}

/**
 * Get reply statistics for learning
 */
export function getReplyStats() {
  const log = loadRepliesLog()
  return {
    total: log.stats.total,
    byType: log.stats.byType,
    byStyle: log.stats.byStyle,
    recentReplies: log.replies.slice(-10)
  }
}

/**
 * Analyze reply performance (called by learning engine)
 */
export async function analyzeReplyPerformance() {
  const log = loadRepliesLog()
  const client = await getTwitterClient()

  // Get metrics for recent replies
  const recentReplies = log.replies.filter(r => r.success && r.id).slice(-50)

  const performance = {
    byType: {},
    byStyle: {},
    topReplies: []
  }

  for (const reply of recentReplies) {
    try {
      const tweet = await client.v2.singleTweet(reply.id, {
        'tweet.fields': ['public_metrics']
      })

      const metrics = tweet.data?.public_metrics || {}
      const engagement = (metrics.like_count || 0) + (metrics.reply_count || 0) * 2

      // Accumulate by type
      if (!performance.byType[reply.commentType]) {
        performance.byType[reply.commentType] = { total: 0, count: 0 }
      }
      performance.byType[reply.commentType].total += engagement
      performance.byType[reply.commentType].count++

      // Accumulate by style
      if (!performance.byStyle[reply.replyStyle]) {
        performance.byStyle[reply.replyStyle] = { total: 0, count: 0 }
      }
      performance.byStyle[reply.replyStyle].total += engagement
      performance.byStyle[reply.replyStyle].count++

      // Track top replies
      performance.topReplies.push({
        text: reply.replyText,
        type: reply.commentType,
        style: reply.replyStyle,
        engagement,
        metrics
      })

    } catch (err) {
      // Skip if can't fetch
    }
  }

  // Calculate averages
  for (const type of Object.keys(performance.byType)) {
    const data = performance.byType[type]
    data.avgEngagement = data.count > 0 ? data.total / data.count : 0
  }

  for (const style of Object.keys(performance.byStyle)) {
    const data = performance.byStyle[style]
    data.avgEngagement = data.count > 0 ? data.total / data.count : 0
  }

  // Sort top replies
  performance.topReplies.sort((a, b) => b.engagement - a.engagement)
  performance.topReplies = performance.topReplies.slice(0, 10)

  return performance
}

// If run directly
if (process.argv[1]?.includes('reply-monitor')) {
  const dryRun = process.argv.includes('--dry-run')
  processReplies(5, dryRun)
    .then(result => {
      console.log('\nResult:', result)
      process.exit(0)
    })
    .catch(err => {
      console.error('Error:', err)
      process.exit(1)
    })
}

export default {
  processReplies,
  getReplyStats,
  analyzeReplyPerformance,
  generateReply,
  classifyComment
}
