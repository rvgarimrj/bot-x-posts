/**
 * Daily Learning Script
 *
 * Runs automatically to:
 * 1. Analyze recent posts and engagement
 * 2. Adjust selection weights
 * 3. Generate and send daily report
 *
 * Can be run standalone or called from cron daemon
 */

import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import {
  analyzePosts,
  adjustWeights,
  generateDailyReport,
  formatReportForTelegram
} from '../src/learning-engine.js'

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
const chatId = process.env.TELEGRAM_CHAT_ID

async function notify(message) {
  try {
    return await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  } catch (e) {
    console.log('Warning: Could not send Telegram notification:', e.message)
    return null
  }
}

async function main() {
  console.log('======================================')
  console.log('    Daily Learning Cycle')
  console.log('======================================\n')
  console.log(`Time: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`)

  try {
    // Step 1: Analyze posts
    console.log('1. Analyzing posts...')
    const analysis = await analyzePosts()

    if (!analysis.success) {
      console.log(`   Warning: ${analysis.message || 'Analysis failed'}`)
    } else {
      console.log(`   Analyzed ${analysis.tweetsAnalyzed} tweets`)
      console.log(`   Total impressions: ${analysis.totalImpressions?.toLocaleString() || 0}`)
      if (analysis.topHook) {
        console.log(`   Top hook: ${analysis.topHook.key} (score: ${Math.round(analysis.topHook.score)})`)
      }
      if (analysis.topStyle) {
        console.log(`   Top style: ${analysis.topStyle.key} (score: ${Math.round(analysis.topStyle.score)})`)
      }
      if (analysis.topTopic) {
        console.log(`   Top topic: ${analysis.topTopic.key} (score: ${Math.round(analysis.topTopic.score)})`)
      }
    }

    // Step 2: Adjust weights
    console.log('\n2. Adjusting weights...')
    const weights = adjustWeights()
    console.log(`   ${weights.recommendations.length} recommendations generated`)

    if (weights.recommendations.length > 0) {
      console.log('   Top recommendations:')
      for (const rec of weights.recommendations.slice(0, 3)) {
        console.log(`   - ${rec}`)
      }
    }

    // Step 3: Generate report
    console.log('\n3. Generating daily report...')
    const report = await generateDailyReport()

    console.log(`   Today: ${report.todayMetrics.posts} posts, ${report.todayMetrics.impressions.toLocaleString()} impressions`)
    console.log(`   Engagement: ${report.todayMetrics.engagement} total, ${report.todayMetrics.avgEngagementRate.toFixed(2)}% avg rate`)

    // Log changes vs yesterday
    const changeIcon = (val) => val > 0 ? '+' : ''
    console.log(`\n   vs Yesterday:`)
    console.log(`   Impressions: ${changeIcon(report.changes.impressions)}${Math.round(report.changes.impressions)}%`)
    console.log(`   Engagement: ${changeIcon(report.changes.engagement)}${Math.round(report.changes.engagement)}%`)

    // Log goal progress
    console.log(`\n   5M Goal Progress:`)
    console.log(`   ${report.goal.progressPercent.toFixed(2)}% complete (${(report.goal.current / 1000000).toFixed(2)}M / 5M)`)
    console.log(`   ETA: ${report.goal.projectedDate}`)

    // Step 4: Send report to Telegram
    console.log('\n4. Sending report to Telegram...')
    const telegramMessage = formatReportForTelegram(report)
    await notify(telegramMessage)
    console.log('   Report sent!')

    // Log top combinations if available
    if (report.topCombinations && report.topCombinations.length > 0) {
      console.log('\n   Top performing combinations:')
      for (const combo of report.topCombinations.slice(0, 3)) {
        console.log(`   - ${combo.hook}+${combo.style} on ${combo.topic} (${combo.language})`)
      }
    }

    console.log('\n======================================')
    console.log('    Learning Cycle Complete!')
    console.log('======================================')

  } catch (err) {
    console.error('Error in learning cycle:', err.message)
    await notify(`Learning cycle error: ${err.message}`)
    process.exit(1)
  }
}

// Run if called directly
main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
