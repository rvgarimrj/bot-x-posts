/**
 * Cron Daemon V2 - Multi-Source Bilingual Bot
 *
 * Schedule: Every 2h from 8h to 23h (9 slots)
 * Posts: 8 per slot (4 topics x 2 languages) = 72 posts/day
 * Days: Every day (0-6)
 *
 * Features:
 * - High volume posting for faster learning
 * - Health check at 00:01
 * - Learning cycle at 23:59
 * - Dynamic schedule adjustment based on engagement
 */

import 'dotenv/config'
import cron from 'node-cron'
import { spawn, execSync } from 'child_process'
import { sendNotification } from '../src/telegram-v2.js'
import { checkChromeConnection } from '../src/puppeteer-post.js'
import { loadLearnings } from '../src/learning-engine.js'
// Reply Monitor DISABLED - focusing on posts + analytics
// import { processReplies, getReplyStats } from '../src/reply-monitor.js'
import fs from 'fs'
import path from 'path'

const TIMEZONE = 'America/Sao_Paulo'
const PIDFILE = path.join(process.cwd(), 'logs', 'daemon-v2.pid')

// ==================== ANTI-SUSPENSION HEARTBEAT ====================
// macOS suspends background processes when screen is locked
// This heartbeat keeps the process active

const HEARTBEAT_INTERVAL = 5 * 60 * 1000 // 5 minutes
let heartbeatCount = 0
let lastHeartbeat = Date.now()

function startHeartbeat() {
  setInterval(async () => {
    heartbeatCount++
    lastHeartbeat = Date.now()

    // Small I/O activity to prevent suspension
    const heartbeatFile = path.join(process.cwd(), 'logs', '.heartbeat')
    try {
      fs.writeFileSync(heartbeatFile, `${Date.now()}\n${heartbeatCount}`)
    } catch {}

    // Log every 30 minutes (6 heartbeats)
    if (heartbeatCount % 6 === 0) {
      const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
      console.log(`[HEARTBEAT] ${now} - alive (${heartbeatCount} beats)`)
    }

    // Watchdog: check for missed crons every heartbeat
    try {
      await checkMissedCrons()
    } catch (err) {
      console.error('[WATCHDOG] Erro no checkMissedCrons:', err.message)
    }

    // Failsafe: force restart if uptime > 25h (in case 00:05 auto-restart also failed)
    const uptimeMs = Date.now() - DAEMON_START_TIME
    const uptimeHours = uptimeMs / (1000 * 60 * 60)
    if (uptimeHours > 25) {
      console.log(`[FAILSAFE] Uptime ${Math.round(uptimeHours)}h > 25h. Forcando restart...`)
      try {
        await sendNotification(
          `[FAILSAFE] <b>Auto-Restart por Uptime</b>\n\n` +
          `Uptime: ${Math.round(uptimeHours)}h\n` +
          `Acao: Forcando process.exit(0)\n` +
          `LaunchAgent vai reiniciar automaticamente.`
        )
      } catch {}
      process.exit(0)
    }
  }, HEARTBEAT_INTERVAL)

  console.log(`[HEARTBEAT] Anti-suspension heartbeat started (every ${HEARTBEAT_INTERVAL / 60000}min)`)
  console.log(`[WATCHDOG] Watchdog ativo: verifica crons perdidos a cada heartbeat`)
}

// ==================== DEFAULT SCHEDULE ====================

// Every 2 hours from 8h to 22h + 23h (9 slots)
// More posts = more data for learning engine
// 8 posts per slot = 72 posts/day
const DEFAULT_HOURS = [8, 10, 12, 14, 16, 18, 20, 22, 23]

// Minimum posts analyzed to trust engagement data
const MIN_POSTS_FOR_DYNAMIC_SCHEDULE = 30

// Store active cron jobs for potential reschedule
let activeJobs = []
let currentSchedule = []

// ==================== WATCHDOG: ANTI-CRON-PERDIDO ====================

const EXECUTIONS_FILE = path.join(process.cwd(), 'logs', '.cron-executions.json')
const GRACE_WINDOW_MS = 60 * 60 * 1000 // 60 minutes
const DAEMON_START_TIME = Date.now()

// Track which hours the watchdog already auto-triggered today (prevent double-fire)
const lastTriggeredByWatchdog = new Map()

/**
 * Get current hour in configured timezone
 */
function getCurrentHourInTimezone() {
  const now = new Date()
  const hourStr = now.toLocaleString('en-US', { timeZone: TIMEZONE, hour: 'numeric', hour12: false })
  return parseInt(hourStr)
}

/**
 * Get today's date string in configured timezone (YYYY-MM-DD)
 */
function getTodayInTimezone() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }) // en-CA = YYYY-MM-DD
}

/**
 * Load execution records from disk
 */
function loadExecutions() {
  try {
    if (fs.existsSync(EXECUTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(EXECUTIONS_FILE, 'utf8'))
    }
  } catch (err) {
    console.error('[WATCHDOG] Erro ao carregar executions:', err.message)
  }
  return {}
}

/**
 * Save execution records to disk
 */
function saveExecutions(executions) {
  try {
    const logsDir = path.join(process.cwd(), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    fs.writeFileSync(EXECUTIONS_FILE, JSON.stringify(executions, null, 2))
  } catch (err) {
    console.error('[WATCHDOG] Erro ao salvar executions:', err.message)
  }
}

/**
 * Record that a cron job executed for a given hour
 */
function recordExecution(hour) {
  const today = getTodayInTimezone()
  const executions = loadExecutions()

  if (!executions[today]) {
    executions[today] = {}
  }
  executions[today][String(hour)] = {
    timestamp: Date.now(),
    time: new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  }

  // Clean up old entries (keep only last 7 days)
  const keys = Object.keys(executions).sort()
  while (keys.length > 7) {
    delete executions[keys.shift()]
  }

  saveExecutions(executions)
  console.log(`[WATCHDOG] Execucao registrada: ${hour} (${today})`)
}

/**
 * Check for missed cron triggers and auto-fire if within grace window
 */
async function checkMissedCrons() {
  const today = getTodayInTimezone()
  const currentHour = getCurrentHourInTimezone()
  const now = Date.now()
  const executions = loadExecutions()
  const todayExecs = executions[today] || {}

  // Get the scheduled hours that should have fired by now
  const scheduledHours = currentSchedule.map(s => s.hour)

  for (const scheduledHour of scheduledHours) {
    // Only check hours that should have already fired
    // Also check current hour if >10 min past (allows same-hour miss detection)
    if (currentHour < scheduledHour) continue
    if (currentHour === scheduledHour) {
      const currentMinute = parseInt(new Date().toLocaleString('en-US', { timeZone: TIMEZONE, minute: 'numeric' }))
      if (currentMinute < 10) continue
    }

    const hourKey = String(scheduledHour)

    // Already executed today? Skip
    if (todayExecs[hourKey]) continue

    // Already triggered by watchdog today? Skip
    const watchdogKey = `${today}-${hourKey}`
    if (lastTriggeredByWatchdog.has(watchdogKey)) continue

    // Calculate how long ago the scheduled time was
    const scheduledTime = new Date()
    scheduledTime.setHours(scheduledHour, 0, 0, 0)
    // Adjust for timezone: get the actual scheduled timestamp
    const tzNow = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }))
    const msSinceScheduled = tzNow - new Date(tzNow.toDateString() + ` ${scheduledHour}:00:00`)

    if (msSinceScheduled > 0 && msSinceScheduled <= GRACE_WINDOW_MS) {
      // Within grace window - AUTO-TRIGGER
      console.log(`\n[WATCHDOG] CRON PERDIDO DETECTADO: ${scheduledHour}h (${Math.round(msSinceScheduled / 60000)}min atras)`)
      console.log(`[WATCHDOG] Auto-triggering ${scheduledHour}h...`)

      lastTriggeredByWatchdog.set(watchdogKey, now)

      try {
        await sendNotification(
          `[WATCHDOG] <b>Cron Perdido - Auto-Trigger</b>\n\n` +
          `Horario: ${scheduledHour}h\n` +
          `Atraso: ${Math.round(msSinceScheduled / 60000)}min\n` +
          `Acao: Auto-trigger executado\n\n` +
          `<i>O watchdog detectou que o cron das ${scheduledHour}h nao disparou e acionou automaticamente.</i>`
        )
      } catch (err) {
        console.error('[WATCHDOG] Erro ao notificar:', err.message)
      }

      recordExecution(scheduledHour)
      runBot()
    } else if (msSinceScheduled > GRACE_WINDOW_MS) {
      // Outside grace window - just alert (too late to recover)
      lastTriggeredByWatchdog.set(watchdogKey, now) // Don't alert again

      console.log(`[WATCHDOG] CRON PERDIDO (fora do grace window): ${scheduledHour}h (${Math.round(msSinceScheduled / 60000)}min atras)`)

      try {
        await sendNotification(
          `[WATCHDOG] <b>Cron Perdido - Alerta</b>\n\n` +
          `Horario: ${scheduledHour}h\n` +
          `Atraso: ${Math.round(msSinceScheduled / 60000)}min\n` +
          `Acao: Nenhuma (fora do grace window de 30min)\n\n` +
          `<i>Considere reiniciar o daemon se isso se repetir.</i>`
        )
      } catch (err) {
        console.error('[WATCHDOG] Erro ao notificar:', err.message)
      }
    }
  }

  // Also check health and learning crons
  if (currentHour > 0 && !todayExecs['health']) {
    // Health check at 00:01 should have run if currentHour > 0
    // Just informational, no auto-trigger for health
  }
}

// ==================== SINGLETON CHECK ====================

function checkSingleton() {
  try {
    // Ensure logs directory exists
    const logsDir = path.join(process.cwd(), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    if (fs.existsSync(PIDFILE)) {
      const oldPid = fs.readFileSync(PIDFILE, 'utf8').trim()
      try {
        execSync(`ps -p ${oldPid} -o comm=`, { stdio: 'pipe' })
        const cmd = execSync(`ps -p ${oldPid} -o args=`, { stdio: 'pipe' }).toString()
        if (cmd.includes('cron-daemon-v2')) {
          console.log(`[WARN] Daemon V2 ja rodando (PID ${oldPid}). Saindo...`)
          process.exit(0)
        }
      } catch {
        // Process doesn't exist - continue
      }
    }

    fs.writeFileSync(PIDFILE, process.pid.toString())

    const cleanup = () => {
      try { fs.unlinkSync(PIDFILE) } catch {}
    }
    process.on('exit', cleanup)
    process.on('SIGINT', () => process.exit(0))
    process.on('SIGTERM', () => process.exit(0))
  } catch (err) {
    console.error('Erro no singleton check:', err.message)
  }
}

checkSingleton()

// ==================== DYNAMIC SCHEDULE ====================

/**
 * Get recommended posting hours based on engagement data
 * Returns hours sorted by engagement score (best first)
 */
function getRecommendedSchedule() {
  try {
    const learnings = loadLearnings()

    // Check if we have enough data
    const totalPosts = learnings.totalPostsAnalyzed || 0
    if (totalPosts < MIN_POSTS_FOR_DYNAMIC_SCHEDULE) {
      console.log(`[SCHEDULE] Dados insuficientes (${totalPosts}/${MIN_POSTS_FOR_DYNAMIC_SCHEDULE} posts). Usando horarios default.`)
      return {
        hours: DEFAULT_HOURS,
        source: 'default',
        reason: `Insuficiente: ${totalPosts} posts analisados`
      }
    }

    // Get hour scores from learnings
    const hourScores = learnings.scores?.hours || {}

    // Filter hours with enough data and sort by score
    const scoredHours = Object.entries(hourScores)
      .filter(([_, data]) => data.count >= 3) // At least 3 posts at that hour
      .map(([hour, data]) => ({
        hour: parseInt(hour),
        score: data.score,
        avgEngagement: data.avgEngagement,
        avgImpressions: data.avgImpressions,
        count: data.count
      }))
      .sort((a, b) => b.score - a.score)

    if (scoredHours.length < 3) {
      console.log(`[SCHEDULE] Poucos horarios com dados (${scoredHours.length}). Usando horarios default.`)
      return {
        hours: DEFAULT_HOURS,
        source: 'default',
        reason: `Poucos horarios: ${scoredHours.length} com dados`
      }
    }

    // Select top 5 hours (or all if less than 5)
    const topHours = scoredHours.slice(0, 5).map(h => h.hour)

    // Sort chronologically for user-friendly display
    topHours.sort((a, b) => a - b)

    console.log(`[SCHEDULE] Horarios dinamicos baseados em ${totalPosts} posts:`)
    scoredHours.slice(0, 5).forEach(h => {
      console.log(`   ${h.hour}h: score ${Math.round(h.score)}, avg engagement ${Math.round(h.avgEngagement)}, ${h.count} posts`)
    })

    return {
      hours: topHours,
      source: 'engagement',
      reason: `Baseado em ${totalPosts} posts`,
      details: scoredHours.slice(0, 5)
    }
  } catch (err) {
    console.error('[SCHEDULE] Erro ao carregar dados de engagement:', err.message)
    return {
      hours: DEFAULT_HOURS,
      source: 'default',
      reason: `Erro: ${err.message}`
    }
  }
}

/**
 * Build schedule array from hours
 */
function buildSchedule(hours) {
  return hours.map(hour => ({
    hour,
    cron: `0 ${hour} * * *`,
    desc: `${hour}h (Daily)`
  }))
}

/**
 * Load or refresh schedule
 */
function loadSchedule() {
  const recommended = getRecommendedSchedule()
  const schedule = buildSchedule(recommended.hours)

  return {
    schedule,
    source: recommended.source,
    reason: recommended.reason,
    details: recommended.details
  }
}

// ==================== HEALTH CHECK ====================

/**
 * Perform health check and alert on issues
 */
async function runHealthCheck() {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  console.log(`\n[HEALTH] [${now}] Executando verificacao de saude...`)

  const issues = []

  // Check 1: Daemon is running (implicit - if we got here, it's running)
  console.log('   [OK] Daemon rodando')

  // Check 2: Chrome connection
  try {
    const chromeStatus = await checkChromeConnection()
    if (chromeStatus.connected) {
      console.log(`   [OK] Chrome conectado (${chromeStatus.version})`)
    } else {
      console.log('   [FAIL] Chrome NAO conectado na porta 9222')
      issues.push('Chrome nao conectado na porta 9222')
    }
  } catch (err) {
    console.log(`   [FAIL] Erro ao verificar Chrome: ${err.message}`)
    issues.push(`Erro Chrome: ${err.message}`)
  }

  // Check 3: PID file exists and matches
  try {
    if (fs.existsSync(PIDFILE)) {
      const pidContent = fs.readFileSync(PIDFILE, 'utf8').trim()
      if (pidContent === process.pid.toString()) {
        console.log('   [OK] PID file correto')
      } else {
        console.log(`   [WARN] PID file diferente (${pidContent} vs ${process.pid})`)
        issues.push('PID file inconsistente')
      }
    } else {
      console.log('   [WARN] PID file nao existe')
      issues.push('PID file ausente')
    }
  } catch (err) {
    console.log(`   [FAIL] Erro ao verificar PID: ${err.message}`)
  }

  // Check 4: Data directory accessible
  const dataDir = path.join(process.cwd(), 'data')
  try {
    if (fs.existsSync(dataDir)) {
      console.log('   [OK] Diretorio data/ acessivel')
    } else {
      console.log('   [WARN] Diretorio data/ nao existe (sera criado no primeiro uso)')
    }
  } catch (err) {
    issues.push(`Erro data/: ${err.message}`)
  }

  // Check 5: Logs directory accessible
  const logsDir = path.join(process.cwd(), 'logs')
  try {
    if (fs.existsSync(logsDir)) {
      console.log('   [OK] Diretorio logs/ acessivel')
    } else {
      fs.mkdirSync(logsDir, { recursive: true })
      console.log('   [OK] Diretorio logs/ criado')
    }
  } catch (err) {
    issues.push(`Erro logs/: ${err.message}`)
  }

  // Send alert if issues found
  if (issues.length > 0) {
    const alertMsg =
      `[HEALTH ALERT] <b>Bot-X-Posts V2</b>\n\n` +
      `<b>Problemas detectados:</b>\n` +
      issues.map(i => `- ${i}`).join('\n') +
      `\n\n<i>Verificacao: ${now}</i>`

    try {
      await sendNotification(alertMsg)
      console.log('   [ALERT] Notificacao enviada no Telegram')
    } catch (err) {
      console.error('   [FAIL] Erro ao enviar alerta:', err.message)
    }
  } else {
    console.log('   [OK] Todos os checks passaram')
  }

  return { success: issues.length === 0, issues }
}

// ==================== SCHEDULE MANAGEMENT ====================

// All topics for each slot
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']
const LANGUAGES = ['en', 'pt-BR']

// Daily learning at 23:59 (analyze posts, adjust weights, send report)
const DAILY_LEARNING = {
  cron: '59 23 * * *',
  desc: '23:59 Daily Learning'
}

// Health check at 00:01
const HEALTH_CHECK = {
  cron: '1 0 * * *',
  desc: '00:01 Health Check'
}

// Reply monitoring every hour (check for comments and respond)
const REPLY_MONITOR = {
  cron: '30 * * * *', // Every hour at :30
  desc: 'Every hour Reply Monitor'
}

// Initialize schedule
let scheduleInfo = loadSchedule()
currentSchedule = scheduleInfo.schedule

// Start anti-suspension heartbeat
startHeartbeat()

console.log('[BOT] Bot-X-Posts Daemon V2 (Multi-Source Bilingual + Learning)')
console.log('='.repeat(60))
console.log(`[SCHEDULE] Horarios: ${currentSchedule.map(s => s.hour + 'h').join(', ')} (${scheduleInfo.source})`)
console.log(`[SCHEDULE] Razao: ${scheduleInfo.reason}`)
console.log(`[TOPICS] Topics: ${TOPICS.join(', ')}`)
console.log(`[LANGUAGES] Languages: ${LANGUAGES.join(', ')}`)
console.log(`[POSTS] Total: ${currentSchedule.length * TOPICS.length * LANGUAGES.length} posts/dia`)
console.log(`[REPLY] Reply monitor: DESATIVADO`)
console.log(`[HEALTH] Health check: 00:01`)
console.log(`[LEARNING] Daily learning cycle: 23:59`)
console.log(`[WATCHDOG] Anti-cron-perdido: ativo (grace window: ${GRACE_WINDOW_MS / 60000}min)`)
console.log(`[RESTART] Auto-restart diario: 00:05`)
console.log(`[START] Iniciado em: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
console.log('='.repeat(60))

// ==================== BOT EXECUTION ====================

async function runBot() {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  const hour = new Date().getHours()
  const totalPosts = TOPICS.length * LANGUAGES.length

  console.log(`\n[START] [${now}] Iniciando geracao de ${totalPosts} posts...`)
  console.log(`   Topics: ${TOPICS.join(', ')}`)
  console.log(`   Languages: ${LANGUAGES.join(', ')}`)

  try {
    await sendNotification(
      `[BOT] <b>Bot-X-Posts V2</b>\n\n` +
      `[TIME] Gerando ${totalPosts} posts das ${hour}h...\n` +
      `[TOPICS] Topics: ${TOPICS.join(', ')}\n` +
      `[LANG] Languages: ${LANGUAGES.join(', ')}\n\n` +
      `[QUEUE] Serao publicados em 2 minutos apos preview.`
    )
  } catch (err) {
    console.error('Erro ao notificar inicio:', err.message)
  }

  // Execute auto-post-v2.js
  const nodePath = '/usr/local/bin/node'
  const child = spawn(nodePath, ['scripts/auto-post-v2.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  })

  child.on('error', (err) => {
    console.error('Erro ao executar bot:', err.message)
  })

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[OK] Bot finalizado com sucesso')
    } else {
      console.log(`[WARN] Bot finalizado com codigo ${code}`)
    }
  })
}

// ==================== DAILY LEARNING EXECUTION ====================

async function runDailyLearning() {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })

  console.log(`\n[LEARNING] [${now}] Iniciando ciclo de aprendizado...`)

  // Execute daily-learning.js
  const nodePath = '/usr/local/bin/node'
  const child = spawn(nodePath, ['scripts/daily-learning.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  })

  child.on('error', (err) => {
    console.error('Erro ao executar learning:', err.message)
  })

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[OK] Learning cycle finalizado com sucesso')

      // Check if schedule should be updated after learning
      checkScheduleUpdate()
    } else {
      console.log(`[WARN] Learning cycle finalizado com codigo ${code}`)
    }
  })
}

// ==================== REPLY MONITORING (DISABLED) ====================
// Focusing on posts + analytics instead

// async function runReplyMonitor() {
//   const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
//   console.log(`\n[REPLY] [${now}] Verificando comentarios e menções...`)
//   try {
//     const result = await processReplies(5, false)
//     console.log(`[REPLY] Processados: ${result.processed}, Respondidos: ${result.replied}`)
//     if (result.replied > 0) {
//       await sendNotification(
//         `[REPLY] <b>Reply Monitor</b>\n\n` +
//         `✅ ${result.replied} respostas enviadas\n` +
//         `📋 ${result.processed} comentarios processados\n\n` +
//         `<i>${now}</i>`
//       )
//     }
//   } catch (err) {
//     console.error(`[REPLY] Erro: ${err.message}`)
//   }
// }

/**
 * Check if schedule should be updated based on new learnings
 */
function checkScheduleUpdate() {
  const newScheduleInfo = loadSchedule()
  const newHours = newScheduleInfo.schedule.map(s => s.hour).sort((a, b) => a - b)
  const currentHours = currentSchedule.map(s => s.hour).sort((a, b) => a - b)

  // Check if hours changed
  const hoursChanged = JSON.stringify(newHours) !== JSON.stringify(currentHours)

  if (hoursChanged) {
    console.log('\n[SCHEDULE] Horarios atualizados pelo learning!')
    console.log(`   Anterior: ${currentHours.map(h => h + 'h').join(', ')}`)
    console.log(`   Novo: ${newHours.map(h => h + 'h').join(', ')}`)
    console.log(`   Razao: ${newScheduleInfo.reason}`)

    // Update schedule (will take effect on next daemon restart)
    // Note: We don't reschedule live cron jobs to avoid complexity
    // Changes will apply when daemon restarts

    sendNotification(
      `[SCHEDULE] <b>Horarios Atualizados</b>\n\n` +
      `Anterior: ${currentHours.map(h => h + 'h').join(', ')}\n` +
      `Novo: ${newHours.map(h => h + 'h').join(', ')}\n\n` +
      `<i>Mudanca aplicada no proximo restart do daemon.</i>`
    ).catch(err => console.error('Erro ao notificar mudanca de horario:', err.message))
  }
}

// ==================== CRON JOBS ====================

// Schedule post jobs
currentSchedule.forEach(({ hour, cron: cronExpr, desc }) => {
  const job = cron.schedule(cronExpr, () => {
    console.log(`\n[CRON] Cron disparado: ${hour}h`)
    recordExecution(hour)
    runBot()
  }, {
    timezone: TIMEZONE
  })

  activeJobs.push({ hour, job })
  console.log(`   [OK] Agendado: ${desc}`)
})

// Schedule health check at 00:01
cron.schedule(HEALTH_CHECK.cron, () => {
  console.log(`\n[CRON] Cron disparado: Health Check`)
  recordExecution('health')
  runHealthCheck()
}, {
  timezone: TIMEZONE
})

console.log(`   [OK] Agendado: ${HEALTH_CHECK.desc}`)

// Schedule daily learning at 23:59
cron.schedule(DAILY_LEARNING.cron, () => {
  console.log(`\n[CRON] Cron disparado: Daily Learning`)
  recordExecution('learning')
  runDailyLearning()
}, {
  timezone: TIMEZONE
})

console.log(`   [OK] Agendado: ${DAILY_LEARNING.desc}`)

// Auto-restart at 00:05 (after learning at 23:59)
// LaunchAgent KeepAlive: true will restart the daemon automatically
cron.schedule('5 0 * * *', async () => {
  const uptimeMs = Date.now() - DAEMON_START_TIME
  const uptimeHours = Math.round(uptimeMs / (1000 * 60 * 60))
  console.log(`\n[AUTO-RESTART] Restart diario programado (uptime: ${uptimeHours}h)`)
  recordExecution('restart')
  try {
    await sendNotification(
      `[AUTO-RESTART] <b>Restart Diario</b>\n\n` +
      `Uptime: ${uptimeHours}h\n` +
      `Acao: process.exit(0)\n` +
      `LaunchAgent vai reiniciar automaticamente.`
    )
  } catch {}
  // Small delay to ensure notification is sent
  setTimeout(() => process.exit(0), 3000)
}, {
  timezone: TIMEZONE
})

console.log(`   [OK] Agendado: 00:05 Auto-Restart (previne timer drift)`)

// Reply monitoring DISABLED - focusing on posts + analytics
// cron.schedule(REPLY_MONITOR.cron, () => {
//   console.log(`\n[CRON] Cron disparado: Reply Monitor`)
//   runReplyMonitor()
// }, {
//   timezone: TIMEZONE
// })

console.log(`   [--] Reply Monitor: DESATIVADO (foco em posts + analytics)`)

// ==================== INTERACTIVE COMMANDS ====================

console.log('\n[RUNNING] Daemon V2 rodando. Ctrl+C para parar.')
console.log('   Comandos: run, learn (l), health (h), schedule (sc), status (s), help (?)\n')

process.stdin.setEncoding('utf8')
process.stdin.on('data', async (input) => {
  const cmd = input.trim().toLowerCase()

  if (cmd === 'run' || cmd === 'r') {
    console.log('[MANUAL] Executando postagem manualmente...')
    runBot()
  } else if (cmd === 'learn' || cmd === 'l') {
    console.log('[MANUAL] Executando ciclo de aprendizado manualmente...')
    runDailyLearning()
  } else if (cmd === 'health' || cmd === 'h') {
    console.log('[MANUAL] Executando health check manualmente...')
    await runHealthCheck()
  } else if (cmd === 'schedule' || cmd === 'sc') {
    // Show current schedule with details
    console.log('\n[SCHEDULE] Horarios dinamicos atuais:')
    console.log(`   Fonte: ${scheduleInfo.source}`)
    console.log(`   Razao: ${scheduleInfo.reason}`)
    console.log('\n   Horarios:')
    currentSchedule.forEach(({ hour }) => {
      const detail = scheduleInfo.details?.find(d => d.hour === hour)
      if (detail) {
        console.log(`   ${hour}h: score ${Math.round(detail.score)}, engagement ${Math.round(detail.avgEngagement)}, ${detail.count} posts`)
      } else {
        console.log(`   ${hour}h: (default)`)
      }
    })
    console.log(`\n   Default hours (fallback): ${DEFAULT_HOURS.map(h => h + 'h').join(', ')}`)
    console.log(`   Min posts para dinamico: ${MIN_POSTS_FOR_DYNAMIC_SCHEDULE}`)
  } else if (cmd === 'status' || cmd === 's') {
    console.log(`[TIME] Hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
    console.log(`[SCHEDULE] Horarios (${scheduleInfo.source}):`)
    currentSchedule.forEach(({ hour }) => {
      console.log(`   ${hour}h: ${TOPICS.length * LANGUAGES.length} posts`)
    })
    console.log(`   00:01: Health Check`)
    console.log(`   23:59: Daily Learning (analyze + adjust + report)`)
    console.log(`[TOTAL] Total diario: ${currentSchedule.length * TOPICS.length * LANGUAGES.length} posts + health + learning`)
  } else if (cmd === 'help' || cmd === '?') {
    console.log('Comandos:')
    console.log('  run (r)      - Executa ciclo de postagem')
    console.log('  learn (l)    - Executa ciclo de aprendizado')
    console.log('  health (h)   - Executa health check')
    console.log('  schedule (sc) - Mostra horarios dinamicos detalhados')
    console.log('  status (s)   - Mostra horarios agendados')
    console.log('  help (?)     - Este menu')
  }
})

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
  console.log('\n\n[SHUTDOWN] Encerrando daemon V2...')
  try {
    await sendNotification('[OFFLINE] <b>Bot-X-Posts V2</b> encerrado.')
  } catch {}
  process.exit(0)
})

// ==================== STARTUP NOTIFICATION ====================

sendNotification(
  `[ONLINE] <b>Bot-X-Posts V2</b> iniciado!\n\n` +
  `[SCHEDULE] Horarios: ${currentSchedule.map(s => s.hour + 'h').join(', ')} (${scheduleInfo.source})\n` +
  `[TOPICS] Topics: ${TOPICS.join(', ')}\n` +
  `[LANG] Languages: EN + PT-BR\n` +
  `[POSTS] ${currentSchedule.length * TOPICS.length * LANGUAGES.length} posts/dia\n` +
  `[HEALTH] Health check: 00:01\n` +
  `[LEARNING] Self-learning at 23:59\n` +
  `[WATCHDOG] Anti-cron-perdido: ativo\n` +
  `[RESTART] Auto-restart: 00:05\n` +
  `[TIMEZONE] Timezone: ${TIMEZONE}`
)
  .then(() => console.log('[TELEGRAM] Notificacao de inicio enviada'))
  .catch(err => console.error('Erro ao notificar:', err.message))
