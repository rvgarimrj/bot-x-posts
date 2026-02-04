/**
 * Daily Learning Script
 *
 * Runs every day at 23:59 to:
 * 1. Collect analytics (impressions, engagement, followers)
 * 2. Analyze posts (top 3, hooks, styles, hours, topics, languages)
 * 3. Compare with previous day
 * 4. Compare with GOALS (5M impressions, 500 premium, 2000 verified)
 * 5. Adjust weights in learning engine
 * 6. Generate comprehensive report
 * 7. Send to Telegram
 * 8. Save to logs/daily-reports/YYYY-MM-DD.json
 * 9. Update GOALS.md with progress
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { sendNotification } from '../src/telegram-v2.js'
import {
  analyzePosts,
  adjustWeights,
  generateDailyReport,
  loadLearnings
} from '../src/learning-engine.js'
import { collectDailyAnalytics, getLatestAnalytics, getCurrentProjection } from '../src/analytics-monitor.js'

// ==================== CONFIGURATION ====================

const DATA_DIR = '/Users/user/AppsCalude/Bot-X-Posts/data'
const LOGS_DIR = '/Users/user/AppsCalude/Bot-X-Posts/logs/daily-reports'
const GOALS_FILE = path.join(DATA_DIR, 'GOALS.md')
const LEARNINGS_FILE = path.join(DATA_DIR, 'learnings.json')
const POSTS_LOG_FILE = path.join(DATA_DIR, 'posts-log.json')

const TIMEZONE = 'America/Sao_Paulo'

// Goals from GOALS.md
const GOALS = {
  impressions: {
    target: 5_000_000,
    timeframeDays: 90,
    dailyTarget: Math.ceil(5_000_000 / 90) // ~55,556/dia
  },
  premiumFollowers: {
    target: 500,
    timeframeDays: 90,
    dailyTarget: Math.ceil(500 / 90) // ~5.6/dia
  },
  verifiedFollowers: {
    target: 2000,
    timeframeDays: 90,
    dailyTarget: Math.ceil(2000 / 90) // ~22.2/dia
  }
}

// Start date for goal tracking
const GOAL_START_DATE = new Date('2026-02-03')

// ==================== UTILITY FUNCTIONS ====================

function formatDate(date = new Date()) {
  return date.toLocaleDateString('pt-BR', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).split('/').reverse().join('-') // YYYY-MM-DD format
}

function formatNumber(num) {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toLocaleString()
}

function getChangeIndicator(change) {
  if (change > 5) return '+++'
  if (change > 0) return '+'
  if (change < -5) return '---'
  if (change < 0) return '-'
  return '='
}

function getDaysElapsed() {
  const now = new Date()
  const diffTime = Math.abs(now - GOAL_START_DATE)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

function getDaysRemaining() {
  return Math.max(0, GOALS.impressions.timeframeDays - getDaysElapsed())
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadPostsLog() {
  try {
    if (fs.existsSync(POSTS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(POSTS_LOG_FILE, 'utf-8'))
    }
  } catch (err) {
    console.log(`   Warning: Could not load posts log: ${err.message}`)
  }
  return { posts: [] }
}

function loadPreviousDayReport() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayFile = path.join(LOGS_DIR, `${formatDate(yesterday)}.json`)

  try {
    if (fs.existsSync(yesterdayFile)) {
      return JSON.parse(fs.readFileSync(yesterdayFile, 'utf-8'))
    }
  } catch (err) {
    console.log(`   Could not load previous report: ${err.message}`)
  }
  return null
}

// ==================== ANALYTICS COLLECTION ====================

async function collectTodayAnalytics() {
  console.log('\n1. Collecting analytics...')

  try {
    // Try to collect via Puppeteer (X Analytics page)
    const result = await collectDailyAnalytics()

    if (result.success) {
      console.log('   Analytics collected via X Analytics page')
      return result.data
    }

    // Fallback: use learning engine data
    console.log('   Falling back to learning engine data...')
    return null
  } catch (err) {
    console.log(`   Analytics collection error: ${err.message}`)
    return null
  }
}

// ==================== POST ANALYSIS ====================

async function analyzeTodaysPosts() {
  console.log('\n2. Analyzing today\'s posts...')

  // Run learning engine analysis
  const analysisResult = await analyzePosts()

  if (!analysisResult.success) {
    console.log(`   Analysis failed: ${analysisResult.message}`)
    return null
  }

  console.log(`   Analyzed ${analysisResult.tweetsAnalyzed} tweets`)

  // Load posts log to get today's posts specifically
  const postsLog = loadPostsLog()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todaysPosts = postsLog.posts.filter(p => {
    const postDate = new Date(p.createdAt)
    postDate.setHours(0, 0, 0, 0)
    return postDate.getTime() === today.getTime()
  })

  // Get top 3 posts by engagement
  const top3 = [...todaysPosts]
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, 3)
    .map(p => ({
      text: p.text?.substring(0, 100) + (p.text?.length > 100 ? '...' : ''),
      engagement: p.engagement || 0,
      impressions: p.metrics?.impressions || 0,
      hook: p.hook || 'unknown',
      style: p.style || 'unknown',
      topic: p.topic || 'unknown',
      language: p.language || 'unknown',
      hour: p.hour || 0
    }))

  // Analyze what worked today
  const hookCounts = {}
  const styleCounts = {}
  const topicCounts = {}
  const hourCounts = {}
  const languageCounts = {}

  for (const post of todaysPosts) {
    if (post.hook && post.hook !== 'unknown') {
      hookCounts[post.hook] = (hookCounts[post.hook] || 0) + (post.engagement || 0)
    }
    if (post.style && post.style !== 'unknown') {
      styleCounts[post.style] = (styleCounts[post.style] || 0) + (post.engagement || 0)
    }
    if (post.topic && post.topic !== 'unknown') {
      topicCounts[post.topic] = (topicCounts[post.topic] || 0) + (post.engagement || 0)
    }
    if (post.hour) {
      hourCounts[post.hour] = (hourCounts[post.hour] || 0) + (post.engagement || 0)
    }
    if (post.language) {
      languageCounts[post.language] = (languageCounts[post.language] || 0) + (post.engagement || 0)
    }
  }

  // Find best performers for today
  const findBest = (counts) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return sorted.length > 0 ? { key: sorted[0][0], engagement: sorted[0][1] } : null
  }

  return {
    totalPosts: todaysPosts.length,
    totalEngagement: todaysPosts.reduce((sum, p) => sum + (p.engagement || 0), 0),
    totalImpressions: todaysPosts.reduce((sum, p) => sum + (p.metrics?.impressions || 0), 0),
    top3Posts: top3,
    bestHook: findBest(hookCounts),
    bestStyle: findBest(styleCounts),
    bestTopic: findBest(topicCounts),
    bestHour: findBest(hourCounts),
    bestLanguage: findBest(languageCounts),
    hookCounts,
    styleCounts,
    topicCounts,
    hourCounts,
    languageCounts,
    analysisResult
  }
}

// ==================== COMPARISON ====================

function compareWithPrevious(todayData, previousReport) {
  console.log('\n3. Comparing with previous day...')

  if (!previousReport) {
    console.log('   No previous report found')
    return {
      impressions: { change: 0, percent: 0, indicator: '=' },
      engagement: { change: 0, percent: 0, indicator: '=' },
      posts: { change: 0, indicator: '=' },
      engagementRate: { change: 0, percent: 0, indicator: '=' }
    }
  }

  const calcChange = (current, previous) => {
    const change = current - previous
    const percent = previous > 0 ? ((change / previous) * 100) : 0
    return {
      change,
      percent: Math.round(percent * 10) / 10,
      indicator: getChangeIndicator(percent)
    }
  }

  const prevMetrics = previousReport.todayMetrics || previousReport.metrics || {}

  return {
    impressions: calcChange(todayData?.totalImpressions || 0, prevMetrics.impressions || 0),
    engagement: calcChange(todayData?.totalEngagement || 0, prevMetrics.engagement || 0),
    posts: calcChange(todayData?.totalPosts || 0, prevMetrics.posts || 0),
    engagementRate: calcChange(
      todayData?.totalImpressions > 0 ? (todayData.totalEngagement / todayData.totalImpressions * 100) : 0,
      prevMetrics.impressions > 0 ? ((prevMetrics.engagement || 0) / prevMetrics.impressions * 100) : 0
    )
  }
}

// ==================== GOALS COMPARISON ====================

function compareWithGoals(todayData, learnings) {
  console.log('\n4. Comparing with goals...')

  const daysElapsed = getDaysElapsed()
  const daysRemaining = getDaysRemaining()

  // Calculate cumulative progress
  const totalImpressions = learnings?.totalImpressions || 0
  const expectedImpressions = GOALS.impressions.dailyTarget * daysElapsed

  // Calculate projections
  const avgDailyImpressions = daysElapsed > 0 ? totalImpressions / daysElapsed : 0
  const projectedTotal = avgDailyImpressions * GOALS.impressions.timeframeDays
  const daysToGoal = avgDailyImpressions > 0
    ? Math.ceil((GOALS.impressions.target - totalImpressions) / avgDailyImpressions)
    : Infinity

  // Determine if on track
  const impressionProgress = (totalImpressions / GOALS.impressions.target) * 100
  const expectedProgress = (daysElapsed / GOALS.impressions.timeframeDays) * 100
  const onTrack = impressionProgress >= expectedProgress * 0.8 // 80% tolerance

  // Status determination
  let status = 'on-track'
  if (impressionProgress < expectedProgress * 0.5) status = 'critical'
  else if (impressionProgress < expectedProgress * 0.8) status = 'behind'
  else if (impressionProgress > expectedProgress * 1.2) status = 'ahead'

  return {
    impressions: {
      target: GOALS.impressions.target,
      current: totalImpressions,
      progress: Math.round(impressionProgress * 100) / 100,
      expected: Math.round(expectedProgress * 100) / 100,
      dailyTarget: GOALS.impressions.dailyTarget,
      avgDaily: Math.round(avgDailyImpressions),
      projectedTotal: Math.round(projectedTotal),
      daysToGoal: daysToGoal === Infinity ? 'N/A' : daysToGoal,
      projectedDate: daysToGoal !== Infinity && daysToGoal > 0
        ? formatDate(new Date(Date.now() + daysToGoal * 24 * 60 * 60 * 1000))
        : 'N/A',
      onTrack,
      status
    },
    premiumFollowers: {
      target: GOALS.premiumFollowers.target,
      current: 0, // TODO: collect from X Creator Studio
      progress: 0,
      dailyTarget: GOALS.premiumFollowers.dailyTarget
    },
    verifiedFollowers: {
      target: GOALS.verifiedFollowers.target,
      current: 0, // TODO: collect from X Creator Studio
      progress: 0,
      dailyTarget: GOALS.verifiedFollowers.dailyTarget
    },
    daysElapsed,
    daysRemaining,
    timeProgress: Math.round((daysElapsed / GOALS.impressions.timeframeDays) * 100)
  }
}

// ==================== WEIGHT ADJUSTMENT ====================

function adjustLearningWeights() {
  console.log('\n5. Adjusting weights...')

  const result = adjustWeights()

  if (!result.success) {
    console.log('   Weight adjustment failed')
    return { applied: false, changes: [] }
  }

  console.log(`   ${result.recommendations.length} weight changes applied`)

  return {
    applied: true,
    changes: result.recommendations,
    weights: result.weights
  }
}

// ==================== RECOMMENDATIONS ====================

function generateRecommendations(analysis, comparison, goals, weightChanges) {
  console.log('\n6. Generating recommendations...')

  const recommendations = []

  // Based on what worked today
  if (analysis?.bestHook) {
    recommendations.push(`Best hook today: "${analysis.bestHook.key}" - use more tomorrow`)
  }
  if (analysis?.bestStyle) {
    recommendations.push(`Best style today: "${analysis.bestStyle.key}" - prioritize`)
  }
  if (analysis?.bestTopic) {
    recommendations.push(`Best topic today: "${analysis.bestTopic.key}" - double down`)
  }
  if (analysis?.bestHour) {
    recommendations.push(`Best hour today: ${analysis.bestHour.key}h - consider posting more`)
  }
  if (analysis?.bestLanguage) {
    recommendations.push(`Best language today: ${analysis.bestLanguage.key}`)
  }

  // Based on goal progress
  if (goals.impressions.status === 'critical') {
    recommendations.push('CRITICAL: Impression rate too low - consider more posts or higher engagement content')
  } else if (goals.impressions.status === 'behind') {
    recommendations.push('Behind schedule - increase posting frequency or engagement tactics')
  } else if (goals.impressions.status === 'ahead') {
    recommendations.push('Ahead of schedule - maintain current strategy')
  }

  // Based on comparison
  if (comparison.impressions?.percent < -20) {
    recommendations.push('Impressions dropped significantly - review content quality')
  }
  if (comparison.engagement?.percent < -20) {
    recommendations.push('Engagement dropped significantly - try more engaging hooks')
  }

  // Based on weight changes
  const boosts = weightChanges.changes?.filter(c => c.includes('Boost')) || []
  const reduces = weightChanges.changes?.filter(c => c.includes('Reduce')) || []

  if (boosts.length > 0) {
    recommendations.push(`Boosted: ${boosts.map(b => b.split(':')[1]?.split(' ')[0]).join(', ')}`)
  }
  if (reduces.length > 0) {
    recommendations.push(`Reduced: ${reduces.map(r => r.split(':')[1]?.split(' ')[0]).join(', ')}`)
  }

  return recommendations.slice(0, 10) // Max 10 recommendations
}

// ==================== IDENTIFY WHAT DID NOT WORK ====================

function identifyWhatDidNotWork(analysis, learnings) {
  const notWorking = []

  // Check hooks with low scores
  if (learnings?.scores?.hooks) {
    for (const [hook, data] of Object.entries(learnings.scores.hooks)) {
      if (data.count >= 5 && data.score < 40) {
        notWorking.push(`Hook "${hook}" underperforming (score: ${Math.round(data.score)})`)
      }
    }
  }

  // Check styles with low scores
  if (learnings?.scores?.styles) {
    for (const [style, data] of Object.entries(learnings.scores.styles)) {
      if (data.count >= 5 && data.score < 40) {
        notWorking.push(`Style "${style}" underperforming (score: ${Math.round(data.score)})`)
      }
    }
  }

  // Check topics with low engagement today
  if (analysis?.topicCounts) {
    const topics = Object.entries(analysis.topicCounts)
    if (topics.length > 0) {
      const avgEngagement = topics.reduce((sum, [, eng]) => sum + eng, 0) / topics.length
      for (const [topic, engagement] of topics) {
        if (engagement < avgEngagement * 0.5) {
          notWorking.push(`Topic "${topic}" below average today`)
        }
      }
    }
  }

  // Check hours with low engagement
  if (analysis?.hourCounts) {
    const hours = Object.entries(analysis.hourCounts)
    if (hours.length > 0) {
      const avgEngagement = hours.reduce((sum, [, eng]) => sum + eng, 0) / hours.length
      for (const [hour, engagement] of hours) {
        if (engagement < avgEngagement * 0.5) {
          notWorking.push(`Hour ${hour}h below average today`)
        }
      }
    }
  }

  return notWorking.slice(0, 5) // Max 5 items
}

// ==================== REPORT GENERATION ====================

function buildFullReport(analytics, analysis, comparison, goals, weightChanges, recommendations, notWorking) {
  console.log('\n7. Building full report...')

  const report = {
    date: formatDate(),
    timestamp: new Date().toISOString(),
    version: 2,

    // Today's metrics
    todayMetrics: {
      posts: analysis?.totalPosts || 0,
      impressions: analysis?.totalImpressions || 0,
      engagement: analysis?.totalEngagement || 0,
      engagementRate: analysis?.totalImpressions > 0
        ? ((analysis.totalEngagement / analysis.totalImpressions) * 100).toFixed(2)
        : 0
    },

    // Top 3 posts
    top3Posts: analysis?.top3Posts || [],

    // Best performers today
    bestPerformers: {
      hook: analysis?.bestHook || null,
      style: analysis?.bestStyle || null,
      topic: analysis?.bestTopic || null,
      hour: analysis?.bestHour || null,
      language: analysis?.bestLanguage || null
    },

    // What did NOT work
    notWorking: notWorking || [],

    // Breakdown by category
    breakdowns: {
      hooks: analysis?.hookCounts || {},
      styles: analysis?.styleCounts || {},
      topics: analysis?.topicCounts || {},
      hours: analysis?.hourCounts || {},
      languages: analysis?.languageCounts || {}
    },

    // Comparison with previous day
    comparison: {
      impressions: comparison.impressions,
      engagement: comparison.engagement,
      posts: comparison.posts,
      engagementRate: comparison.engagementRate
    },

    // Goal progress
    goals: {
      impressions: goals.impressions,
      premiumFollowers: goals.premiumFollowers,
      verifiedFollowers: goals.verifiedFollowers,
      daysElapsed: goals.daysElapsed,
      daysRemaining: goals.daysRemaining,
      timeProgress: goals.timeProgress
    },

    // Weight adjustments
    weightChanges: {
      applied: weightChanges.applied,
      changes: weightChanges.changes,
      currentWeights: weightChanges.weights
    },

    // Recommendations for tomorrow
    recommendations,

    // Raw analytics data if available
    analyticsData: analytics || null
  }

  return report
}

// ==================== TELEGRAM REPORT ====================

function formatTelegramReport(report) {
  // Safe formatters
  const safeNumber = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '0'
    return formatNumber(val)
  }

  const safePercent = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '0'
    return typeof val === 'number' ? val.toFixed(1) : val
  }

  const statusIcon = (status) => {
    if (status === 'ahead') return '✅ AHEAD'
    if (status === 'on-track') return '✅ ON TRACK'
    if (status === 'behind') return '⚠️ BEHIND'
    if (status === 'critical') return '🔴 CRITICAL'
    return '❓ N/A'
  }

  const trendIcon = (indicator) => {
    if (indicator === '+++' || indicator === '++') return '📈'
    if (indicator === '+') return '📊'
    if (indicator === '---' || indicator === '--') return '📉'
    if (indicator === '-') return '📉'
    return '➡️'
  }

  let msg = `📊 <b>DAILY LEARNING REPORT</b>\n`
  msg += `📅 ${report.date}\n`
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`

  // Today's Metrics from X Analytics
  msg += `<b>📱 X ANALYTICS:</b>\n`
  if (report.analyticsData?.entry?.metrics) {
    const m = report.analyticsData.entry.metrics
    msg += `  👁 Impressions: ${safeNumber(m.impressions)}\n`
    msg += `  💬 Engagements: ${safeNumber(m.engagements)}\n`
    msg += `  👥 New Followers: ${safeNumber(m.newFollowers)}\n`
    msg += `  📍 Profile Visits: ${safeNumber(m.profileVisits)}\n`
  } else {
    msg += `  Posts: ${report.todayMetrics?.posts || 0}\n`
    msg += `  Impressions: ${safeNumber(report.todayMetrics?.impressions)}\n`
    msg += `  Engagement: ${safeNumber(report.todayMetrics?.engagement)}\n`
    msg += `  ER: ${safePercent(report.todayMetrics?.engagementRate)}%\n`
  }
  msg += `\n`

  // Comparison with previous day
  msg += `<b>📊 VS YESTERDAY:</b>\n`
  const impChange = report.comparison?.impressions || {}
  const engChange = report.comparison?.engagement || {}
  const postChange = report.comparison?.posts || {}
  msg += `  ${trendIcon(impChange.indicator)} Impressions: ${impChange.indicator || '='} ${safePercent(impChange.percent)}%\n`
  msg += `  ${trendIcon(engChange.indicator)} Engagement: ${engChange.indicator || '='} ${safePercent(engChange.percent)}%\n`
  msg += `  ${trendIcon(postChange.indicator)} Posts: ${postChange.indicator || '='} ${postChange.change || 0}\n`
  msg += `\n`

  // Goal Progress (5M Impressions)
  msg += `<b>🎯 5M IMPRESSIONS GOAL:</b>\n`
  const impGoal = report.goals?.impressions || {}
  msg += `  Status: ${statusIcon(impGoal.status)}\n`
  msg += `  Progress: ${safePercent(impGoal.progress)}% (${safeNumber(impGoal.current)})\n`
  msg += `  Expected: ${safePercent(impGoal.expected)}%\n`
  msg += `  Daily avg: ${safeNumber(impGoal.avgDaily)}\n`
  msg += `  Target: ${safeNumber(impGoal.dailyTarget)}/day\n`
  msg += `  Days left: ${report.goals?.daysRemaining || 'N/A'}\n`
  msg += `  ETA: ${impGoal.projectedDate || 'N/A'}\n`
  msg += `\n`

  // Other Goals
  msg += `<b>🏆 OTHER GOALS:</b>\n`
  const premiumGoal = report.goals?.premiumFollowers || {}
  const verifiedGoal = report.goals?.verifiedFollowers || {}
  msg += `  Premium Followers: ${premiumGoal.current || 0}/${premiumGoal.target || 500}\n`
  msg += `  Verified Followers: ${verifiedGoal.current || 0}/${verifiedGoal.target || 2000}\n`
  msg += `\n`

  // Top 3 Posts
  if (report.top3Posts && report.top3Posts.length > 0) {
    msg += `<b>🔥 TOP 3 POSTS:</b>\n`
    report.top3Posts.forEach((p, i) => {
      const hook = p.hook || '?'
      const style = p.style || '?'
      const eng = p.engagement || 0
      msg += `  ${i + 1}. [${eng} eng] ${hook}+${style}\n`
      if (p.text) {
        msg += `     "${p.text.substring(0, 35)}..."\n`
      }
    })
    msg += `\n`
  }

  // What Worked
  const bp = report.bestPerformers || {}
  const hasPerformers = bp.hook || bp.style || bp.topic || bp.hour || bp.language
  if (hasPerformers) {
    msg += `<b>✅ WHAT WORKED:</b>\n`
    if (bp.hook?.key) msg += `  🪝 Hook: ${bp.hook.key} (score: ${Math.round(bp.hook.score || 0)})\n`
    if (bp.style?.key) msg += `  🎨 Style: ${bp.style.key} (score: ${Math.round(bp.style.score || 0)})\n`
    if (bp.topic?.key) msg += `  📌 Topic: ${bp.topic.key}\n`
    if (bp.hour?.key) msg += `  🕐 Hour: ${bp.hour.key}h\n`
    if (bp.language?.key) msg += `  🌍 Language: ${bp.language.key}\n`
    msg += `\n`
  } else {
    msg += `<b>✅ WHAT WORKED:</b>\n`
    msg += `  (Need more data - keep posting!)\n\n`
  }

  // What Did NOT Work
  if (report.notWorking && report.notWorking.length > 0) {
    msg += `<b>❌ AVOID:</b>\n`
    report.notWorking.slice(0, 3).forEach(item => {
      msg += `  - ${item}\n`
    })
    msg += `\n`
  }

  // Weight Changes
  if (report.weightChanges?.applied && report.weightChanges.changes?.length > 0) {
    msg += `<b>⚖️ WEIGHT CHANGES:</b>\n`
    report.weightChanges.changes.slice(0, 5).forEach(c => {
      msg += `  - ${c}\n`
    })
    msg += `\n`
  }

  // Recommendations
  if (report.recommendations && report.recommendations.length > 0) {
    msg += `<b>💡 RECOMMENDATIONS:</b>\n`
    report.recommendations.slice(0, 5).forEach(r => {
      msg += `  - ${r}\n`
    })
    msg += `\n`
  }

  // Footer
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `🤖 Self-learning applied. See you tomorrow!`

  return msg
}

// ==================== SAVE REPORT ====================

function saveReport(report) {
  console.log('\n8. Saving report...')

  ensureDir(LOGS_DIR)

  const reportFile = path.join(LOGS_DIR, `${report.date}.json`)
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))

  console.log(`   Saved to: ${reportFile}`)
  return reportFile
}

// ==================== UPDATE GOALS.MD ====================

function updateGoalsFile(report) {
  console.log('\n9. Updating GOALS.md...')

  try {
    if (!fs.existsSync(GOALS_FILE)) {
      console.log('   GOALS.md not found, skipping update')
      return false
    }

    let content = fs.readFileSync(GOALS_FILE, 'utf-8')

    // Update "Dias Restantes"
    content = content.replace(
      /\*\*Dias Restantes:\*\* \d+/,
      `**Dias Restantes:** ${report.goals.daysRemaining}`
    )

    // Update "Calculadora de Progresso" section
    const progressSection = `\`\`\`
Dias passados: ${report.goals.daysElapsed}
Dias restantes: ${report.goals.daysRemaining}

Impressoes:
- Meta acumulada: ${formatNumber(report.goals.impressions.dailyTarget * report.goals.daysElapsed)}
- Atual: ${formatNumber(report.goals.impressions.current)}
- Diferenca: ${formatNumber(report.goals.impressions.current - (report.goals.impressions.dailyTarget * report.goals.daysElapsed))}
- On track: ${report.goals.impressions.onTrack ? 'SIM' : 'NAO'}

Premium Followers:
- Meta acumulada: ${Math.round(report.goals.premiumFollowers.dailyTarget * report.goals.daysElapsed)}
- Atual: ${report.goals.premiumFollowers.current}
- Diferenca: ${report.goals.premiumFollowers.current - Math.round(report.goals.premiumFollowers.dailyTarget * report.goals.daysElapsed)}
- On track: -

Verified Followers:
- Meta acumulada: ${Math.round(report.goals.verifiedFollowers.dailyTarget * report.goals.daysElapsed)}
- Atual: ${report.goals.verifiedFollowers.current}
- Diferenca: ${report.goals.verifiedFollowers.current - Math.round(report.goals.verifiedFollowers.dailyTarget * report.goals.daysElapsed)}
- On track: -
\`\`\``

    // Replace the calculator section
    content = content.replace(
      /## Calculadora de Progresso[\s\S]*?```[\s\S]*?```/,
      `## Calculadora de Progresso\n\n${progressSection}`
    )

    // Add today's entry to the weekly progress table if applicable
    const today = formatDate()
    const dayNum = today.split('-')[2] // Get day number

    // Find the table row for today and update it
    const tableRowRegex = new RegExp(`\\| ${today.substring(5)} \\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|`)
    if (content.match(tableRowRegex)) {
      content = content.replace(
        tableRowRegex,
        `| ${today.substring(5)} | ${formatNumber(report.todayMetrics.impressions)} | ${report.goals.premiumFollowers.current} | ${report.goals.verifiedFollowers.current} | ${report.todayMetrics.posts} | Updated |`
      )
    }

    // Update last update in historico
    const historyEntry = `| ${today} | Daily learning report updated automatically |`
    if (!content.includes(today)) {
      content = content.replace(
        /(## Historico de Updates\n\n\| Data \| Update \|\n\|------|--------\|\n)/,
        `$1${historyEntry}\n`
      )
    }

    fs.writeFileSync(GOALS_FILE, content)
    console.log('   GOALS.md updated successfully')
    return true

  } catch (err) {
    console.log(`   Error updating GOALS.md: ${err.message}`)
    return false
  }
}

// ==================== SEND TELEGRAM ====================

async function sendTelegramReport(report) {
  console.log('\n10. Sending Telegram report...')

  try {
    const message = formatTelegramReport(report)
    await sendNotification(message)
    console.log('   Telegram report sent!')
    return true
  } catch (err) {
    console.log(`   Failed to send Telegram: ${err.message}`)
    return false
  }
}

// ==================== MAIN ====================

async function main() {
  console.log('\n' + '='.repeat(50))
  console.log('   DAILY LEARNING SCRIPT')
  console.log('   ' + formatDate() + ' at ' + new Date().toLocaleTimeString('pt-BR', { timeZone: TIMEZONE }))
  console.log('='.repeat(50))

  try {
    // 1. Collect analytics (optional - may fail if Chrome not available)
    const analytics = await collectTodayAnalytics()

    // 2. Analyze today's posts
    const analysis = await analyzeTodaysPosts()

    // 3. Load previous day report
    const previousReport = loadPreviousDayReport()

    // 4. Compare with previous day
    const comparison = compareWithPrevious(analysis, previousReport)

    // 5. Load learnings and compare with goals
    const learnings = loadLearnings()
    const goals = compareWithGoals(analysis, learnings)

    // 6. Adjust weights based on analysis
    const weightChanges = adjustLearningWeights()

    // 7. Identify what did NOT work
    const notWorking = identifyWhatDidNotWork(analysis, learnings)

    // 8. Generate recommendations
    const recommendations = generateRecommendations(analysis, comparison, goals, weightChanges)

    // 9. Build full report
    const report = buildFullReport(analytics, analysis, comparison, goals, weightChanges, recommendations, notWorking)

    // 10. Save report to file
    const reportFile = saveReport(report)

    // 11. Update GOALS.md
    updateGoalsFile(report)

    // 12. Send Telegram report
    await sendTelegramReport(report)

    console.log('\n' + '='.repeat(50))
    console.log('   DAILY LEARNING COMPLETED')
    console.log(`   Report: ${reportFile}`)
    console.log('='.repeat(50) + '\n')

    return report

  } catch (err) {
    console.error('\nDaily learning failed:', err)

    // Send error notification
    try {
      await sendNotification(
        `<b>DAILY LEARNING FAILED</b>\n\n` +
        `Error: ${err.message}\n` +
        `Date: ${formatDate()}\n\n` +
        `Check logs for details.`
      )
    } catch {}

    throw err
  }
}

// Run if called directly
const isMainModule = process.argv[1]?.includes('daily-learning')
if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}

export {
  main as runDailyLearning,
  collectTodayAnalytics,
  analyzeTodaysPosts,
  compareWithGoals,
  formatTelegramReport
}
