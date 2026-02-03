/**
 * Learning Engine for Bot-X-Posts
 *
 * Self-improving system that analyzes engagement and adjusts posting strategy.
 * Tracks HOOK_FRAMEWORKS, POST_STYLES, topics, hours, and languages.
 *
 * Exports: analyzePosts(), adjustWeights(), generateDailyReport()
 */

import { TwitterApi } from 'twitter-api-v2'
import fs from 'fs'
import path from 'path'

// ==================== CONFIGURATION ====================

const DATA_DIR = '/Users/user/AppsCalude/Bot-X-Posts/data'
const LEARNINGS_FILE = path.join(DATA_DIR, 'learnings.json')
const POSTS_LOG_FILE = path.join(DATA_DIR, 'posts-log.json')

// Decay factor for old data (recent posts matter more)
const DECAY_FACTOR = 0.95  // 5% decay per day
const MIN_POSTS_FOR_STATS = 5
const IMPRESSIONS_GOAL = 5_000_000  // 5M impressions goal

// Hook frameworks from claude-v2.js
const HOOK_FRAMEWORKS = [
  'extreme',
  'aida',
  'pas',
  'bab',
  'emotional',
  'results',
  'client',
  'idea'
]

// Post styles from claude-v2.js
const POST_STYLES = [
  'hot_take',
  'observation',
  'question',
  'reaction',
  'tip',
  'sarcasm',
  'personal',
  'contrarian'
]

// Topics
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']

// Languages
const LANGUAGES = ['en', 'pt-BR']

// Posting hours (8-20, every 2h)
const HOURS = [8, 10, 12, 14, 16, 18, 20]

// ==================== DATA STRUCTURES ====================

/**
 * Default learnings structure
 */
function getDefaultLearnings() {
  return {
    version: 2,
    lastUpdated: new Date().toISOString(),
    totalPostsAnalyzed: 0,
    totalImpressions: 0,

    // Performance scores (weighted averages)
    scores: {
      hooks: Object.fromEntries(HOOK_FRAMEWORKS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      styles: Object.fromEntries(POST_STYLES.map(s => [s, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      topics: Object.fromEntries(TOPICS.map(t => [t, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      hours: Object.fromEntries(HOURS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      languages: Object.fromEntries(LANGUAGES.map(l => [l, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }]))
    },

    // Best performing combinations
    topCombinations: [],

    // Selection weights (probability adjustments)
    weights: {
      hooks: Object.fromEntries(HOOK_FRAMEWORKS.map(h => [h, 1.0])),
      styles: Object.fromEntries(POST_STYLES.map(s => [s, 1.0])),
      topics: Object.fromEntries(TOPICS.map(t => [t, 1.0])),
      hours: Object.fromEntries(HOURS.map(h => [h, 1.0])),
      languages: Object.fromEntries(LANGUAGES.map(l => [l, 1.0]))
    },

    // Daily metrics history
    dailyHistory: [],

    // Recommendations
    recommendations: []
  }
}

/**
 * Default posts log structure
 */
function getDefaultPostsLog() {
  return {
    posts: []
  }
}

// ==================== FILE OPERATIONS ====================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadLearnings() {
  ensureDataDir()
  try {
    if (fs.existsSync(LEARNINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf-8'))
      // Merge with defaults to ensure all fields exist
      const defaults = getDefaultLearnings()
      return {
        ...defaults,
        ...data,
        scores: {
          hooks: { ...defaults.scores.hooks, ...data.scores?.hooks },
          styles: { ...defaults.scores.styles, ...data.scores?.styles },
          topics: { ...defaults.scores.topics, ...data.scores?.topics },
          hours: { ...defaults.scores.hours, ...data.scores?.hours },
          languages: { ...defaults.scores.languages, ...data.scores?.languages }
        },
        weights: {
          hooks: { ...defaults.weights.hooks, ...data.weights?.hooks },
          styles: { ...defaults.weights.styles, ...data.weights?.styles },
          topics: { ...defaults.weights.topics, ...data.weights?.topics },
          hours: { ...defaults.weights.hours, ...data.weights?.hours },
          languages: { ...defaults.weights.languages, ...data.weights?.languages }
        }
      }
    }
  } catch (err) {
    console.log(`   Warning: Could not load learnings: ${err.message}`)
  }
  return getDefaultLearnings()
}

function saveLearnings(learnings) {
  ensureDataDir()
  learnings.lastUpdated = new Date().toISOString()
  fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(learnings, null, 2))
}

function loadPostsLog() {
  ensureDataDir()
  try {
    if (fs.existsSync(POSTS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(POSTS_LOG_FILE, 'utf-8'))
    }
  } catch (err) {
    console.log(`   Warning: Could not load posts log: ${err.message}`)
  }
  return getDefaultPostsLog()
}

function savePostsLog(log) {
  ensureDataDir()
  fs.writeFileSync(POSTS_LOG_FILE, JSON.stringify(log, null, 2))
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
 * Fetch recent tweets with metrics from the account
 */
async function fetchTweetsWithMetrics(limit = 100) {
  try {
    const client = await getTwitterClient()
    const me = await client.v2.me()
    const userId = me.data.id

    const tweets = await client.v2.userTimeline(userId, {
      max_results: Math.min(limit, 100),
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
      exclude: ['retweets', 'replies']
    })

    if (!tweets.data?.data) {
      return []
    }

    return tweets.data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at,
      metrics: {
        likes: tweet.public_metrics?.like_count || 0,
        retweets: tweet.public_metrics?.retweet_count || 0,
        replies: tweet.public_metrics?.reply_count || 0,
        impressions: tweet.public_metrics?.impression_count || 0,
        quotes: tweet.public_metrics?.quote_count || 0,
        bookmarks: tweet.public_metrics?.bookmark_count || 0
      }
    }))
  } catch (err) {
    console.log(`   Error fetching tweets: ${err.message}`)
    return []
  }
}

// ==================== ANALYSIS ====================

/**
 * Calculate engagement score from metrics
 * Weighted: replies > retweets > bookmarks > likes
 */
function calculateEngagementScore(metrics) {
  return (
    (metrics.likes || 0) * 1 +
    (metrics.retweets || 0) * 3 +
    (metrics.replies || 0) * 5 +
    (metrics.quotes || 0) * 4 +
    (metrics.bookmarks || 0) * 2
  )
}

/**
 * Calculate engagement rate (engagement / impressions)
 */
function calculateEngagementRate(metrics) {
  const impressions = metrics.impressions || 1
  const engagement = calculateEngagementScore(metrics)
  return (engagement / impressions) * 100
}

/**
 * Detect hook framework from post text
 */
function detectHook(text) {
  const lower = text.toLowerCase()

  // Extreme indicators
  if (/^(worst|best|most|the most|o pior|o melhor|a pior|a melhor)/i.test(lower)) {
    return 'extreme'
  }

  // PAS (Problem-Agitate-Solution)
  if (/(sick of|tired of|cansado de|problema:|the problem)/i.test(lower)) {
    return 'pas'
  }

  // BAB (Before-After-Bridge)
  if (/(used to|antes eu|i was|era)/i.test(lower) && /(now|agora|hoje)/i.test(lower)) {
    return 'bab'
  }

  // Emotional
  if (/(rage|frustrat|pain|dor|raiva|almost quit|quase larguei|pqp|carai|wtf|lmao)/i.test(lower)) {
    return 'emotional'
  }

  // Results
  if (/(shipped|built|made|achieved|earned|turned|consegui|fiz|ganhei|entreguei)/i.test(lower) && /\d/.test(lower)) {
    return 'results'
  }

  // Client/Third-party
  if (/(friend|colleague|junior|amigo|colega)/i.test(lower)) {
    return 'client'
  }

  // AIDA
  if (/(most|maioria|everyone|todo mundo|ngm|nobody)/i.test(lower) && /(then|depois|dai|try|testa)/i.test(lower)) {
    return 'aida'
  }

  // Idea (short powerful statement)
  if (text.length < 120 && !text.includes('?')) {
    return 'idea'
  }

  return 'unknown'
}

/**
 * Detect post style from text
 */
function detectStyle(text) {
  const lower = text.toLowerCase()

  // Hot take
  if (/(hot take|unpopular|opiniao impopular|controversial)/i.test(lower)) {
    return 'hot_take'
  }

  // Question
  if (text.includes('?') && (/(anyone|alguem|somebody|who else|quem mais)/i.test(lower))) {
    return 'question'
  }

  // Reaction
  if (/(lmao|lol|kkk|kk|carai|pqp|wait what|wtf|wild|insane)/i.test(lower)) {
    return 'reaction'
  }

  // Tip
  if (/(tip|dica|protip|pro tip|shortcut|atalho|cmd\+|ctrl\+)/i.test(lower)) {
    return 'tip'
  }

  // Sarcasm
  if (/(surely|obviously|clearly|obviously|com certeza|obvio|irony|sarcast)/i.test(lower)) {
    return 'sarcasm'
  }

  // Personal
  if (/(im |i'm |i am |eu to |to |tou |minha |my |mine)/i.test(lower)) {
    return 'personal'
  }

  // Contrarian
  if (/(but actually|actually|na verdade|mas|however|contrary|opposite)/i.test(lower)) {
    return 'contrarian'
  }

  // Observation
  if (/(noticed|realized|just found|descobri|percebi|notei)/i.test(lower)) {
    return 'observation'
  }

  return 'unknown'
}

/**
 * Detect topic from text
 */
function detectTopic(text) {
  const lower = text.toLowerCase()

  if (/(bitcoin|btc|eth|crypto|#btc|#crypto|#bitcoin|#ethereum|defi|nft)/i.test(lower)) {
    return 'crypto'
  }

  if (/(stock|invest|market|sp500|nasdaq|earnings|portfolio|#stocks|#investing|\$[A-Z]{2,5})/i.test(lower)) {
    return 'investing'
  }

  if (/(cursor|claude code|copilot|vibe coding|vibecoding|#cursor|#claudecode|#vibecoding|ai coding)/i.test(lower)) {
    return 'vibeCoding'
  }

  if (/(ai |#ai|llm|gpt|claude|machine learning|#llm|anthropic|openai|model)/i.test(lower)) {
    return 'ai'
  }

  return 'unknown'
}

/**
 * Detect language from text
 */
function detectLanguage(text) {
  // Portuguese indicators
  const ptIndicators = [
    /\b(que|nao|pra|com|uma|isso|esse|essa|voce|meu|minha|dele|dela|muito|tambem|quando|onde|como|porque|mas|mais|menos|entre|sobre|para|pela|pelo|aos|nas|nos|seu|sua)\b/i,
    /[çãõáéíóúâêô]/i,
    /(kkk|pqp|carai|mano|vei|tlgd)/i
  ]

  for (const pattern of ptIndicators) {
    if (pattern.test(text)) {
      return 'pt-BR'
    }
  }

  return 'en'
}

/**
 * Extract hour from timestamp
 */
function extractHour(timestamp) {
  const date = new Date(timestamp)
  return date.getHours()
}

// ==================== MAIN ANALYSIS FUNCTION ====================

/**
 * Analyze posts and update learnings
 * @returns {Object} Analysis results
 */
export async function analyzePosts() {
  console.log('   Analyzing posts...')

  const learnings = loadLearnings()
  const postsLog = loadPostsLog()

  // Fetch recent tweets with metrics
  const tweets = await fetchTweetsWithMetrics(100)

  if (tweets.length === 0) {
    console.log('   No tweets found to analyze')
    return { success: false, message: 'No tweets found' }
  }

  console.log(`   Found ${tweets.length} tweets to analyze`)

  // Process each tweet
  const analysis = {
    byHook: {},
    byStyle: {},
    byTopic: {},
    byHour: {},
    byLanguage: {},
    combinations: []
  }

  let totalImpressions = 0
  let totalEngagement = 0

  for (const tweet of tweets) {
    const engagement = calculateEngagementScore(tweet.metrics)
    const engagementRate = calculateEngagementRate(tweet.metrics)
    const impressions = tweet.metrics.impressions || 0

    totalImpressions += impressions
    totalEngagement += engagement

    // Detect attributes
    const hook = detectHook(tweet.text)
    const style = detectStyle(tweet.text)
    const topic = detectTopic(tweet.text)
    const language = detectLanguage(tweet.text)
    const hour = extractHour(tweet.createdAt)
    const roundedHour = Math.round(hour / 2) * 2  // Round to nearest posting hour

    // Accumulate by hook
    if (hook !== 'unknown') {
      if (!analysis.byHook[hook]) {
        analysis.byHook[hook] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byHook[hook].totalEngagement += engagement
      analysis.byHook[hook].totalImpressions += impressions
      analysis.byHook[hook].count++
      analysis.byHook[hook].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by style
    if (style !== 'unknown') {
      if (!analysis.byStyle[style]) {
        analysis.byStyle[style] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byStyle[style].totalEngagement += engagement
      analysis.byStyle[style].totalImpressions += impressions
      analysis.byStyle[style].count++
      analysis.byStyle[style].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by topic
    if (topic !== 'unknown') {
      if (!analysis.byTopic[topic]) {
        analysis.byTopic[topic] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byTopic[topic].totalEngagement += engagement
      analysis.byTopic[topic].totalImpressions += impressions
      analysis.byTopic[topic].count++
      analysis.byTopic[topic].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by hour
    if (HOURS.includes(roundedHour)) {
      if (!analysis.byHour[roundedHour]) {
        analysis.byHour[roundedHour] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byHour[roundedHour].totalEngagement += engagement
      analysis.byHour[roundedHour].totalImpressions += impressions
      analysis.byHour[roundedHour].count++
      analysis.byHour[roundedHour].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by language
    if (!analysis.byLanguage[language]) {
      analysis.byLanguage[language] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
    }
    analysis.byLanguage[language].totalEngagement += engagement
    analysis.byLanguage[language].totalImpressions += impressions
    analysis.byLanguage[language].count++
    analysis.byLanguage[language].posts.push({ text: tweet.text, engagement, impressions })

    // Track combinations
    if (hook !== 'unknown' && style !== 'unknown' && topic !== 'unknown') {
      analysis.combinations.push({
        hook,
        style,
        topic,
        language,
        hour: roundedHour,
        engagement,
        impressions,
        engagementRate,
        text: tweet.text.substring(0, 100)
      })
    }

    // Log the post for history
    const existingPost = postsLog.posts.find(p => p.id === tweet.id)
    if (!existingPost) {
      postsLog.posts.push({
        id: tweet.id,
        text: tweet.text,
        createdAt: tweet.createdAt,
        hook,
        style,
        topic,
        language,
        hour: roundedHour,
        metrics: tweet.metrics,
        engagement,
        engagementRate,
        analyzedAt: new Date().toISOString()
      })
    } else {
      // Update metrics
      existingPost.metrics = tweet.metrics
      existingPost.engagement = engagement
      existingPost.engagementRate = engagementRate
      existingPost.lastUpdated = new Date().toISOString()
    }
  }

  // Update learnings scores
  updateScores(learnings, analysis)

  // Update totals
  learnings.totalPostsAnalyzed = postsLog.posts.length
  learnings.totalImpressions = totalImpressions

  // Find top combinations
  const sortedCombinations = analysis.combinations.sort((a, b) => b.engagementRate - a.engagementRate)
  learnings.topCombinations = sortedCombinations.slice(0, 10).map(c => ({
    hook: c.hook,
    style: c.style,
    topic: c.topic,
    language: c.language,
    hour: c.hour,
    avgEngagementRate: c.engagementRate,
    sample: c.text
  }))

  // Save
  saveLearnings(learnings)
  savePostsLog(postsLog)

  console.log(`   Analysis complete: ${tweets.length} tweets processed`)

  return {
    success: true,
    tweetsAnalyzed: tweets.length,
    totalImpressions,
    totalEngagement,
    topHook: findTopByScore(learnings.scores.hooks),
    topStyle: findTopByScore(learnings.scores.styles),
    topTopic: findTopByScore(learnings.scores.topics),
    topHour: findTopByScore(learnings.scores.hours),
    topLanguage: findTopByScore(learnings.scores.languages)
  }
}

/**
 * Update scores based on analysis
 */
function updateScores(learnings, analysis) {
  // Calculate global average for normalization
  let globalAvgEngagement = 0
  let globalAvgImpressions = 0
  let totalCount = 0

  for (const data of Object.values(analysis.byTopic)) {
    globalAvgEngagement += data.totalEngagement
    globalAvgImpressions += data.totalImpressions
    totalCount += data.count
  }

  if (totalCount > 0) {
    globalAvgEngagement /= totalCount
    globalAvgImpressions /= totalCount
  } else {
    globalAvgEngagement = 1
    globalAvgImpressions = 1
  }

  // Update hook scores
  for (const [hook, data] of Object.entries(analysis.byHook)) {
    if (learnings.scores.hooks[hook] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      // Weighted average with existing score
      const existingWeight = learnings.scores.hooks[hook].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.hooks[hook].score = (
        (learnings.scores.hooks[hook].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.hooks[hook].count += data.count
      learnings.scores.hooks[hook].avgEngagement = avgEngagement
      learnings.scores.hooks[hook].avgImpressions = avgImpressions
    }
  }

  // Update style scores
  for (const [style, data] of Object.entries(analysis.byStyle)) {
    if (learnings.scores.styles[style] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.styles[style].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.styles[style].score = (
        (learnings.scores.styles[style].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.styles[style].count += data.count
      learnings.scores.styles[style].avgEngagement = avgEngagement
      learnings.scores.styles[style].avgImpressions = avgImpressions
    }
  }

  // Update topic scores
  for (const [topic, data] of Object.entries(analysis.byTopic)) {
    if (learnings.scores.topics[topic] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.topics[topic].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.topics[topic].score = (
        (learnings.scores.topics[topic].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.topics[topic].count += data.count
      learnings.scores.topics[topic].avgEngagement = avgEngagement
      learnings.scores.topics[topic].avgImpressions = avgImpressions
    }
  }

  // Update hour scores
  for (const [hour, data] of Object.entries(analysis.byHour)) {
    const hourKey = parseInt(hour)
    if (learnings.scores.hours[hourKey] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.hours[hourKey].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.hours[hourKey].score = (
        (learnings.scores.hours[hourKey].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.hours[hourKey].count += data.count
      learnings.scores.hours[hourKey].avgEngagement = avgEngagement
      learnings.scores.hours[hourKey].avgImpressions = avgImpressions
    }
  }

  // Update language scores
  for (const [lang, data] of Object.entries(analysis.byLanguage)) {
    if (learnings.scores.languages[lang] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.languages[lang].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.languages[lang].score = (
        (learnings.scores.languages[lang].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.languages[lang].count += data.count
      learnings.scores.languages[lang].avgEngagement = avgEngagement
      learnings.scores.languages[lang].avgImpressions = avgImpressions
    }
  }
}

/**
 * Find top performer by score
 */
function findTopByScore(scoreMap) {
  let topKey = null
  let topScore = -1

  for (const [key, data] of Object.entries(scoreMap)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score > topScore) {
      topScore = data.score
      topKey = key
    }
  }

  return topKey ? { key: topKey, score: topScore } : null
}

// ==================== WEIGHT ADJUSTMENT ====================

/**
 * Adjust selection weights based on performance scores
 * Higher scoring options get higher weights (probability of selection)
 * @returns {Object} Updated weights
 */
export function adjustWeights() {
  console.log('   Adjusting weights based on performance...')

  const learnings = loadLearnings()
  const recommendations = []

  // Normalize scores to weights (1.0 = average, >1 = better, <1 = worse)
  // Use softmax-like approach to avoid extreme weights

  const adjustCategory = (category, categoryName) => {
    const scores = Object.entries(category).filter(([_, data]) => data.count >= MIN_POSTS_FOR_STATS)

    if (scores.length === 0) {
      console.log(`   Not enough data for ${categoryName}, keeping default weights`)
      return
    }

    // Calculate mean and std
    const scoreValues = scores.map(([_, data]) => data.score)
    const mean = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
    const std = Math.sqrt(scoreValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scoreValues.length) || 1

    // Convert to weights using z-score
    for (const [key, data] of scores) {
      const zScore = (data.score - mean) / std
      // Sigmoid-like transformation: 0.5 to 2.0 range
      const weight = 0.5 + 1.5 / (1 + Math.exp(-zScore))
      learnings.weights[categoryName][key] = Math.round(weight * 100) / 100

      // Track significant changes
      if (weight > 1.3) {
        recommendations.push(`Boost ${categoryName}:${key} (score: ${Math.round(data.score)}, weight: ${weight.toFixed(2)})`)
      } else if (weight < 0.7) {
        recommendations.push(`Reduce ${categoryName}:${key} (score: ${Math.round(data.score)}, weight: ${weight.toFixed(2)})`)
      }
    }

    // Reset weights for items without enough data
    for (const key of Object.keys(learnings.weights[categoryName])) {
      if (!scores.find(([k]) => k === key)) {
        learnings.weights[categoryName][key] = 1.0
      }
    }
  }

  adjustCategory(learnings.scores.hooks, 'hooks')
  adjustCategory(learnings.scores.styles, 'styles')
  adjustCategory(learnings.scores.topics, 'topics')
  adjustCategory(learnings.scores.hours, 'hours')
  adjustCategory(learnings.scores.languages, 'languages')

  learnings.recommendations = recommendations
  saveLearnings(learnings)

  console.log(`   Weights adjusted. ${recommendations.length} recommendations generated.`)

  return {
    success: true,
    weights: learnings.weights,
    recommendations
  }
}

// ==================== WEIGHTED SELECTION ====================

/**
 * Select from options using learned weights
 * @param {string[]} options - Array of options to choose from
 * @param {string} category - Category name (hooks, styles, topics, hours, languages)
 * @returns {string} Selected option
 */
export function weightedSelect(options, category) {
  const learnings = loadLearnings()
  const weights = learnings.weights[category] || {}

  // Build weighted array
  const weightedOptions = options.map(opt => ({
    option: opt,
    weight: weights[opt] || 1.0
  }))

  const totalWeight = weightedOptions.reduce((sum, o) => sum + o.weight, 0)

  // Random selection based on weight
  let random = Math.random() * totalWeight
  for (const { option, weight } of weightedOptions) {
    random -= weight
    if (random <= 0) {
      return option
    }
  }

  // Fallback to last option
  return options[options.length - 1]
}

/**
 * Get top N options by weight
 * @param {string} category - Category name
 * @param {number} n - Number of top options to return
 * @returns {string[]} Top options
 */
export function getTopWeighted(category, n = 3) {
  const learnings = loadLearnings()
  const weights = learnings.weights[category] || {}

  const sorted = Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key]) => key)

  return sorted
}

// ==================== DAILY REPORT ====================

/**
 * Generate daily performance report
 * @returns {Object} Report data
 */
export async function generateDailyReport() {
  console.log('   Generating daily report...')

  const learnings = loadLearnings()
  const postsLog = loadPostsLog()

  // Get today's posts
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const todaysPosts = postsLog.posts.filter(p => {
    const postDate = new Date(p.createdAt)
    return postDate >= today && postDate < tomorrow
  })

  // Get yesterday's posts for comparison
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const yesterdaysPosts = postsLog.posts.filter(p => {
    const postDate = new Date(p.createdAt)
    return postDate >= yesterday && postDate < today
  })

  // Calculate today's metrics
  const todayMetrics = {
    posts: todaysPosts.length,
    impressions: todaysPosts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0),
    engagement: todaysPosts.reduce((sum, p) => sum + (p.engagement || 0), 0),
    likes: todaysPosts.reduce((sum, p) => sum + (p.metrics?.likes || 0), 0),
    retweets: todaysPosts.reduce((sum, p) => sum + (p.metrics?.retweets || 0), 0),
    replies: todaysPosts.reduce((sum, p) => sum + (p.metrics?.replies || 0), 0),
    avgEngagementRate: todaysPosts.length > 0
      ? todaysPosts.reduce((sum, p) => sum + (p.engagementRate || 0), 0) / todaysPosts.length
      : 0
  }

  // Calculate yesterday's metrics
  const yesterdayMetrics = {
    posts: yesterdaysPosts.length,
    impressions: yesterdaysPosts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0),
    engagement: yesterdaysPosts.reduce((sum, p) => sum + (p.engagement || 0), 0),
    avgEngagementRate: yesterdaysPosts.length > 0
      ? yesterdaysPosts.reduce((sum, p) => sum + (p.engagementRate || 0), 0) / yesterdaysPosts.length
      : 0
  }

  // Calculate changes
  const changes = {
    impressions: yesterdayMetrics.impressions > 0
      ? ((todayMetrics.impressions - yesterdayMetrics.impressions) / yesterdayMetrics.impressions * 100)
      : 0,
    engagement: yesterdayMetrics.engagement > 0
      ? ((todayMetrics.engagement - yesterdayMetrics.engagement) / yesterdayMetrics.engagement * 100)
      : 0,
    engagementRate: yesterdayMetrics.avgEngagementRate > 0
      ? ((todayMetrics.avgEngagementRate - yesterdayMetrics.avgEngagementRate) / yesterdayMetrics.avgEngagementRate * 100)
      : 0
  }

  // Top 3 posts today
  const top3Posts = [...todaysPosts]
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, 3)
    .map(p => ({
      text: p.text.substring(0, 100) + (p.text.length > 100 ? '...' : ''),
      engagement: p.engagement,
      impressions: p.metrics?.impressions || 0,
      hook: p.hook,
      style: p.style,
      topic: p.topic,
      language: p.language
    }))

  // Best performers by category
  const bestPerformers = {
    hook: findTopByScore(learnings.scores.hooks),
    style: findTopByScore(learnings.scores.styles),
    topic: findTopByScore(learnings.scores.topics),
    hour: findTopByScore(learnings.scores.hours),
    language: findTopByScore(learnings.scores.languages)
  }

  // Projection to 5M impressions goal
  const totalImpressions = postsLog.posts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0)
  const daysWithData = Math.max(1, Math.ceil((Date.now() - new Date(postsLog.posts[0]?.createdAt || Date.now()).getTime()) / (24 * 60 * 60 * 1000)))
  const avgDailyImpressions = totalImpressions / daysWithData
  const daysToGoal = avgDailyImpressions > 0 ? Math.ceil((IMPRESSIONS_GOAL - totalImpressions) / avgDailyImpressions) : Infinity
  const progressPercent = (totalImpressions / IMPRESSIONS_GOAL) * 100

  // Generate recommendations
  const recommendations = []

  if (bestPerformers.hook) {
    recommendations.push(`Use more "${bestPerformers.hook.key}" hook (score: ${Math.round(bestPerformers.hook.score)})`)
  }
  if (bestPerformers.style) {
    recommendations.push(`Prioritize "${bestPerformers.style.key}" style posts (score: ${Math.round(bestPerformers.style.score)})`)
  }
  if (bestPerformers.topic) {
    recommendations.push(`Focus on "${bestPerformers.topic.key}" topic (score: ${Math.round(bestPerformers.topic.score)})`)
  }
  if (bestPerformers.hour) {
    recommendations.push(`Best posting hour: ${bestPerformers.hour.key}h (score: ${Math.round(bestPerformers.hour.score)})`)
  }
  if (bestPerformers.language) {
    recommendations.push(`Top language: ${bestPerformers.language.key} (score: ${Math.round(bestPerformers.language.score)})`)
  }

  // Add low performers to avoid
  for (const [key, data] of Object.entries(learnings.scores.hooks)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score < 40) {
      recommendations.push(`Avoid "${key}" hook (underperforming, score: ${Math.round(data.score)})`)
    }
  }

  const report = {
    date: today.toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),

    todayMetrics,
    yesterdayMetrics,
    changes,

    top3Posts,
    bestPerformers,

    goal: {
      target: IMPRESSIONS_GOAL,
      current: totalImpressions,
      progressPercent: Math.round(progressPercent * 100) / 100,
      avgDailyImpressions: Math.round(avgDailyImpressions),
      daysToGoal: daysToGoal === Infinity ? 'N/A' : daysToGoal,
      projectedDate: daysToGoal !== Infinity
        ? new Date(Date.now() + daysToGoal * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : 'N/A'
    },

    recommendations,

    weights: learnings.weights,

    topCombinations: learnings.topCombinations.slice(0, 5)
  }

  // Save to daily history
  learnings.dailyHistory.push({
    date: report.date,
    metrics: todayMetrics,
    progressPercent: report.goal.progressPercent
  })

  // Keep only last 30 days
  if (learnings.dailyHistory.length > 30) {
    learnings.dailyHistory = learnings.dailyHistory.slice(-30)
  }

  saveLearnings(learnings)

  console.log('   Daily report generated')

  return report
}

/**
 * Format report for Telegram
 */
export function formatReportForTelegram(report) {
  const changeIcon = (val) => val > 0 ? '+' : val < 0 ? '' : ''
  const changeEmoji = (val) => val > 5 ? '📈' : val < -5 ? '📉' : '➡️'

  let msg = `📊 <b>Daily Report - ${report.date}</b>\n\n`

  // Today's metrics
  msg += `<b>Today's Metrics:</b>\n`
  msg += `  Posts: ${report.todayMetrics.posts}\n`
  msg += `  Impressions: ${report.todayMetrics.impressions.toLocaleString()}\n`
  msg += `  Engagement: ${report.todayMetrics.engagement}\n`
  msg += `  Avg ER: ${report.todayMetrics.avgEngagementRate.toFixed(2)}%\n\n`

  // Comparison
  msg += `<b>vs Yesterday:</b>\n`
  msg += `  ${changeEmoji(report.changes.impressions)} Impressions: ${changeIcon(report.changes.impressions)}${Math.round(report.changes.impressions)}%\n`
  msg += `  ${changeEmoji(report.changes.engagement)} Engagement: ${changeIcon(report.changes.engagement)}${Math.round(report.changes.engagement)}%\n`
  msg += `  ${changeEmoji(report.changes.engagementRate)} ER: ${changeIcon(report.changes.engagementRate)}${Math.round(report.changes.engagementRate)}%\n\n`

  // Top posts
  if (report.top3Posts.length > 0) {
    msg += `<b>Top 3 Posts:</b>\n`
    for (let i = 0; i < report.top3Posts.length; i++) {
      const p = report.top3Posts[i]
      msg += `${i + 1}. [${p.engagement}eng] "${p.text.substring(0, 50)}..."\n`
    }
    msg += `\n`
  }

  // Goal progress
  msg += `<b>5M Goal Progress:</b>\n`
  msg += `  ${report.goal.progressPercent.toFixed(2)}% (${(report.goal.current / 1000000).toFixed(2)}M / 5M)\n`
  msg += `  Avg/day: ${report.goal.avgDailyImpressions.toLocaleString()}\n`
  msg += `  ETA: ${report.goal.projectedDate}\n\n`

  // Recommendations
  if (report.recommendations.length > 0) {
    msg += `<b>Recommendations:</b>\n`
    for (const rec of report.recommendations.slice(0, 5)) {
      msg += `  • ${rec}\n`
    }
  }

  return msg
}

// ==================== EXPORTS ====================

export default {
  analyzePosts,
  adjustWeights,
  generateDailyReport,
  formatReportForTelegram,
  weightedSelect,
  getTopWeighted,
  loadLearnings,
  saveLearnings
}
