/**
 * Cron Daemon V2 - Multi-Source Bilingual Bot
 *
 * Schedule: 5 time slots per day (8h, 12h, 18h, 22h, 0h)
 * Posts: 8 per slot (4 topics × 2 languages)
 * Days: Every day (0-6)
 * Total: 40 posts/day
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
          console.log(`⚠️ Daemon V2 já rodando (PID ${oldPid}). Saindo...`)
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
// Each slot posts 4 topics × 2 languages = 8 posts
const SCHEDULE = [
  { hour: 0,  cron: '0 0 * * *',  desc: '0h (Daily)' },
  { hour: 8,  cron: '0 8 * * *',  desc: '8h (Daily)' },
  { hour: 12, cron: '0 12 * * *', desc: '12h (Daily)' },
  { hour: 18, cron: '0 18 * * *', desc: '18h (Daily)' },
  { hour: 22, cron: '0 22 * * *', desc: '22h (Daily)' }
]

// All topics for each slot
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']
const LANGUAGES = ['en', 'pt-BR']

console.log('🤖 Bot-X-Posts Daemon V2 (Multi-Source Bilingual)')
console.log('='.repeat(60))
console.log(`⏰ Horarios: ${SCHEDULE.map(s => s.hour + 'h').join(', ')} (Daily)`)
console.log(`📊 Topics: ${TOPICS.join(', ')}`)
console.log(`🌍 Languages: ${LANGUAGES.join(', ')}`)
console.log(`📈 Total: ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts/dia`)
console.log(`📅 Iniciado em: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
console.log('='.repeat(60))

// ==================== BOT EXECUTION ====================

async function runBot() {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  const hour = new Date().getHours()
  const totalPosts = TOPICS.length * LANGUAGES.length

  console.log(`\n🚀 [${now}] Iniciando geração de ${totalPosts} posts...`)
  console.log(`   Topics: ${TOPICS.join(', ')}`)
  console.log(`   Languages: ${LANGUAGES.join(', ')}`)

  try {
    await sendNotification(
      `🤖 <b>Bot-X-Posts V2</b>\n\n` +
      `⏰ Gerando ${totalPosts} posts das ${hour}h...\n` +
      `📋 Topics: ${TOPICS.join(', ')}\n` +
      `🌍 Languages: ${LANGUAGES.join(', ')}\n\n` +
      `📤 Serão publicados em 2 minutos após preview.`
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
      console.log('✅ Bot finalizado com sucesso')
    } else {
      console.log(`⚠️ Bot finalizado com codigo ${code}`)
    }
  })
}

// ==================== CRON JOBS ====================

SCHEDULE.forEach(({ hour, cron: cronExpr, desc }) => {
  cron.schedule(cronExpr, () => {
    console.log(`\n⏰ Cron disparado: ${hour}h`)
    runBot()
  }, {
    timezone: TIMEZONE
  })

  console.log(`   ✅ Agendado: ${desc}`)
})

// ==================== INTERACTIVE COMMANDS ====================

console.log('\n🟢 Daemon V2 rodando. Ctrl+C para parar.')
console.log('   Comandos: run, status (s), help (h)\n')

process.stdin.setEncoding('utf8')
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase()

  if (cmd === 'run' || cmd === 'r') {
    console.log('📤 Executando manualmente...')
    runBot()
  } else if (cmd === 'status' || cmd === 's') {
    console.log(`⏰ Hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
    console.log(`📅 Proximos horarios:`)
    SCHEDULE.forEach(({ hour, desc }) => {
      console.log(`   ${hour}h: ${TOPICS.length * LANGUAGES.length} posts`)
    })
    console.log(`📊 Total diario: ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts`)
  } else if (cmd === 'help' || cmd === 'h') {
    console.log('Comandos:')
    console.log('  run (r)    - Executa ciclo completo')
    console.log('  status (s) - Mostra horarios agendados')
    console.log('  help (h)   - Este menu')
  }
})

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
  console.log('\n\n👋 Encerrando daemon V2...')
  try {
    await sendNotification('🔴 <b>Bot-X-Posts V2</b> encerrado.')
  } catch {}
  process.exit(0)
})

// ==================== STARTUP NOTIFICATION ====================

sendNotification(
  `🟢 <b>Bot-X-Posts V2</b> iniciado!\n\n` +
  `⏰ Horarios: ${SCHEDULE.map(s => s.hour + 'h').join(', ')} (Daily)\n` +
  `📊 Topics: ${TOPICS.join(', ')}\n` +
  `🌍 Languages: EN + PT-BR\n` +
  `📈 ${SCHEDULE.length * TOPICS.length * LANGUAGES.length} posts/dia\n` +
  `📍 Timezone: ${TIMEZONE}`
)
  .then(() => console.log('📱 Notificação de inicio enviada'))
  .catch(err => console.error('Erro ao notificar:', err.message))
