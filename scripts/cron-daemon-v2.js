/**
 * Cron Daemon V2 - Multi-Source Bilingual Bot
 *
 * Schedule: 5 time slots per day (8h, 12h, 18h, 22h, 0h)
 * Posts: 8 per slot (4 topics x 2 languages)
 * Days: Every day (0-6)
 * Total: 40 posts/day
 *
 * Learning: Runs at 23:59 to analyze engagement and adjust weights
 */

import 'dotenv/config'
import cron from 'node-cron'
import { spawn, execSync } from 'child_process'
import { sendNotification } from '../src/telegram-v2.js'
import fs from 'fs'
import path from 'path'

const TIMEZONE = 'America/Sao_Paulo'
const PIDFILE = path.join(process.cwd(), 'logs', 'daemon-v2.pid')

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

// ==================== SCHEDULE ====================

// 5 slots per day, every day (0-6 = Sunday-Saturday)
// Each slot posts 4 topics x 2 languages = 8 posts
const SCHEDULE = [
  { hour: 0,  cron: '0 0 * * *',  desc: '0h (Daily)' },
  { hour: 8,  cron: '0 8 * * *',  desc: '8h (Daily)' },
  { hour: 12, cron: '0 12 * * *', desc: '12h (Daily)' },
  { hour: 18, cron: '0 18 * * *', desc: '18h (Daily)' },
  { hour: 22, cron: '0 22 * * *', desc: '22h (Daily)' }
]

// Daily learning at 23:59 (analyze posts, adjust weights, send report)
const DAILY_LEARNING = {
  cron: '59 23 * * *',
  desc: '23:59 Daily Learning'
}

// All topics for each slot
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']
const LANGUAGES = ['en', 'pt-BR']

console.log('[BOT] Bot-X-Posts Daemon V2 (Multi-Source Bilingual + Learning)')
console.log('='.repeat(60))
console.log(`[SCHEDULE] Horarios: ${SCHEDULE.map(s => s.hour + 'h').join(', ')} (Daily)`)
console.log(`[TOPICS] Topics: ${TOPICS.join(', ')}`)
console.log(`[LANGUAGES] Languages: ${LANGUAGES.join(', ')}`)
console.log(`[POSTS] Total: ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts/dia`)
console.log(`[LEARNING] Daily learning cycle: 23:59`)
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
    } else {
      console.log(`[WARN] Learning cycle finalizado com codigo ${code}`)
    }
  })
}

// ==================== CRON JOBS ====================

// Schedule post jobs
SCHEDULE.forEach(({ hour, cron: cronExpr, desc }) => {
  cron.schedule(cronExpr, () => {
    console.log(`\n[CRON] Cron disparado: ${hour}h`)
    runBot()
  }, {
    timezone: TIMEZONE
  })

  console.log(`   [OK] Agendado: ${desc}`)
})

// Schedule daily learning at 23:59
cron.schedule(DAILY_LEARNING.cron, () => {
  console.log(`\n[CRON] Cron disparado: Daily Learning`)
  runDailyLearning()
}, {
  timezone: TIMEZONE
})

console.log(`   [OK] Agendado: ${DAILY_LEARNING.desc}`)

// ==================== INTERACTIVE COMMANDS ====================

console.log('\n[RUNNING] Daemon V2 rodando. Ctrl+C para parar.')
console.log('   Comandos: run, learn (l), status (s), help (h)\n')

process.stdin.setEncoding('utf8')
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase()

  if (cmd === 'run' || cmd === 'r') {
    console.log('[MANUAL] Executando postagem manualmente...')
    runBot()
  } else if (cmd === 'learn' || cmd === 'l') {
    console.log('[MANUAL] Executando ciclo de aprendizado manualmente...')
    runDailyLearning()
  } else if (cmd === 'status' || cmd === 's') {
    console.log(`[TIME] Hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
    console.log(`[SCHEDULE] Proximos horarios:`)
    SCHEDULE.forEach(({ hour, desc }) => {
      console.log(`   ${hour}h: ${TOPICS.length * LANGUAGES.length} posts`)
    })
    console.log(`   23:59: Daily Learning (analyze + adjust + report)`)
    console.log(`[TOTAL] Total diario: ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts + 1 learning report`)
  } else if (cmd === 'help' || cmd === 'h') {
    console.log('Comandos:')
    console.log('  run (r)   - Executa ciclo de postagem')
    console.log('  learn (l) - Executa ciclo de aprendizado')
    console.log('  status (s) - Mostra horarios agendados')
    console.log('  help (h)   - Este menu')
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
  `[SCHEDULE] Horarios: ${SCHEDULE.map(s => s.hour + 'h').join(', ')} (Daily)\n` +
  `[TOPICS] Topics: ${TOPICS.join(', ')}\n` +
  `[LANG] Languages: EN + PT-BR\n` +
  `[POSTS] ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts/dia\n` +
  `[LEARNING] Self-learning at 23:59\n` +
  `[TIMEZONE] Timezone: ${TIMEZONE}`
)
  .then(() => console.log('[TELEGRAM] Notificacao de inicio enviada'))
  .catch(err => console.error('Erro ao notificar:', err.message))
