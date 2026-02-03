/**
 * Daily Analysis Script
 *
 * Runs every day at 23:59 to collect analytics and generate daily report.
 * Integrates with analytics-monitor.js and learning-engine.js (to be created).
 *
 * Features:
 * - Collects X analytics for the day
 * - Analyzes post performance
 * - Generates daily report
 * - Sends summary to Telegram
 * - Saves report to logs/daily-reports/YYYY-MM-DD.json
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { sendNotification } from '../src/telegram-v2.js'
import { fetchRecentTweets, analyzeEngagement } from '../src/learn.js'

const TIMEZONE = 'America/Sao_Paulo'
const REPORTS_DIR = path.join(process.cwd(), 'logs', 'daily-reports')

// Goal: 5M impressions target
const MONTHLY_GOAL = 5_000_000
const DAILY_GOAL = Math.round(MONTHLY_GOAL / 30)

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
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

function calculateChange(current, previous) {
  if (!previous || previous === 0) return { value: 0, direction: '-', text: 'N/A' }
  const change = ((current - previous) / previous) * 100
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'same'
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'
  return {
    value: Math.abs(change).toFixed(1),
    direction,
    text: `${arrow} ${Math.abs(change).toFixed(1)}%`
  }
}

// ==================== PREVIOUS REPORT ====================

function loadPreviousReport() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayFile = path.join(REPORTS_DIR, `${formatDate(yesterday)}.json`)

  try {
    if (fs.existsSync(yesterdayFile)) {
      return JSON.parse(fs.readFileSync(yesterdayFile, 'utf8'))
    }
  } catch (err) {
    console.error('Error loading previous report:', err.message)
  }
  return null
}

// ==================== ANALYTICS COLLECTION ====================

/**
 * Collects analytics from X API
 * TODO: Replace with analytics-monitor.js integration when available
 */
async function collectAnalytics() {
  console.log('Collecting analytics from X...')

  try {
    // Fetch recent tweets with metrics
    const tweets = await fetchRecentTweets(50) // Get more for better analysis

    if (!tweets || tweets.length === 0) {
      console.log('   No tweets found')
      return {
        impressions: 0,
        engagements: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        posts: [],
        totalPosts: 0
      }
    }

    // Filter tweets from today
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayTweets = tweets.filter(t => {
      const tweetDate = new Date(t.created_at)
      return tweetDate >= today
    })

    // Calculate totals
    const totalImpressions = todayTweets.reduce((sum, t) => sum + (t.views || 0), 0)
    const totalLikes = todayTweets.reduce((sum, t) => sum + (t.likes || 0), 0)
    const totalRetweets = todayTweets.reduce((sum, t) => sum + (t.retweets || 0), 0)
    const totalReplies = todayTweets.reduce((sum, t) => sum + (t.replies || 0), 0)
    const totalEngagements = totalLikes + totalRetweets * 2 + totalReplies * 3

    // Find best performing post
    const bestPost = todayTweets.length > 0
      ? todayTweets.reduce((best, t) => (t.engagement || 0) > (best.engagement || 0) ? t : best, todayTweets[0])
      : null

    return {
      impressions: totalImpressions,
      engagements: totalEngagements,
      likes: totalLikes,
      retweets: totalRetweets,
      replies: totalReplies,
      posts: todayTweets,
      totalPosts: todayTweets.length,
      bestPost
    }
  } catch (err) {
    console.error('   Error collecting analytics:', err.message)
    return {
      impressions: 0,
      engagements: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      posts: [],
      totalPosts: 0,
      error: err.message
    }
  }
}

// ==================== PERFORMANCE ANALYSIS ====================

/**
 * Analyzes post performance using learning engine
 * TODO: Replace with learning-engine.js integration when available
 */
async function analyzePerformance(analytics, previousReport) {
  console.log('Analyzing performance...')

  const analysis = {
    impressions: {
      today: analytics.impressions,
      yesterday: previousReport?.analytics?.impressions || 0,
      change: calculateChange(analytics.impressions, previousReport?.analytics?.impressions)
    },
    engagements: {
      today: analytics.engagements,
      yesterday: previousReport?.analytics?.engagements || 0,
      change: calculateChange(analytics.engagements, previousReport?.analytics?.engagements)
    },
    posts: {
      today: analytics.totalPosts,
      yesterday: previousReport?.analytics?.totalPosts || 0
    },
    engagementRate: analytics.impressions > 0
      ? ((analytics.engagements / analytics.impressions) * 100).toFixed(2)
      : 0
  }

  // Calculate projection for monthly goal
  const daysInMonth = 30
  const dayOfMonth = new Date().getDate()
  const projectedMonthly = (analytics.impressions / Math.max(1, dayOfMonth)) * daysInMonth
  const onTrack = projectedMonthly >= MONTHLY_GOAL

  analysis.projection = {
    monthly: projectedMonthly,
    goal: MONTHLY_GOAL,
    dailyGoal: DAILY_GOAL,
    onTrack,
    percentOfGoal: ((projectedMonthly / MONTHLY_GOAL) * 100).toFixed(1)
  }

  // Get Claude's analysis of engagement patterns (if we have tweets)
  if (analytics.posts && analytics.posts.length >= 5) {
    try {
      const engagementAnalysis = await analyzeEngagement(analytics.posts)
      analysis.patterns = engagementAnalysis
    } catch (err) {
      console.log('   Could not analyze patterns:', err.message)
    }
  }

  return analysis
}

// ==================== FOLLOWER COUNT ====================

/**
 * Gets current follower count
 * TODO: Implement via X API or scraping
 */
async function getFollowerCount() {
  // Placeholder - will be implemented with analytics-monitor.js
  return {
    current: 0,
    new: 0,
    error: 'Follower tracking not yet implemented'
  }
}

// ==================== REPORT GENERATION ====================

async function generateReport() {
  console.log('\n========== DAILY ANALYSIS ==========')
  console.log(`Date: ${formatDate()}`)
  console.log('=====================================\n')

  // Ensure reports directory exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true })
  }

  // Load previous report for comparison
  const previousReport = loadPreviousReport()

  // Collect today's data
  const analytics = await collectAnalytics()
  const followers = await getFollowerCount()
  const analysis = await analyzePerformance(analytics, previousReport)

  // Build report
  const report = {
    date: formatDate(),
    timestamp: new Date().toISOString(),
    analytics: {
      impressions: analytics.impressions,
      engagements: analytics.engagements,
      likes: analytics.likes,
      retweets: analytics.retweets,
      replies: analytics.replies,
      totalPosts: analytics.totalPosts,
      engagementRate: analysis.engagementRate
    },
    followers: {
      current: followers.current,
      new: followers.new
    },
    bestPost: analytics.bestPost ? {
      text: analytics.bestPost.text?.substring(0, 100) + '...',
      likes: analytics.bestPost.likes,
      retweets: analytics.bestPost.retweets,
      views: analytics.bestPost.views,
      engagement: analytics.bestPost.engagement
    } : null,
    comparison: {
      impressions: analysis.impressions.change,
      engagements: analysis.engagements.change
    },
    projection: analysis.projection,
    patterns: analysis.patterns || null
  }

  // Save report to file
  const reportFile = path.join(REPORTS_DIR, `${formatDate()}.json`)
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(`Report saved to: ${reportFile}`)

  return report
}

// ==================== TELEGRAM SUMMARY ====================

async function sendTelegramSummary(report) {
  console.log('\nSending Telegram summary...')

  const impChange = report.comparison.impressions
  const engChange = report.comparison.engagements

  const projectionEmoji = report.projection.onTrack ? '✅' : '⚠️'
  const projectionText = report.projection.onTrack
    ? 'On track for 5M goal!'
    : `${report.projection.percentOfGoal}% of goal`

  let bestPostSection = ''
  if (report.bestPost) {
    bestPostSection = `\n<b>Best Post:</b>\n"${escapeHtml(report.bestPost.text)}"\n` +
      `❤️ ${report.bestPost.likes} | 🔄 ${report.bestPost.retweets} | 👁 ${formatNumber(report.bestPost.views || 0)}\n`
  }

  let patternsSection = ''
  if (report.patterns) {
    patternsSection = `\n<b>Insights:</b>\n` +
      `• ${report.patterns.tip || 'Keep posting consistently!'}\n`
  }

  const message = `📊 <b>Daily Report - ${report.date}</b>\n\n` +
    `<b>Impressions:</b> ${formatNumber(report.analytics.impressions)} ${impChange.text}\n` +
    `<b>Engagements:</b> ${formatNumber(report.analytics.engagements)} ${engChange.text}\n` +
    `<b>Engagement Rate:</b> ${report.analytics.engagementRate}%\n` +
    `<b>Posts Today:</b> ${report.analytics.totalPosts}\n` +
    `<b>New Followers:</b> ${report.followers.new || 'N/A'}\n` +
    bestPostSection +
    `\n${projectionEmoji} <b>5M Goal:</b> ${projectionText}\n` +
    `📈 Projected: ${formatNumber(report.projection.monthly)}/month\n` +
    `🎯 Daily Target: ${formatNumber(DAILY_GOAL)}` +
    patternsSection

  try {
    await sendNotification(message)
    console.log('Telegram summary sent!')
  } catch (err) {
    console.error('Failed to send Telegram summary:', err.message)
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ==================== MAIN ====================

async function main() {
  console.log('Starting daily analysis...')

  try {
    const report = await generateReport()
    await sendTelegramSummary(report)

    console.log('\n✅ Daily analysis completed!')
    console.log(`   Report: logs/daily-reports/${formatDate()}.json`)

    return report
  } catch (err) {
    console.error('Daily analysis failed:', err)

    // Send error notification
    try {
      await sendNotification(
        `❌ <b>Daily Analysis Failed</b>\n\n` +
        `Error: ${err.message}\n` +
        `Date: ${formatDate()}`
      )
    } catch {}

    process.exit(1)
  }
}

// Run if called directly
if (process.argv[1].includes('daily-analysis')) {
  main().then(() => process.exit(0))
}

export { main as runDailyAnalysis, generateReport, collectAnalytics }
