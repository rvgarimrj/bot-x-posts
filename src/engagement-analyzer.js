/**
 * Engagement Analyzer for Bot-X-Posts
 *
 * Analyzes REAL engagement data from our own posts to find optimal posting times.
 * Separates analysis by timezone (Brazil GMT-3, USA EST/PST) to optimize for
 * audience in different regions.
 *
 * Exports: analyzeEngagementHours(), getRecommendedSchedule(), updateScheduleFromLearnings()
 */

import { TwitterApi } from 'twitter-api-v2'
import fs from 'fs'
import path from 'path'

// ==================== CONFIGURATION ====================

const DATA_DIR = '/Users/user/AppsCalude/Bot-X-Posts/data'
const ENGAGEMENT_FILE = path.join(DATA_DIR, 'engagement-hours.json')

// Timezone offsets from UTC
const TIMEZONES = {
  brazil: -3,      // GMT-3 (Brasilia)
  usa_est: -5,     // EST (Eastern Standard Time)
  usa_pst: -8      // PST (Pacific Standard Time)
}

// Days of the week
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Minimum posts needed for statistical significance
const MIN_POSTS_FOR_HOUR = 3
const MIN_POSTS_FOR_DAY = 10

// ==================== DATA STRUCTURES ====================

/**
 * Default engagement data structure
 */
function getDefaultEngagementData() {
  return {
    lastAnalysis: null,
    totalPostsAnalyzed: 0,
    dateRange: {
      start: null,
      end: null
    },
    brazil: {
      topHours: [],
      topDays: [],
      hourlyData: {},   // hour -> { totalEngagement, totalImpressions, postCount }
      dailyData: {}     // day -> { totalEngagement, totalImpressions, postCount }
    },
    usa: {
      topHours: [],
      topDays: [],
      hourlyData: {},
      dailyData: {}
    },
    recommendations: {
      brazilSchedule: [],
      usaSchedule: [],
      overlappingHours: []
    },
    rawPosts: []  // Store last analysis posts for reference
  }
}

// ==================== FILE OPERATIONS ====================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadEngagementData() {
  ensureDataDir()
  try {
    if (fs.existsSync(ENGAGEMENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf-8'))
      return { ...getDefaultEngagementData(), ...data }
    }
  } catch (err) {
    console.log(`   Warning: Could not load engagement data: ${err.message}`)
  }
  return getDefaultEngagementData()
}

function saveEngagementData(data) {
  ensureDataDir()
  data.lastAnalysis = new Date().toISOString()
  fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2))
  console.log(`   Data saved to ${ENGAGEMENT_FILE}`)
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
 * Fetch tweets with metrics from the account
 * @param {number} limit - Maximum number of tweets to fetch
 * @returns {Promise<Array>} Array of tweets with metrics
 */
async function fetchTweetsWithMetrics(limit = 100) {
  try {
    const client = await getTwitterClient()
    const me = await client.v2.me()
    const userId = me.data.id

    console.log(`   Fetching tweets for user: ${me.data.username} (ID: ${userId})`)

    const tweets = await client.v2.userTimeline(userId, {
      max_results: Math.min(limit, 100),
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
      exclude: ['retweets', 'replies']
    })

    if (!tweets.data?.data) {
      console.log('   No tweets found in timeline')
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

// ==================== ENGAGEMENT CALCULATION ====================

/**
 * Calculate engagement score from metrics
 * Weighted: replies > retweets > quotes > bookmarks > likes
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
 * Convert UTC hour to local hour for a given timezone offset
 * @param {number} utcHour - Hour in UTC (0-23)
 * @param {number} offset - Timezone offset in hours
 * @returns {number} Local hour (0-23)
 */
function utcToLocalHour(utcHour, offset) {
  let localHour = utcHour + offset
  if (localHour < 0) localHour += 24
  if (localHour >= 24) localHour -= 24
  return localHour
}

/**
 * Get day of week in local timezone
 * @param {Date} date - Date object
 * @param {number} offset - Timezone offset in hours
 * @returns {string} Day name
 */
function getLocalDayOfWeek(date, offset) {
  // Create a new date adjusted for the offset
  const adjustedTime = new Date(date.getTime() + offset * 60 * 60 * 1000)
  return DAYS_OF_WEEK[adjustedTime.getUTCDay()]
}

// ==================== MAIN ANALYSIS FUNCTION ====================

/**
 * Analyze engagement hours from real post data
 * @param {number} limit - Number of recent tweets to analyze
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeEngagementHours(limit = 100) {
  console.log('Engagement Analyzer - Starting analysis')
  console.log('========================================')

  // Fetch tweets
  console.log(`\n1. Fetching up to ${limit} tweets...`)
  const tweets = await fetchTweetsWithMetrics(limit)

  if (tweets.length === 0) {
    console.log('   No tweets found to analyze')
    return {
      success: false,
      message: 'No tweets found',
      data: null
    }
  }

  console.log(`   Found ${tweets.length} tweets to analyze`)

  // Load existing data or create new
  const data = loadEngagementData()

  // Initialize hourly and daily data structures
  const initializeRegion = () => ({
    hourlyData: {},
    dailyData: {}
  })

  const brazil = initializeRegion()
  const usa = initializeRegion()

  // Initialize all hours (0-23)
  for (let h = 0; h < 24; h++) {
    brazil.hourlyData[h] = { totalEngagement: 0, totalImpressions: 0, postCount: 0 }
    usa.hourlyData[h] = { totalEngagement: 0, totalImpressions: 0, postCount: 0 }
  }

  // Initialize all days
  for (const day of DAYS_OF_WEEK) {
    brazil.dailyData[day] = { totalEngagement: 0, totalImpressions: 0, postCount: 0 }
    usa.dailyData[day] = { totalEngagement: 0, totalImpressions: 0, postCount: 0 }
  }

  // Track date range
  let minDate = null
  let maxDate = null
  const rawPosts = []

  // Process each tweet
  console.log('\n2. Processing tweets by timezone...')

  for (const tweet of tweets) {
    const createdAt = new Date(tweet.createdAt)
    const utcHour = createdAt.getUTCHours()
    const engagement = calculateEngagementScore(tweet.metrics)
    const impressions = tweet.metrics.impressions || 0

    // Track date range
    if (!minDate || createdAt < minDate) minDate = createdAt
    if (!maxDate || createdAt > maxDate) maxDate = createdAt

    // Brazil timezone (GMT-3)
    const brazilHour = utcToLocalHour(utcHour, TIMEZONES.brazil)
    const brazilDay = getLocalDayOfWeek(createdAt, TIMEZONES.brazil)

    brazil.hourlyData[brazilHour].totalEngagement += engagement
    brazil.hourlyData[brazilHour].totalImpressions += impressions
    brazil.hourlyData[brazilHour].postCount++

    brazil.dailyData[brazilDay].totalEngagement += engagement
    brazil.dailyData[brazilDay].totalImpressions += impressions
    brazil.dailyData[brazilDay].postCount++

    // USA timezone (using EST as primary, average between EST and PST)
    const usaHourEst = utcToLocalHour(utcHour, TIMEZONES.usa_est)
    const usaDay = getLocalDayOfWeek(createdAt, TIMEZONES.usa_est)

    usa.hourlyData[usaHourEst].totalEngagement += engagement
    usa.hourlyData[usaHourEst].totalImpressions += impressions
    usa.hourlyData[usaHourEst].postCount++

    usa.dailyData[usaDay].totalEngagement += engagement
    usa.dailyData[usaDay].totalImpressions += impressions
    usa.dailyData[usaDay].postCount++

    // Store raw post data for reference
    rawPosts.push({
      id: tweet.id,
      text: tweet.text.substring(0, 100) + (tweet.text.length > 100 ? '...' : ''),
      createdAt: tweet.createdAt,
      utcHour,
      brazilHour,
      usaHourEst,
      brazilDay,
      usaDay,
      engagement,
      impressions
    })
  }

  // Calculate top hours for Brazil
  console.log('\n3. Calculating top hours...')
  const brazilTopHours = calculateTopHours(brazil.hourlyData)
  const brazilTopDays = calculateTopDays(brazil.dailyData)

  // Calculate top hours for USA
  const usaTopHours = calculateTopHours(usa.hourlyData)
  const usaTopDays = calculateTopDays(usa.dailyData)

  // Generate recommendations
  console.log('\n4. Generating recommendations...')
  const recommendations = generateRecommendations(brazilTopHours, usaTopHours)

  // Update data object
  data.totalPostsAnalyzed = tweets.length
  data.dateRange = {
    start: minDate ? minDate.toISOString() : null,
    end: maxDate ? maxDate.toISOString() : null
  }

  data.brazil = {
    topHours: brazilTopHours,
    topDays: brazilTopDays,
    hourlyData: brazil.hourlyData,
    dailyData: brazil.dailyData
  }

  data.usa = {
    topHours: usaTopHours,
    topDays: usaTopDays,
    hourlyData: usa.hourlyData,
    dailyData: usa.dailyData
  }

  data.recommendations = recommendations
  data.rawPosts = rawPosts.slice(0, 20) // Keep only last 20 for reference

  // Save data
  console.log('\n5. Saving analysis results...')
  saveEngagementData(data)

  // Print summary
  printSummary(data)

  return {
    success: true,
    message: `Analyzed ${tweets.length} posts`,
    data
  }
}

/**
 * Calculate top 5 hours from hourly data
 */
function calculateTopHours(hourlyData) {
  const hours = []

  for (const [hour, stats] of Object.entries(hourlyData)) {
    if (stats.postCount >= MIN_POSTS_FOR_HOUR) {
      hours.push({
        hour: parseInt(hour),
        avgEngagement: Math.round((stats.totalEngagement / stats.postCount) * 100) / 100,
        avgImpressions: Math.round(stats.totalImpressions / stats.postCount),
        postCount: stats.postCount
      })
    }
  }

  // Sort by average engagement (descending)
  hours.sort((a, b) => b.avgEngagement - a.avgEngagement)

  // Return top 5
  return hours.slice(0, 5)
}

/**
 * Calculate top days from daily data
 */
function calculateTopDays(dailyData) {
  const days = []

  for (const [day, stats] of Object.entries(dailyData)) {
    if (stats.postCount >= MIN_POSTS_FOR_DAY) {
      days.push({
        day,
        avgEngagement: Math.round((stats.totalEngagement / stats.postCount) * 100) / 100,
        avgImpressions: Math.round(stats.totalImpressions / stats.postCount),
        postCount: stats.postCount
      })
    }
  }

  // Sort by average engagement (descending)
  days.sort((a, b) => b.avgEngagement - a.avgEngagement)

  return days
}

/**
 * Generate schedule recommendations
 */
function generateRecommendations(brazilTopHours, usaTopHours) {
  // Extract just the hours
  const brazilHours = brazilTopHours.map(h => h.hour)
  const usaHours = usaTopHours.map(h => h.hour)

  // Find overlapping hours (good for both audiences)
  // Consider +/- 1 hour as "close enough" for overlap
  const overlappingHours = []

  for (const brHour of brazilHours) {
    for (const usHour of usaHours) {
      // Calculate what UTC hour this would be
      const brUtc = (brHour - TIMEZONES.brazil + 24) % 24
      const usUtc = (usHour - TIMEZONES.usa_est + 24) % 24

      // If within 2 hours of each other in UTC, consider as overlapping
      const diff = Math.min(
        Math.abs(brUtc - usUtc),
        24 - Math.abs(brUtc - usUtc)
      )

      if (diff <= 2 && !overlappingHours.includes(brUtc)) {
        overlappingHours.push(brUtc)
      }
    }
  }

  // Recommend schedule: Convert top hours back to a reasonable posting schedule
  // Brazil schedule: Top 5 hours in Brazil time
  const brazilSchedule = brazilHours.slice(0, 5).sort((a, b) => a - b)

  // USA schedule: Top 5 hours in USA EST time
  const usaSchedule = usaHours.slice(0, 5).sort((a, b) => a - b)

  return {
    brazilSchedule,
    usaSchedule,
    overlappingHours: overlappingHours.sort((a, b) => a - b),
    notes: {
      brazil: `Top hours in Brazil (GMT-3): ${brazilSchedule.map(h => `${h}h`).join(', ')}`,
      usa: `Top hours in USA (EST): ${usaSchedule.map(h => `${h}h`).join(', ')}`,
      overlap: overlappingHours.length > 0
        ? `Best UTC hours for both: ${overlappingHours.map(h => `${h}h`).join(', ')}`
        : 'No significant overlapping hours found'
    }
  }
}

/**
 * Print analysis summary
 */
function printSummary(data) {
  console.log('\n========================================')
  console.log('ENGAGEMENT ANALYSIS SUMMARY')
  console.log('========================================')

  console.log(`\nTotal posts analyzed: ${data.totalPostsAnalyzed}`)
  console.log(`Date range: ${data.dateRange.start?.split('T')[0]} to ${data.dateRange.end?.split('T')[0]}`)

  console.log('\n--- BRAZIL (GMT-3) ---')
  if (data.brazil.topHours.length > 0) {
    console.log('Top 5 Hours:')
    for (const h of data.brazil.topHours) {
      console.log(`  ${String(h.hour).padStart(2, '0')}h: avg engagement ${h.avgEngagement}, avg impressions ${h.avgImpressions}, posts: ${h.postCount}`)
    }
  } else {
    console.log('  Not enough data for hourly analysis')
  }

  if (data.brazil.topDays.length > 0) {
    console.log('Top Days:')
    for (const d of data.brazil.topDays) {
      console.log(`  ${d.day}: avg engagement ${d.avgEngagement}, posts: ${d.postCount}`)
    }
  }

  console.log('\n--- USA (EST) ---')
  if (data.usa.topHours.length > 0) {
    console.log('Top 5 Hours:')
    for (const h of data.usa.topHours) {
      console.log(`  ${String(h.hour).padStart(2, '0')}h: avg engagement ${h.avgEngagement}, avg impressions ${h.avgImpressions}, posts: ${h.postCount}`)
    }
  } else {
    console.log('  Not enough data for hourly analysis')
  }

  if (data.usa.topDays.length > 0) {
    console.log('Top Days:')
    for (const d of data.usa.topDays) {
      console.log(`  ${d.day}: avg engagement ${d.avgEngagement}, posts: ${d.postCount}`)
    }
  }

  console.log('\n--- RECOMMENDATIONS ---')
  console.log(`Brazil schedule: ${data.recommendations.brazilSchedule.map(h => `${h}h`).join(', ') || 'Need more data'}`)
  console.log(`USA schedule: ${data.recommendations.usaSchedule.map(h => `${h}h`).join(', ') || 'Need more data'}`)
  console.log(`Overlapping hours (UTC): ${data.recommendations.overlappingHours.map(h => `${h}h`).join(', ') || 'None found'}`)

  console.log('\n========================================\n')
}

// ==================== SCHEDULE FUNCTIONS ====================

/**
 * Get recommended posting schedule
 * @param {string} region - 'brazil', 'usa', or 'both'
 * @returns {Object} Recommended schedule
 */
export function getRecommendedSchedule(region = 'both') {
  const data = loadEngagementData()

  if (!data.lastAnalysis) {
    return {
      success: false,
      message: 'No analysis data available. Run analyzeEngagementHours() first.',
      schedule: null
    }
  }

  const result = {
    success: true,
    lastAnalysis: data.lastAnalysis,
    totalPostsAnalyzed: data.totalPostsAnalyzed,
    schedule: {}
  }

  if (region === 'brazil' || region === 'both') {
    result.schedule.brazil = {
      hours: data.recommendations.brazilSchedule,
      timezone: 'GMT-3 (Brasilia)',
      topHours: data.brazil.topHours,
      topDays: data.brazil.topDays
    }
  }

  if (region === 'usa' || region === 'both') {
    result.schedule.usa = {
      hours: data.recommendations.usaSchedule,
      timezone: 'EST (Eastern)',
      topHours: data.usa.topHours,
      topDays: data.usa.topDays
    }
  }

  if (region === 'both') {
    result.schedule.overlapping = {
      hours: data.recommendations.overlappingHours,
      timezone: 'UTC',
      note: 'Hours that work well for both Brazil and USA audiences'
    }
  }

  return result
}

/**
 * Update cron schedule based on learnings
 * Returns a new schedule array that can be used by cron-daemon
 * @returns {Object} New schedule recommendations
 */
export function updateScheduleFromLearnings() {
  const data = loadEngagementData()

  if (!data.lastAnalysis) {
    console.log('No engagement data available. Using default schedule.')
    return {
      success: false,
      message: 'No data available',
      currentSchedule: [8, 10, 12, 14, 16, 18, 20],
      recommendedSchedule: null
    }
  }

  // Current default schedule
  const currentSchedule = [8, 10, 12, 14, 16, 18, 20]

  // Build optimized schedule
  // Strategy: Mix of Brazil and USA best hours, prioritizing overlapping times

  const brazilBest = data.recommendations.brazilSchedule || []
  const usaBest = data.recommendations.usaSchedule || []
  const overlap = data.recommendations.overlappingHours || []

  // Convert recommendations to UTC for daemon (assuming server is in UTC)
  // Since daemon runs in local time, we need to adjust

  // For a mixed audience strategy:
  // 1. Include overlapping hours (good for both)
  // 2. Add top Brazil hours
  // 3. Add top USA hours
  // Limit to 7 slots (current pattern)

  const recommendedHours = new Set()

  // Add overlapping hours first (most valuable)
  for (const h of overlap) {
    if (recommendedHours.size < 7) {
      // Convert UTC to Brazil time for the schedule (server seems to run on Brazil time)
      const brHour = utcToLocalHour(h, TIMEZONES.brazil)
      recommendedHours.add(brHour)
    }
  }

  // Add Brazil top hours
  for (const h of brazilBest) {
    if (recommendedHours.size < 7) {
      recommendedHours.add(h)
    }
  }

  // If still have room, add some USA-friendly hours converted to Brazil time
  for (const h of usaBest) {
    if (recommendedHours.size < 7) {
      // This USA hour in EST, convert to Brazil time
      const utcHour = (h - TIMEZONES.usa_est + 24) % 24
      const brHour = utcToLocalHour(utcHour, TIMEZONES.brazil)
      recommendedHours.add(brHour)
    }
  }

  const recommendedSchedule = Array.from(recommendedHours).sort((a, b) => a - b)

  // Calculate change summary
  const added = recommendedSchedule.filter(h => !currentSchedule.includes(h))
  const removed = currentSchedule.filter(h => !recommendedSchedule.includes(h))

  console.log('\n--- SCHEDULE UPDATE RECOMMENDATION ---')
  console.log(`Current schedule: ${currentSchedule.join(', ')}h`)
  console.log(`Recommended: ${recommendedSchedule.join(', ')}h`)
  if (added.length > 0) console.log(`Add: ${added.join(', ')}h`)
  if (removed.length > 0) console.log(`Remove: ${removed.join(', ')}h`)
  console.log('--------------------------------------\n')

  return {
    success: true,
    currentSchedule,
    recommendedSchedule,
    changes: {
      added,
      removed
    },
    reasoning: {
      brazilBest,
      usaBest,
      overlap
    }
  }
}

// ==================== UTILITY EXPORTS ====================

/**
 * Get raw engagement data
 */
export function getEngagementData() {
  return loadEngagementData()
}

/**
 * Format engagement report for Telegram
 */
export function formatEngagementReportForTelegram(data) {
  if (!data || !data.lastAnalysis) {
    return 'No engagement data available. Run analysis first.'
  }

  let msg = `<b>Engagement Hours Analysis</b>\n`
  msg += `Last updated: ${new Date(data.lastAnalysis).toLocaleString('pt-BR')}\n`
  msg += `Posts analyzed: ${data.totalPostsAnalyzed}\n\n`

  msg += `<b>BRAZIL (GMT-3)</b>\n`
  if (data.brazil.topHours.length > 0) {
    msg += `Best hours: ${data.brazil.topHours.map(h => `${h.hour}h`).join(', ')}\n`
  }
  if (data.brazil.topDays.length > 0) {
    msg += `Best days: ${data.brazil.topDays.map(d => d.day).join(', ')}\n`
  }

  msg += `\n<b>USA (EST)</b>\n`
  if (data.usa.topHours.length > 0) {
    msg += `Best hours: ${data.usa.topHours.map(h => `${h.hour}h`).join(', ')}\n`
  }
  if (data.usa.topDays.length > 0) {
    msg += `Best days: ${data.usa.topDays.map(d => d.day).join(', ')}\n`
  }

  msg += `\n<b>RECOMMENDATIONS</b>\n`
  msg += `Brazil: ${data.recommendations.brazilSchedule.map(h => `${h}h`).join(', ') || 'Need more data'}\n`
  msg += `USA: ${data.recommendations.usaSchedule.map(h => `${h}h`).join(', ') || 'Need more data'}\n`
  msg += `Overlap (UTC): ${data.recommendations.overlappingHours.map(h => `${h}h`).join(', ') || 'None'}\n`

  return msg
}

// ==================== DEFAULT EXPORT ====================

export default {
  analyzeEngagementHours,
  getRecommendedSchedule,
  updateScheduleFromLearnings,
  getEngagementData,
  formatEngagementReportForTelegram
}

// ==================== CLI EXECUTION ====================

// If executed directly
if (process.argv[1] && process.argv[1].includes('engagement-analyzer')) {
  // Load environment variables
  const dotenvPath = '/Users/user/AppsCalude/Bot-X-Posts/.env'
  if (fs.existsSync(dotenvPath)) {
    const envContent = fs.readFileSync(dotenvPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim().replace(/^["']|["']$/g, '')
        process.env[key] = value
      }
    }
  }

  // Run analysis
  analyzeEngagementHours(100)
    .then(result => {
      if (!result.success) {
        console.error('Analysis failed:', result.message)
        process.exit(1)
      }

      // Also show schedule recommendations
      console.log('\n--- SCHEDULE UPDATE CHECK ---')
      updateScheduleFromLearnings()
    })
    .catch(err => {
      console.error('Error:', err)
      process.exit(1)
    })
}
