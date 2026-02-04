/**
 * Learning Engine for Bot-X-Posts
 *
 * Self-improving system that analyzes engagement and adjusts posting strategy.
 * Tracks HOOK_FRAMEWORKS, POST_STYLES, topics, hours, languages, and experiments.
 *
 * Exports: analyzePosts(), adjustWeights(), generateDailyReport(), getTopPerformers(),
 *          generateInsights(), getDailyComparison()
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

// Language experiments from claude-v2.js (NEW A/B testing system)
// EN experiments
const EXPERIMENTS_EN = [
  'ultra_short',       // Max 100 chars, punchy
  'question_first',    // Start with a hook question
  'numbers_lead',      // Lead with specific number/stat
  'contrarian_shock',  // Start with something that sounds wrong but is true
  'meme_speak'         // Use meme language (fr fr, no cap, lowkey)
]

// PT-BR experiments
const EXPERIMENTS_PT_BR = [
  'ultra_curto',        // Max 100 chars
  'pergunta_primeiro',  // Start with question
  'numero_na_frente',   // Lead with number
  'contra_senso',       // Contrarian opener
  'girias'              // Use slang naturally
]

// Combined for scoring (all unique experiment names)
const ALL_EXPERIMENTS = [...new Set([...EXPERIMENTS_EN, ...EXPERIMENTS_PT_BR])]

// Timezone offsets from UTC
const TIMEZONE_BRAZIL = -3  // BRT (Sao Paulo)
const TIMEZONE_USA_EST = -5  // EST (New York)

// ==================== DATA STRUCTURES ====================

/**
 * Default learnings structure
 */
function getDefaultLearnings() {
  return {
    version: 4,  // Bumped for new experiments
    lastUpdated: new Date().toISOString(),
    totalPostsAnalyzed: 0,
    totalImpressions: 0,

    // Performance scores (weighted averages)
    scores: {
      hooks: Object.fromEntries(HOOK_FRAMEWORKS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      styles: Object.fromEntries(POST_STYLES.map(s => [s, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      topics: Object.fromEntries(TOPICS.map(t => [t, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      hours: Object.fromEntries(HOURS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      languages: Object.fromEntries(LANGUAGES.map(l => [l, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      experiments: Object.fromEntries(ALL_EXPERIMENTS.map(e => [e, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      hoursBrazil: Object.fromEntries(HOURS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }])),
      hoursUSA: Object.fromEntries(HOURS.map(h => [h, { score: 50, count: 0, avgEngagement: 0, avgImpressions: 0 }]))
    },

    // Best performing combinations
    topCombinations: [],

    // Selection weights (probability adjustments)
    weights: {
      hooks: Object.fromEntries(HOOK_FRAMEWORKS.map(h => [h, 1.0])),
      styles: Object.fromEntries(POST_STYLES.map(s => [s, 1.0])),
      topics: Object.fromEntries(TOPICS.map(t => [t, 1.0])),
      hours: Object.fromEntries(HOURS.map(h => [h, 1.0])),
      languages: Object.fromEntries(LANGUAGES.map(l => [l, 1.0])),
      experiments: Object.fromEntries(ALL_EXPERIMENTS.map(e => [e, 1.0]))
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
          languages: { ...defaults.scores.languages, ...data.scores?.languages },
          experiments: { ...defaults.scores.experiments, ...data.scores?.experiments },
          hoursBrazil: { ...defaults.scores.hoursBrazil, ...data.scores?.hoursBrazil },
          hoursUSA: { ...defaults.scores.hoursUSA, ...data.scores?.hoursUSA }
        },
        weights: {
          hooks: { ...defaults.weights.hooks, ...data.weights?.hooks },
          styles: { ...defaults.weights.styles, ...data.weights?.styles },
          topics: { ...defaults.weights.topics, ...data.weights?.topics },
          hours: { ...defaults.weights.hours, ...data.weights?.hours },
          languages: { ...defaults.weights.languages, ...data.weights?.languages },
          experiments: { ...defaults.weights.experiments, ...data.weights?.experiments }
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
 * Detect language experiment from post text and language
 * Matches the experiments defined in claude-v2.js LANGUAGE_EXPERIMENTS
 */
function detectExperiment(text, language = null) {
  const lower = text.toLowerCase()
  const len = text.length
  const lang = language || detectLanguage(text)

  // Ultra short / ultra_curto (under 100 chars)
  if (len <= 100) {
    return lang === 'pt-BR' ? 'ultra_curto' : 'ultra_short'
  }

  // Question first / pergunta_primeiro (starts with question word)
  if (/^(why|what|how|when|where|who|pq|por que|qual|como|quando|onde|quem)/i.test(lower)) {
    return lang === 'pt-BR' ? 'pergunta_primeiro' : 'question_first'
  }

  // Numbers lead / numero_na_frente (starts with number or stat)
  if (/^(\d|[$%]|\$?\d)/i.test(text) || /^\d+[\s%]/.test(text)) {
    return lang === 'pt-BR' ? 'numero_na_frente' : 'numbers_lead'
  }

  // Meme speak / girias (language-specific slang)
  if (lang === 'en' && /(fr fr|no cap|lowkey|highkey|its giving|bussin|goated|ngl|tbh|idk)/i.test(lower)) {
    return 'meme_speak'
  }
  if (lang === 'pt-BR' && /(mano|real|bora|sinistro|da hora|firmeza|suave|mermo|vei|tlgd)/i.test(lower)) {
    return 'girias'
  }

  // Contrarian shock / contra_senso (starts with something that sounds wrong)
  // Detect by negative/contrarian opener
  const first50 = lower.substring(0, 50)
  if (/(actually|wrong|not|dont|shouldnt|never|nao|errado|nunca|contrary|opposite|unpopular)/i.test(first50)) {
    return lang === 'pt-BR' ? 'contra_senso' : 'contrarian_shock'
  }

  return null  // No experiment detected (normal post)
}

/**
 * Extract hour from timestamp
 */
function extractHour(timestamp) {
  const date = new Date(timestamp)
  return date.getHours()
}

/**
 * Convert UTC hour to timezone-adjusted hour
 * @param {Date} timestamp - UTC timestamp
 * @param {number} tzOffset - Timezone offset in hours (e.g., -3 for Brazil)
 * @returns {number} Hour in the target timezone (0-23)
 */
function convertToTimezone(timestamp, tzOffset) {
  const date = new Date(timestamp)
  const utcHour = date.getUTCHours()
  let tzHour = utcHour + tzOffset

  // Handle day wraparound
  if (tzHour < 0) tzHour += 24
  if (tzHour >= 24) tzHour -= 24

  return tzHour
}

/**
 * Round hour to nearest posting hour
 */
function roundToPostingHour(hour) {
  const roundedHour = Math.round(hour / 2) * 2
  // Clamp to valid posting hours
  if (roundedHour < 8) return 8
  if (roundedHour > 20) return 20
  return roundedHour
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
    byExperiment: {},
    byHourBrazil: {},
    byHourUSA: {},
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
    const experiment = detectExperiment(tweet.text, language)
    const hour = extractHour(tweet.createdAt)
    const roundedHour = roundToPostingHour(hour)

    // Timezone-adjusted hours
    const hourBrazil = convertToTimezone(tweet.createdAt, TIMEZONE_BRAZIL)
    const hourUSA = convertToTimezone(tweet.createdAt, TIMEZONE_USA_EST)
    const roundedHourBrazil = roundToPostingHour(hourBrazil)
    const roundedHourUSA = roundToPostingHour(hourUSA)

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

    // Accumulate by hour (local/server time)
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

    // Accumulate by experiment (if detected)
    if (experiment) {
      if (!analysis.byExperiment[experiment]) {
        analysis.byExperiment[experiment] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byExperiment[experiment].totalEngagement += engagement
      analysis.byExperiment[experiment].totalImpressions += impressions
      analysis.byExperiment[experiment].count++
      analysis.byExperiment[experiment].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by Brazil hour
    if (HOURS.includes(roundedHourBrazil)) {
      if (!analysis.byHourBrazil[roundedHourBrazil]) {
        analysis.byHourBrazil[roundedHourBrazil] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byHourBrazil[roundedHourBrazil].totalEngagement += engagement
      analysis.byHourBrazil[roundedHourBrazil].totalImpressions += impressions
      analysis.byHourBrazil[roundedHourBrazil].count++
      analysis.byHourBrazil[roundedHourBrazil].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Accumulate by USA hour
    if (HOURS.includes(roundedHourUSA)) {
      if (!analysis.byHourUSA[roundedHourUSA]) {
        analysis.byHourUSA[roundedHourUSA] = { totalEngagement: 0, totalImpressions: 0, count: 0, posts: [] }
      }
      analysis.byHourUSA[roundedHourUSA].totalEngagement += engagement
      analysis.byHourUSA[roundedHourUSA].totalImpressions += impressions
      analysis.byHourUSA[roundedHourUSA].count++
      analysis.byHourUSA[roundedHourUSA].posts.push({ text: tweet.text, engagement, impressions })
    }

    // Track combinations
    if (hook !== 'unknown' && style !== 'unknown' && topic !== 'unknown') {
      analysis.combinations.push({
        hook,
        style,
        topic,
        language,
        experiment,
        hour: roundedHour,
        hourBrazil: roundedHourBrazil,
        hourUSA: roundedHourUSA,
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
        experiment,
        hour: roundedHour,
        hourBrazil: roundedHourBrazil,
        hourUSA: roundedHourUSA,
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
      existingPost.experiment = experiment
      existingPost.hourBrazil = roundedHourBrazil
      existingPost.hourUSA = roundedHourUSA
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
    experiment: c.experiment,
    hour: c.hour,
    hourBrazil: c.hourBrazil,
    hourUSA: c.hourUSA,
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
    topLanguage: findTopByScore(learnings.scores.languages),
    topExperiment: findTopByScore(learnings.scores.experiments),
    topHourBrazil: findTopByScore(learnings.scores.hoursBrazil),
    topHourUSA: findTopByScore(learnings.scores.hoursUSA)
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

  // Helper function to update a category's scores
  const updateCategoryScores = (analysisData, scoresData) => {
    for (const [key, data] of Object.entries(analysisData)) {
      if (scoresData[key] && data.count >= 1) {
        const avgEngagement = data.totalEngagement / data.count
        const avgImpressions = data.totalImpressions / data.count
        const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

        // Weighted average with existing score
        const existingWeight = scoresData[key].count * DECAY_FACTOR
        const newWeight = data.count
        const totalWeight = existingWeight + newWeight

        scoresData[key].score = (
          (scoresData[key].score * existingWeight + relativeScore * newWeight) / totalWeight
        )
        scoresData[key].count += data.count
        scoresData[key].avgEngagement = avgEngagement
        scoresData[key].avgImpressions = avgImpressions
      }
    }
  }

  // Update all category scores
  updateCategoryScores(analysis.byHook, learnings.scores.hooks)
  updateCategoryScores(analysis.byStyle, learnings.scores.styles)
  updateCategoryScores(analysis.byTopic, learnings.scores.topics)
  updateCategoryScores(analysis.byLanguage, learnings.scores.languages)
  updateCategoryScores(analysis.byExperiment, learnings.scores.experiments)

  // Update hour scores (need parseInt for keys)
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

  // Update Brazil hours
  for (const [hour, data] of Object.entries(analysis.byHourBrazil)) {
    const hourKey = parseInt(hour)
    if (learnings.scores.hoursBrazil[hourKey] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.hoursBrazil[hourKey].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.hoursBrazil[hourKey].score = (
        (learnings.scores.hoursBrazil[hourKey].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.hoursBrazil[hourKey].count += data.count
      learnings.scores.hoursBrazil[hourKey].avgEngagement = avgEngagement
      learnings.scores.hoursBrazil[hourKey].avgImpressions = avgImpressions
    }
  }

  // Update USA hours
  for (const [hour, data] of Object.entries(analysis.byHourUSA)) {
    const hourKey = parseInt(hour)
    if (learnings.scores.hoursUSA[hourKey] && data.count >= 1) {
      const avgEngagement = data.totalEngagement / data.count
      const avgImpressions = data.totalImpressions / data.count
      const relativeScore = (avgEngagement / Math.max(globalAvgEngagement, 1)) * 50 + 50

      const existingWeight = learnings.scores.hoursUSA[hourKey].count * DECAY_FACTOR
      const newWeight = data.count
      const totalWeight = existingWeight + newWeight

      learnings.scores.hoursUSA[hourKey].score = (
        (learnings.scores.hoursUSA[hourKey].score * existingWeight + relativeScore * newWeight) / totalWeight
      )
      learnings.scores.hoursUSA[hourKey].count += data.count
      learnings.scores.hoursUSA[hourKey].avgEngagement = avgEngagement
      learnings.scores.hoursUSA[hourKey].avgImpressions = avgImpressions
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

/**
 * Find worst performer by score (for insights)
 */
function findWorstByScore(scoreMap) {
  let worstKey = null
  let worstScore = Infinity

  for (const [key, data] of Object.entries(scoreMap)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score < worstScore) {
      worstScore = data.score
      worstKey = key
    }
  }

  return worstKey ? { key: worstKey, score: worstScore } : null
}

// ==================== TOP PERFORMERS ====================

/**
 * Get top performers across all categories
 * @returns {Object} Top performers with scores and engagement
 */
export function getTopPerformers() {
  const learnings = loadLearnings()

  const getTopFromCategory = (category) => {
    let top = null
    let topScore = -1

    for (const [key, data] of Object.entries(category)) {
      if (data.count >= MIN_POSTS_FOR_STATS && data.score > topScore) {
        topScore = data.score
        top = {
          name: key,
          score: Math.round(data.score * 100) / 100,
          avgEngagement: Math.round(data.avgEngagement * 100) / 100
        }
      }
    }

    return top
  }

  const getWorstFromCategory = (category) => {
    let worst = null
    let worstScore = Infinity

    for (const [key, data] of Object.entries(category)) {
      if (data.count >= MIN_POSTS_FOR_STATS && data.score < worstScore) {
        worstScore = data.score
        worst = {
          name: key,
          score: Math.round(data.score * 100) / 100
        }
      }
    }

    return worst
  }

  const getTopHour = (category) => {
    let top = null
    let topScore = -1

    for (const [hour, data] of Object.entries(category)) {
      if (data.count >= MIN_POSTS_FOR_STATS && data.score > topScore) {
        topScore = data.score
        top = {
          hour: parseInt(hour),
          score: Math.round(data.score * 100) / 100,
          avgEngagement: Math.round(data.avgEngagement * 100) / 100
        }
      }
    }

    return top
  }

  return {
    topHook: getTopFromCategory(learnings.scores.hooks),
    topStyle: getTopFromCategory(learnings.scores.styles),
    topTopic: getTopFromCategory(learnings.scores.topics),
    topExperiment: getTopFromCategory(learnings.scores.experiments),
    topHourBrazil: getTopHour(learnings.scores.hoursBrazil),
    topHourUSA: getTopHour(learnings.scores.hoursUSA),
    worstHook: getWorstFromCategory(learnings.scores.hooks),
    worstStyle: getWorstFromCategory(learnings.scores.styles)
  }
}

// ==================== INSIGHTS GENERATION ====================

/**
 * Generate actionable insights based on learnings
 * @returns {string[]} Array of insight strings
 */
export function generateInsights() {
  const learnings = loadLearnings()
  const insights = []

  // Calculate global average engagement
  let totalEngagement = 0
  let totalCount = 0

  for (const data of Object.values(learnings.scores.hooks)) {
    if (data.count > 0) {
      totalEngagement += data.avgEngagement * data.count
      totalCount += data.count
    }
  }

  const globalAvgEngagement = totalCount > 0 ? totalEngagement / totalCount : 1

  // Hook insights
  for (const [hook, data] of Object.entries(learnings.scores.hooks)) {
    if (data.count >= MIN_POSTS_FOR_STATS) {
      const percentAbove = ((data.avgEngagement - globalAvgEngagement) / globalAvgEngagement) * 100

      if (percentAbove > 30) {
        insights.push(`Boost '${hook}' hook - ${Math.round(percentAbove)}% above average`)
      } else if (percentAbove < -30) {
        insights.push(`Reduce '${hook}' hook - underperforming by ${Math.abs(Math.round(percentAbove))}%`)
      }
    }
  }

  // Style insights
  for (const [style, data] of Object.entries(learnings.scores.styles)) {
    if (data.count >= MIN_POSTS_FOR_STATS) {
      const percentAbove = ((data.avgEngagement - globalAvgEngagement) / globalAvgEngagement) * 100

      if (percentAbove > 30) {
        insights.push(`Boost '${style}' style - ${Math.round(percentAbove)}% above average`)
      } else if (percentAbove < -30) {
        insights.push(`Reduce '${style}' style - underperforming`)
      }
    }
  }

  // Experiment insights
  for (const [exp, data] of Object.entries(learnings.scores.experiments)) {
    if (data.count >= MIN_POSTS_FOR_STATS) {
      const percentAbove = ((data.avgEngagement - globalAvgEngagement) / globalAvgEngagement) * 100

      if (percentAbove > 40) {
        insights.push(`'${exp}' experiment working well - ${Math.round(percentAbove)}% above average`)
      } else if (percentAbove < -40) {
        insights.push(`'${exp}' experiment underperforming - consider reducing`)
      }
    }
  }

  // Brazil hour insights
  let bestBrazilHour = null
  let bestBrazilScore = -1
  let bestBrazilMultiplier = 1

  for (const [hour, data] of Object.entries(learnings.scores.hoursBrazil)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score > bestBrazilScore) {
      bestBrazilScore = data.score
      bestBrazilHour = parseInt(hour)
      bestBrazilMultiplier = data.avgEngagement / Math.max(globalAvgEngagement, 1)
    }
  }

  if (bestBrazilHour !== null && bestBrazilMultiplier > 1.3) {
    insights.push(`Best time Brazil: ${bestBrazilHour}h (${bestBrazilMultiplier.toFixed(1)}x engagement)`)
  }

  // USA hour insights
  let bestUSAHour = null
  let bestUSAScore = -1
  let bestUSAMultiplier = 1

  for (const [hour, data] of Object.entries(learnings.scores.hoursUSA)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score > bestUSAScore) {
      bestUSAScore = data.score
      bestUSAHour = parseInt(hour)
      bestUSAMultiplier = data.avgEngagement / Math.max(globalAvgEngagement, 1)
    }
  }

  if (bestUSAHour !== null && bestUSAMultiplier > 1.3) {
    // Convert to AM/PM format for clarity
    const ampm = bestUSAHour >= 12 ? 'pm' : 'am'
    const displayHour = bestUSAHour > 12 ? bestUSAHour - 12 : (bestUSAHour === 0 ? 12 : bestUSAHour)
    insights.push(`Best time USA: ${displayHour}${ampm} EST (high impressions)`)
  }

  // Topic insights
  let bestTopic = null
  let bestTopicScore = -1

  for (const [topic, data] of Object.entries(learnings.scores.topics)) {
    if (data.count >= MIN_POSTS_FOR_STATS && data.score > bestTopicScore) {
      bestTopicScore = data.score
      bestTopic = topic
    }
  }

  if (bestTopic) {
    insights.push(`'${bestTopic}' topic performing best - prioritize this content`)
  }

  // Language insights
  const enData = learnings.scores.languages['en']
  const ptData = learnings.scores.languages['pt-BR']

  if (enData?.count >= MIN_POSTS_FOR_STATS && ptData?.count >= MIN_POSTS_FOR_STATS) {
    if (enData.avgEngagement > ptData.avgEngagement * 1.3) {
      insights.push(`English posts outperforming PT-BR by ${Math.round((enData.avgEngagement / ptData.avgEngagement - 1) * 100)}%`)
    } else if (ptData.avgEngagement > enData.avgEngagement * 1.3) {
      insights.push(`PT-BR posts outperforming English by ${Math.round((ptData.avgEngagement / enData.avgEngagement - 1) * 100)}%`)
    }
  }

  return insights
}

// ==================== DAILY COMPARISON ====================

/**
 * Compare two days of metrics
 * @param {Object} today - Today's metrics object
 * @param {Object} yesterday - Yesterday's metrics object
 * @returns {Object} Comparison results
 */
export function getDailyComparison(today, yesterday) {
  const safeDiv = (a, b) => b > 0 ? ((a - b) / b * 100) : (a > 0 ? 100 : 0)

  return {
    impressions: {
      today: today?.impressions || 0,
      yesterday: yesterday?.impressions || 0,
      change: safeDiv(today?.impressions || 0, yesterday?.impressions || 0),
      trend: (today?.impressions || 0) > (yesterday?.impressions || 0) ? 'up' :
             (today?.impressions || 0) < (yesterday?.impressions || 0) ? 'down' : 'flat'
    },
    engagement: {
      today: today?.engagement || 0,
      yesterday: yesterday?.engagement || 0,
      change: safeDiv(today?.engagement || 0, yesterday?.engagement || 0),
      trend: (today?.engagement || 0) > (yesterday?.engagement || 0) ? 'up' :
             (today?.engagement || 0) < (yesterday?.engagement || 0) ? 'down' : 'flat'
    },
    posts: {
      today: today?.posts || 0,
      yesterday: yesterday?.posts || 0,
      change: safeDiv(today?.posts || 0, yesterday?.posts || 0),
      trend: (today?.posts || 0) > (yesterday?.posts || 0) ? 'up' :
             (today?.posts || 0) < (yesterday?.posts || 0) ? 'down' : 'flat'
    },
    avgEngagementRate: {
      today: today?.avgEngagementRate || 0,
      yesterday: yesterday?.avgEngagementRate || 0,
      change: safeDiv(today?.avgEngagementRate || 0, yesterday?.avgEngagementRate || 0),
      trend: (today?.avgEngagementRate || 0) > (yesterday?.avgEngagementRate || 0) ? 'up' :
             (today?.avgEngagementRate || 0) < (yesterday?.avgEngagementRate || 0) ? 'down' : 'flat'
    },
    likes: {
      today: today?.likes || 0,
      yesterday: yesterday?.likes || 0,
      change: safeDiv(today?.likes || 0, yesterday?.likes || 0),
      trend: (today?.likes || 0) > (yesterday?.likes || 0) ? 'up' :
             (today?.likes || 0) < (yesterday?.likes || 0) ? 'down' : 'flat'
    },
    retweets: {
      today: today?.retweets || 0,
      yesterday: yesterday?.retweets || 0,
      change: safeDiv(today?.retweets || 0, yesterday?.retweets || 0),
      trend: (today?.retweets || 0) > (yesterday?.retweets || 0) ? 'up' :
             (today?.retweets || 0) < (yesterday?.retweets || 0) ? 'down' : 'flat'
    },
    replies: {
      today: today?.replies || 0,
      yesterday: yesterday?.replies || 0,
      change: safeDiv(today?.replies || 0, yesterday?.replies || 0),
      trend: (today?.replies || 0) > (yesterday?.replies || 0) ? 'up' :
             (today?.replies || 0) < (yesterday?.replies || 0) ? 'down' : 'flat'
    }
  }
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
  adjustCategory(learnings.scores.experiments, 'experiments')

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
 * @param {string} category - Category name (hooks, styles, topics, hours, languages, experiments)
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
      : 0,
    experimentsUsed: todaysPosts.filter(p => p.experiment).length
  }

  // Calculate yesterday's metrics
  const yesterdayMetrics = {
    posts: yesterdaysPosts.length,
    impressions: yesterdaysPosts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0),
    engagement: yesterdaysPosts.reduce((sum, p) => sum + (p.engagement || 0), 0),
    likes: yesterdaysPosts.reduce((sum, p) => sum + (p.metrics?.likes || 0), 0),
    retweets: yesterdaysPosts.reduce((sum, p) => sum + (p.metrics?.retweets || 0), 0),
    replies: yesterdaysPosts.reduce((sum, p) => sum + (p.metrics?.replies || 0), 0),
    avgEngagementRate: yesterdaysPosts.length > 0
      ? yesterdaysPosts.reduce((sum, p) => sum + (p.engagementRate || 0), 0) / yesterdaysPosts.length
      : 0
  }

  // Calculate changes using the new comparison function
  const comparison = getDailyComparison(todayMetrics, yesterdayMetrics)
  const changes = {
    impressions: comparison.impressions.change,
    engagement: comparison.engagement.change,
    engagementRate: comparison.avgEngagementRate.change
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
      language: p.language,
      experiment: p.experiment
    }))

  // Best performers by category (using new function)
  const topPerformers = getTopPerformers()
  const bestPerformers = {
    hook: topPerformers.topHook ? { key: topPerformers.topHook.name, score: topPerformers.topHook.score } : null,
    style: topPerformers.topStyle ? { key: topPerformers.topStyle.name, score: topPerformers.topStyle.score } : null,
    topic: topPerformers.topTopic ? { key: topPerformers.topTopic.name, score: topPerformers.topTopic.score } : null,
    hour: findTopByScore(learnings.scores.hours),
    language: findTopByScore(learnings.scores.languages),
    experiment: topPerformers.topExperiment ? { key: topPerformers.topExperiment.name, score: topPerformers.topExperiment.score } : null,
    hourBrazil: topPerformers.topHourBrazil ? { key: topPerformers.topHourBrazil.hour, score: topPerformers.topHourBrazil.score } : null,
    hourUSA: topPerformers.topHourUSA ? { key: topPerformers.topHourUSA.hour, score: topPerformers.topHourUSA.score } : null
  }

  // Projection to 5M impressions goal
  const totalImpressions = postsLog.posts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0)
  const daysWithData = Math.max(1, Math.ceil((Date.now() - new Date(postsLog.posts[0]?.createdAt || Date.now()).getTime()) / (24 * 60 * 60 * 1000)))
  const avgDailyImpressions = totalImpressions / daysWithData
  const daysToGoal = avgDailyImpressions > 0 ? Math.ceil((IMPRESSIONS_GOAL - totalImpressions) / avgDailyImpressions) : Infinity
  const progressPercent = (totalImpressions / IMPRESSIONS_GOAL) * 100

  // Generate recommendations using the new insights function
  const insights = generateInsights()
  const recommendations = [...insights]

  // Add legacy recommendations for compatibility
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
  if (bestPerformers.experiment) {
    recommendations.push(`Top experiment: ${bestPerformers.experiment.key} (score: ${Math.round(bestPerformers.experiment.score)})`)
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
    comparison,

    top3Posts,
    bestPerformers,
    topPerformers,

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

    insights,
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
  msg += `  Avg ER: ${report.todayMetrics.avgEngagementRate.toFixed(2)}%\n`
  if (report.todayMetrics.experimentsUsed > 0) {
    msg += `  Experiments: ${report.todayMetrics.experimentsUsed} posts\n`
  }
  msg += `\n`

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
      const expTag = p.experiment ? ` [${p.experiment}]` : ''
      msg += `${i + 1}. [${p.engagement}eng${expTag}] "${p.text.substring(0, 50)}..."\n`
    }
    msg += `\n`
  }

  // Best times by timezone
  if (report.topPerformers?.topHourBrazil || report.topPerformers?.topHourUSA) {
    msg += `<b>Best Times:</b>\n`
    if (report.topPerformers.topHourBrazil) {
      msg += `  🇧🇷 Brazil: ${report.topPerformers.topHourBrazil.hour}h BRT\n`
    }
    if (report.topPerformers.topHourUSA) {
      const h = report.topPerformers.topHourUSA.hour
      const ampm = h >= 12 ? 'pm' : 'am'
      const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h)
      msg += `  🇺🇸 USA: ${displayH}${ampm} EST\n`
    }
    msg += `\n`
  }

  // Goal progress
  msg += `<b>5M Goal Progress:</b>\n`
  msg += `  ${report.goal.progressPercent.toFixed(2)}% (${(report.goal.current / 1000000).toFixed(2)}M / 5M)\n`
  msg += `  Avg/day: ${report.goal.avgDailyImpressions.toLocaleString()}\n`
  msg += `  ETA: ${report.goal.projectedDate}\n\n`

  // Insights (new)
  if (report.insights && report.insights.length > 0) {
    msg += `<b>Insights:</b>\n`
    for (const insight of report.insights.slice(0, 5)) {
      msg += `  • ${insight}\n`
    }
    msg += `\n`
  }

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

// Named exports for functions not already exported inline
export { loadLearnings, saveLearnings, detectExperiment }

export default {
  analyzePosts,
  adjustWeights,
  generateDailyReport,
  formatReportForTelegram,
  weightedSelect,
  getTopWeighted,
  loadLearnings,
  saveLearnings,
  getTopPerformers,
  generateInsights,
  getDailyComparison,
  detectExperiment
}
