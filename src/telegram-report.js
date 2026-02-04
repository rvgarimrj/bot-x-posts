/**
 * Telegram Report Formatter for Bot-X-Posts
 *
 * Formats various reports for Telegram with beautiful HTML formatting.
 * All functions return HTML-formatted strings ready for Telegram's parse_mode: 'HTML'
 *
 * Exports:
 * - formatDailyReport(report) - Complete daily report
 * - formatWeeklyReport(weekData) - Weekly summary
 * - formatGoalProgress(goals) - Goal tracking
 * - formatEmergencyAlert(issue) - Emergency alerts
 */

// ==================== HELPERS ====================

/**
 * Format number with thousands separator
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0'
  return num.toLocaleString('en-US')
}

/**
 * Format large numbers with K/M suffix
 */
function formatCompact(num) {
  if (num === null || num === undefined) return '0'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

/**
 * Format percentage change with + or - prefix
 */
function formatChange(value) {
  if (value === null || value === undefined) return '0%'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${Math.round(value)}%`
}

/**
 * Get progress bar visual
 */
function progressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length)
  const empty = length - filled
  return '[' + '='.repeat(Math.max(0, filled)) + ' '.repeat(Math.max(0, empty)) + ']'
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(date) {
  if (!date) return 'N/A'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo'
  })
}

/**
 * Escape HTML characters to avoid parsing errors
 */
function escapeHtml(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Truncate text with ellipsis
 */
function truncate(text, maxLength = 50) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

// ==================== MAIN FORMATTERS ====================

/**
 * Format complete daily report for Telegram
 *
 * @param {Object} report - Report data from generateDailyReport()
 * @returns {string} HTML formatted string for Telegram
 *
 * Expected report structure:
 * {
 *   date: '2026-02-03',
 *   todayMetrics: { posts, impressions, engagement, likes, retweets, replies, avgEngagementRate },
 *   yesterdayMetrics: { posts, impressions, engagement, avgEngagementRate },
 *   changes: { impressions, engagement, engagementRate },
 *   top3Posts: [{ text, engagement, impressions, hook, style, topic, language }],
 *   bestPerformers: { hook, style, topic, hour, language },
 *   goal: { target, current, progressPercent, avgDailyImpressions, daysToGoal, projectedDate },
 *   recommendations: [],
 *   weights: { hooks, styles, topics, hours, languages },
 *   topCombinations: [],
 *   changesApplied: [{ category, key, oldWeight, newWeight }]  // Optional
 * }
 */
export function formatDailyReport(report) {
  if (!report) return '<b>Error: No report data</b>'

  const lines = []

  // Header
  lines.push(`<b>DAILY REPORT - ${formatDate(report.date)}</b>`)
  lines.push('')

  // Metrics Section
  lines.push('<b>METRICS</b>')

  const impressionChange = report.changes?.impressions
  const impressionIcon = impressionChange > 0 ? '+' : impressionChange < 0 ? '' : ''
  lines.push(`Impressions: ${formatNumber(report.todayMetrics?.impressions || 0)} (${impressionIcon}${Math.round(impressionChange || 0)}% vs ontem)`)

  const engagementChange = report.changes?.engagement
  const engagementIcon = engagementChange > 0 ? '+' : engagementChange < 0 ? '' : ''
  lines.push(`Engagement: ${formatNumber(report.todayMetrics?.engagement || 0)} (${engagementIcon}${Math.round(engagementChange || 0)}%)`)

  if (report.followerMetrics) {
    const followerChange = report.followerMetrics.change || 0
    const followerIcon = followerChange > 0 ? '+' : followerChange < 0 ? '' : ''
    lines.push(`Followers: ${followerIcon}${followerChange} (${formatNumber(report.followerMetrics.total || 0)} total)`)
  }

  lines.push('')

  // Goals Section
  lines.push('<b>vs GOALS</b>')

  // 5M Impressions Goal
  const goal = report.goal || {}
  const impressionsProgress = goal.progressPercent || 0
  const impressionsTarget = goal.target || 5_000_000
  const impressionsCurrent = goal.current || 0
  const needPerDay = goal.avgDailyImpressions || 0
  const gotToday = report.todayMetrics?.impressions || 0
  const onTrackImpressions = gotToday >= needPerDay * 0.9

  lines.push(`5M Impressions: ${impressionsProgress.toFixed(1)}% (${formatCompact(impressionsCurrent)}/${formatCompact(impressionsTarget)})`)
  lines.push(`   Need: ${formatCompact(needPerDay)}/day | Got: ${formatCompact(gotToday)} | ${onTrackImpressions ? 'On track' : 'Behind'}`)

  // Premium Followers Goal (if available)
  if (report.premiumGoal) {
    const premiumProgress = ((report.premiumGoal.current || 0) / (report.premiumGoal.target || 500)) * 100
    lines.push(`500 Premium: ${premiumProgress.toFixed(0)}% (${report.premiumGoal.current || 0}/${report.premiumGoal.target || 500})`)
    lines.push(`   ${report.premiumGoal.onTrack ? 'On track' : 'Behind'}`)
  }

  // Verified Followers Goal (if available)
  if (report.verifiedGoal) {
    const verifiedProgress = ((report.verifiedGoal.current || 0) / (report.verifiedGoal.target || 2000)) * 100
    lines.push(`2000 Verified: ${verifiedProgress.toFixed(0)}% (${report.verifiedGoal.current || 0}/${report.verifiedGoal.target || 2000})`)
    lines.push(`   ${report.verifiedGoal.onTrack ? 'On track' : 'Behind'}`)
  }

  lines.push('')

  // Top Performers Section
  lines.push('<b>TOP PERFORMERS</b>')

  const bp = report.bestPerformers || {}

  if (bp.hook) {
    const hookScore = bp.hook.score ? `(+${Math.round(bp.hook.score - 50)}%)` : ''
    lines.push(`Best Hook: ${bp.hook.key} ${hookScore}`)
  }

  if (bp.style) {
    const styleScore = bp.style.score ? `(+${Math.round(bp.style.score - 50)}%)` : ''
    lines.push(`Best Style: ${bp.style.key} ${styleScore}`)
  }

  if (bp.topic) {
    const topicScore = bp.topic.score ? `(+${Math.round(bp.topic.score - 50)}%)` : ''
    lines.push(`Best Topic: ${bp.topic.key} ${topicScore}`)
  }

  if (bp.hour) {
    lines.push(`Best Hour BR: ${bp.hour.key}h`)
  }

  // Best hour for US audience (convert BR to EST)
  if (bp.hour) {
    const brHour = parseInt(bp.hour.key)
    const estHour = (brHour - 2 + 24) % 24  // BR is UTC-3, EST is UTC-5
    lines.push(`Best Hour US: ${estHour > 12 ? estHour - 12 + 'pm' : estHour + 'am'} EST`)
  }

  lines.push('')

  // Worst Performers Section
  lines.push('<b>WORST PERFORMERS</b>')

  const worstPerformers = report.worstPerformers || []
  if (worstPerformers.length > 0) {
    for (const wp of worstPerformers.slice(0, 3)) {
      const score = wp.score ? `(${Math.round(wp.score - 50)}%)` : ''
      lines.push(`Avoid: ${wp.key} ${wp.category} ${score}`)
    }
  } else {
    // Infer from weights
    const weights = report.weights || {}
    const lowPerformers = []

    if (weights.styles) {
      for (const [key, weight] of Object.entries(weights.styles)) {
        if (weight < 0.8) lowPerformers.push({ key, category: 'style', weight })
      }
    }
    if (weights.hooks) {
      for (const [key, weight] of Object.entries(weights.hooks)) {
        if (weight < 0.8) lowPerformers.push({ key, category: 'hook', weight })
      }
    }

    lowPerformers.sort((a, b) => a.weight - b.weight)
    for (const lp of lowPerformers.slice(0, 3)) {
      lines.push(`Avoid: ${lp.key} ${lp.category} (${Math.round((lp.weight - 1) * 100)}%)`)
    }

    if (lowPerformers.length === 0) {
      lines.push('No clear underperformers yet')
    }
  }

  lines.push('')

  // Changes Applied Section
  lines.push('<b>CHANGES APPLIED</b>')

  const changesApplied = report.changesApplied || []
  if (changesApplied.length > 0) {
    for (const change of changesApplied.slice(0, 5)) {
      const oldW = change.oldWeight?.toFixed(1) || '1.0'
      const newW = change.newWeight?.toFixed(1) || '1.0'
      const direction = parseFloat(newW) > parseFloat(oldW) ? 'Boosted' : 'Reduced'
      lines.push(`${direction} '${change.key}' weight: ${oldW} -> ${newW}`)
    }
  } else if (report.recommendations && report.recommendations.length > 0) {
    // Show recommendations as pending changes
    for (const rec of report.recommendations.slice(0, 3)) {
      lines.push(`Pending: ${rec}`)
    }
  } else {
    lines.push('No weight changes today')
  }

  lines.push('')

  // Top 3 Posts Section
  lines.push('<b>TOP 3 POSTS</b>')

  const top3 = report.top3Posts || []
  if (top3.length > 0) {
    for (let i = 0; i < Math.min(3, top3.length); i++) {
      const post = top3[i]
      const engagement = post.engagement || 0
      const text = escapeHtml(truncate(post.text, 40))
      lines.push(`${i + 1}. [${engagement} eng] "${text}"`)
    }
  } else {
    lines.push('No posts analyzed yet')
  }

  lines.push('')

  // Footer
  lines.push('<i>Learning applied. See you tomorrow!</i>')

  return lines.join('\n')
}

/**
 * Format weekly summary report
 *
 * @param {Object} weekData - Weekly aggregated data
 * @returns {string} HTML formatted string for Telegram
 *
 * Expected weekData structure:
 * {
 *   weekNumber: 5,
 *   startDate: '2026-01-27',
 *   endDate: '2026-02-02',
 *   totalPosts: 392,
 *   totalImpressions: 315000,
 *   totalEngagement: 5200,
 *   avgDailyImpressions: 45000,
 *   avgEngagementRate: 1.65,
 *   followerGrowth: 161,
 *   bestDay: { date, impressions, engagement },
 *   worstDay: { date, impressions, engagement },
 *   topHooks: [{ name, avgEngagement }],
 *   topStyles: [{ name, avgEngagement }],
 *   topTopics: [{ name, avgEngagement }],
 *   weekOverWeekChange: { impressions: 15, engagement: 8 },
 *   goalProgress: { impressions: 8.2, premium: 15, verified: 10 }
 * }
 */
export function formatWeeklyReport(weekData) {
  if (!weekData) return '<b>Error: No weekly data</b>'

  const lines = []

  // Header
  lines.push(`<b>WEEKLY REPORT - Week ${weekData.weekNumber || 'N/A'}</b>`)
  lines.push(`${formatDate(weekData.startDate)} - ${formatDate(weekData.endDate)}`)
  lines.push('')

  // Overview
  lines.push('<b>OVERVIEW</b>')
  lines.push(`Total Posts: ${formatNumber(weekData.totalPosts || 0)}`)
  lines.push(`Total Impressions: ${formatCompact(weekData.totalImpressions || 0)}`)
  lines.push(`Total Engagement: ${formatNumber(weekData.totalEngagement || 0)}`)
  lines.push(`Avg Daily Impressions: ${formatCompact(weekData.avgDailyImpressions || 0)}`)
  lines.push(`Avg Engagement Rate: ${(weekData.avgEngagementRate || 0).toFixed(2)}%`)
  lines.push(`Follower Growth: +${weekData.followerGrowth || 0}`)
  lines.push('')

  // Week over Week
  if (weekData.weekOverWeekChange) {
    lines.push('<b>vs LAST WEEK</b>')
    lines.push(`Impressions: ${formatChange(weekData.weekOverWeekChange.impressions)}`)
    lines.push(`Engagement: ${formatChange(weekData.weekOverWeekChange.engagement)}`)
    lines.push(`ER: ${formatChange(weekData.weekOverWeekChange.engagementRate)}`)
    lines.push('')
  }

  // Best/Worst Days
  lines.push('<b>DAILY BREAKDOWN</b>')

  if (weekData.bestDay) {
    lines.push(`Best Day: ${formatDate(weekData.bestDay.date)}`)
    lines.push(`   ${formatCompact(weekData.bestDay.impressions)} impr | ${weekData.bestDay.engagement} eng`)
  }

  if (weekData.worstDay) {
    lines.push(`Worst Day: ${formatDate(weekData.worstDay.date)}`)
    lines.push(`   ${formatCompact(weekData.worstDay.impressions)} impr | ${weekData.worstDay.engagement} eng`)
  }

  lines.push('')

  // Top Performers
  lines.push('<b>TOP PERFORMERS THIS WEEK</b>')

  if (weekData.topHooks && weekData.topHooks.length > 0) {
    const hookNames = weekData.topHooks.slice(0, 3).map(h => h.name).join(', ')
    lines.push(`Hooks: ${hookNames}`)
  }

  if (weekData.topStyles && weekData.topStyles.length > 0) {
    const styleNames = weekData.topStyles.slice(0, 3).map(s => s.name).join(', ')
    lines.push(`Styles: ${styleNames}`)
  }

  if (weekData.topTopics && weekData.topTopics.length > 0) {
    const topicNames = weekData.topTopics.slice(0, 3).map(t => t.name).join(', ')
    lines.push(`Topics: ${topicNames}`)
  }

  lines.push('')

  // Goal Progress
  if (weekData.goalProgress) {
    lines.push('<b>GOAL PROGRESS</b>')

    const gp = weekData.goalProgress
    lines.push(`5M Impressions: ${(gp.impressions || 0).toFixed(1)}%`)
    lines.push(`   ${progressBar(gp.impressions || 0, 20)}`)

    if (gp.premium !== undefined) {
      lines.push(`500 Premium: ${(gp.premium || 0).toFixed(0)}%`)
      lines.push(`   ${progressBar(gp.premium || 0, 20)}`)
    }

    if (gp.verified !== undefined) {
      lines.push(`2000 Verified: ${(gp.verified || 0).toFixed(0)}%`)
      lines.push(`   ${progressBar(gp.verified || 0, 20)}`)
    }

    lines.push('')
  }

  // Weekly Insights
  if (weekData.insights && weekData.insights.length > 0) {
    lines.push('<b>INSIGHTS</b>')
    for (const insight of weekData.insights.slice(0, 5)) {
      lines.push(`- ${insight}`)
    }
    lines.push('')
  }

  // Footer
  lines.push('<i>Weekly analysis complete. Keep grinding!</i>')

  return lines.join('\n')
}

/**
 * Format goal progress update
 *
 * @param {Object} goals - Current goal status
 * @returns {string} HTML formatted string for Telegram
 *
 * Expected goals structure:
 * {
 *   impressions: {
 *     target: 5000000,
 *     current: 410000,
 *     dailyNeeded: 55000,
 *     dailyAverage: 45000,
 *     daysRemaining: 90,
 *     projectedDate: '2026-05-01',
 *     onTrack: false
 *   },
 *   premiumFollowers: {
 *     target: 500,
 *     current: 75,
 *     dailyNeeded: 5,
 *     dailyAverage: 4,
 *     onTrack: false
 *   },
 *   verifiedFollowers: {
 *     target: 2000,
 *     current: 200,
 *     dailyNeeded: 22,
 *     dailyAverage: 18,
 *     onTrack: false
 *   }
 * }
 */
export function formatGoalProgress(goals) {
  if (!goals) return '<b>Error: No goals data</b>'

  const lines = []

  // Header
  lines.push('<b>GOAL PROGRESS UPDATE</b>')
  lines.push('')

  // Impressions Goal
  if (goals.impressions) {
    const g = goals.impressions
    const percent = ((g.current || 0) / (g.target || 5_000_000)) * 100

    lines.push(`<b>5M IMPRESSIONS</b>`)
    lines.push(`${progressBar(percent, 20)} ${percent.toFixed(1)}%`)
    lines.push(`Current: ${formatCompact(g.current || 0)} / ${formatCompact(g.target || 5_000_000)}`)
    lines.push(``)
    lines.push(`Daily Stats:`)
    lines.push(`   Need: ${formatCompact(g.dailyNeeded || 0)}/day`)
    lines.push(`   Avg: ${formatCompact(g.dailyAverage || 0)}/day`)
    lines.push(``)

    if (g.onTrack) {
      lines.push(`Status: ON TRACK`)
      lines.push(`   ETA: ${formatDate(g.projectedDate)}`)
    } else {
      const deficit = (g.dailyNeeded || 0) - (g.dailyAverage || 0)
      lines.push(`Status: BEHIND`)
      lines.push(`   Gap: ${formatCompact(deficit)}/day`)
      lines.push(`   Need ${Math.round(((g.dailyNeeded || 0) / Math.max(g.dailyAverage || 1, 1) - 1) * 100)}% more reach`)
    }

    lines.push('')
  }

  // Premium Followers Goal
  if (goals.premiumFollowers) {
    const g = goals.premiumFollowers
    const percent = ((g.current || 0) / (g.target || 500)) * 100

    lines.push(`<b>500 PREMIUM FOLLOWERS</b>`)
    lines.push(`${progressBar(percent, 20)} ${percent.toFixed(0)}%`)
    lines.push(`Current: ${g.current || 0} / ${g.target || 500}`)
    lines.push(``)

    if (g.onTrack) {
      lines.push(`Status: ON TRACK`)
    } else {
      lines.push(`Status: BEHIND`)
      lines.push(`   Need ${g.dailyNeeded || 0}/day, getting ${g.dailyAverage || 0}/day`)
    }

    lines.push('')
  }

  // Verified Followers Goal
  if (goals.verifiedFollowers) {
    const g = goals.verifiedFollowers
    const percent = ((g.current || 0) / (g.target || 2000)) * 100

    lines.push(`<b>2000 VERIFIED FOLLOWERS</b>`)
    lines.push(`${progressBar(percent, 20)} ${percent.toFixed(0)}%`)
    lines.push(`Current: ${g.current || 0} / ${g.target || 2000}`)
    lines.push(``)

    if (g.onTrack) {
      lines.push(`Status: ON TRACK`)
    } else {
      lines.push(`Status: BEHIND`)
      lines.push(`   Need ${g.dailyNeeded || 0}/day, getting ${g.dailyAverage || 0}/day`)
    }

    lines.push('')
  }

  // Summary
  lines.push('<b>SUMMARY</b>')

  const allGoals = [goals.impressions, goals.premiumFollowers, goals.verifiedFollowers].filter(Boolean)
  const onTrackCount = allGoals.filter(g => g.onTrack).length
  const totalGoals = allGoals.length

  if (onTrackCount === totalGoals) {
    lines.push('All goals on track! Keep it up!')
  } else if (onTrackCount === 0) {
    lines.push('All goals behind schedule. Time to adjust strategy.')
  } else {
    lines.push(`${onTrackCount}/${totalGoals} goals on track.`)
  }

  return lines.join('\n')
}

/**
 * Format emergency alert for critical issues
 *
 * @param {Object} issue - Issue details
 * @returns {string} HTML formatted string for Telegram
 *
 * Expected issue structure:
 * {
 *   type: 'rate_limit' | 'api_error' | 'chrome_disconnect' | 'low_engagement' | 'goal_risk' | 'daemon_crash',
 *   severity: 'critical' | 'warning' | 'info',
 *   title: 'Chrome Disconnected',
 *   message: 'Unable to connect to Chrome on port 9222',
 *   timestamp: '2026-02-03T14:30:00Z',
 *   details: {
 *     errorCode: 'ECONNREFUSED',
 *     lastSuccess: '2026-02-03T14:00:00Z',
 *     attempts: 3
 *   },
 *   action: 'Restart Chrome with --remote-debugging-port=9222',
 *   affectedPosts: 8
 * }
 */
export function formatEmergencyAlert(issue) {
  if (!issue) return '<b>ALERT: Unknown issue</b>'

  const lines = []

  // Severity icon and header
  const severityMap = {
    critical: { icon: '[!!!]', label: 'CRITICAL' },
    warning: { icon: '[!]', label: 'WARNING' },
    info: { icon: '[i]', label: 'INFO' }
  }

  const sev = severityMap[issue.severity] || severityMap.warning

  lines.push(`<b>${sev.icon} ${sev.label}: ${escapeHtml(issue.title || 'Alert')}</b>`)
  lines.push('')

  // Type-specific icon
  const typeMap = {
    rate_limit: 'Rate Limited',
    api_error: 'API Error',
    chrome_disconnect: 'Chrome Down',
    low_engagement: 'Low Engagement',
    goal_risk: 'Goal at Risk',
    daemon_crash: 'Daemon Crashed',
    post_failed: 'Post Failed',
    auth_error: 'Auth Error'
  }

  lines.push(`<b>Type:</b> ${typeMap[issue.type] || issue.type || 'Unknown'}`)
  lines.push(`<b>Time:</b> ${formatDate(issue.timestamp)}`)
  lines.push('')

  // Message
  if (issue.message) {
    lines.push(`<b>Details:</b>`)
    lines.push(escapeHtml(issue.message))
    lines.push('')
  }

  // Additional details
  if (issue.details) {
    lines.push(`<b>Debug Info:</b>`)
    for (const [key, value] of Object.entries(issue.details)) {
      lines.push(`   ${key}: ${escapeHtml(String(value))}`)
    }
    lines.push('')
  }

  // Impact
  if (issue.affectedPosts) {
    lines.push(`<b>Impact:</b> ${issue.affectedPosts} posts affected`)
    lines.push('')
  }

  // Recommended action
  if (issue.action) {
    lines.push(`<b>Action Required:</b>`)
    lines.push(`<code>${escapeHtml(issue.action)}</code>`)
    lines.push('')
  }

  // Commands for common issues
  const commandMap = {
    chrome_disconnect: 'pkill Chrome && /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 &',
    daemon_crash: 'launchctl unload ~/Library/LaunchAgents/com.botxposts.daemon.plist && launchctl load ~/Library/LaunchAgents/com.botxposts.daemon.plist',
    rate_limit: 'Wait 15 minutes, rate limit will reset automatically'
  }

  if (commandMap[issue.type]) {
    lines.push(`<b>Quick Fix:</b>`)
    lines.push(`<code>${commandMap[issue.type]}</code>`)
  }

  return lines.join('\n')
}

/**
 * Format quick status check
 *
 * @param {Object} status - Current system status
 * @returns {string} HTML formatted string for Telegram
 */
export function formatQuickStatus(status) {
  if (!status) return '<b>Status: Unknown</b>'

  const lines = []

  lines.push('<b>SYSTEM STATUS</b>')
  lines.push('')

  // Components
  const components = [
    { name: 'Chrome', status: status.chrome, icon: status.chrome ? 'OK' : 'DOWN' },
    { name: 'Daemon', status: status.daemon, icon: status.daemon ? 'OK' : 'DOWN' },
    { name: 'Twitter API', status: status.twitterApi, icon: status.twitterApi ? 'OK' : 'ERROR' },
    { name: 'Telegram Bot', status: status.telegram, icon: status.telegram ? 'OK' : 'ERROR' }
  ]

  for (const comp of components) {
    const statusIcon = comp.status ? '[OK]' : '[X]'
    lines.push(`${statusIcon} ${comp.name}`)
  }

  lines.push('')

  // Last activity
  if (status.lastPost) {
    lines.push(`Last Post: ${formatDate(status.lastPost)}`)
  }

  if (status.nextScheduled) {
    lines.push(`Next: ${status.nextScheduled}h`)
  }

  // Pending posts
  if (status.pendingPosts !== undefined) {
    lines.push(`Pending: ${status.pendingPosts} posts`)
  }

  return lines.join('\n')
}

/**
 * Format post confirmation with metrics preview
 *
 * @param {Object} post - Posted content with initial metrics
 * @returns {string} HTML formatted string for Telegram
 */
export function formatPostConfirmation(post) {
  if (!post) return '<b>Post: Unknown</b>'

  const lines = []

  const topicEmoji = {
    crypto: 'BTC',
    investing: 'Stocks',
    ai: 'AI',
    vibeCoding: 'Code'
  }

  lines.push(`<b>[OK] Posted!</b>`)
  lines.push('')
  lines.push(`<b>Topic:</b> ${topicEmoji[post.topic] || post.topic || 'Unknown'}`)
  lines.push(`<b>Lang:</b> ${post.language || 'Unknown'}`)
  lines.push(`<b>Style:</b> ${post.style || 'Unknown'}`)
  lines.push(`<b>Hook:</b> ${post.hook || 'Unknown'}`)
  lines.push('')
  lines.push(`<b>Preview:</b>`)
  lines.push(`"${escapeHtml(truncate(post.text, 100))}"`)

  if (post.url) {
    lines.push('')
    lines.push(`<a href="${post.url}">View on X</a>`)
  }

  return lines.join('\n')
}

// ==================== EXPORTS ====================

export default {
  formatDailyReport,
  formatWeeklyReport,
  formatGoalProgress,
  formatEmergencyAlert,
  formatQuickStatus,
  formatPostConfirmation
}
