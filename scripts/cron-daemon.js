import 'dotenv/config'
import cron from 'node-cron'
import { spawn } from 'child_process'
import { sendNotification } from '../src/telegram-v2.js'

const TIMEZONE = 'America/Sao_Paulo'

// Distribuicao de 8 posts/dia:
// - 4 posts de vibeCoding (8h, 12h, 14h, 18h)
// - 2 posts de crypto (8h, 12h)
// - 2 posts de investing (8h, 12h)
const SCHEDULE = [
  {
    hour: 8,
    cron: '0 8 * * 1-5',
    desc: '8h (Seg-Sex)',
    topics: ['crypto', 'investing', 'vibeCoding']  // 3 posts
  },
  {
    hour: 12,
    cron: '0 12 * * 1-5',
    desc: '12h (Seg-Sex)',
    topics: ['crypto', 'investing', 'vibeCoding']  // 3 posts
  },
  {
    hour: 14,
    cron: '0 14 * * 1-5',
    desc: '14h (Seg-Sex)',
    topics: ['vibeCoding']  // 1 post vibeCoding
  },
  {
    hour: 18,
    cron: '0 18 * * 1-5',
    desc: '18h (Seg-Sex)',
    topics: ['vibeCoding']  // 1 post vibeCoding
  }
]

console.log('🤖 Bot-X-Posts Daemon')
console.log('='.repeat(50))
console.log(`⏰ Horarios: 8h, 12h, 14h, 18h (Seg-Sex)`)
console.log(`📊 Total: 8 posts/dia (4 vibeCoding, 2 crypto, 2 investing)`)
console.log(`📅 Iniciado em: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
console.log('='.repeat(50))

// Funcao que executa o bot interativo com topicos especificos
async function runBot(topics = ['crypto', 'investing', 'vibeCoding']) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  const hour = new Date().getHours()
  console.log(`\n🚀 [${now}] Iniciando geracao de ${topics.length} posts...`)
  console.log(`   Topicos: ${topics.join(', ')}`)

  try {
    await sendNotification(`🤖 <b>Bot-X-Posts</b>\n\n⏰ Gerando ${topics.length} posts das ${hour}h...\n📋 Topicos: ${topics.join(', ')}\n\n📤 Serao publicados em 2 minutos apos preview.`)
  } catch (err) {
    console.error('Erro ao notificar inicio:', err.message)
  }

  // Executa o script auto-post (simplificado - sem callbacks do Telegram)
  // Usa caminho absoluto para node (launchd nao tem PATH completo)
  const nodePath = '/usr/local/bin/node'
  const child = spawn(nodePath, ['scripts/auto-post.js', ...topics], {
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

// Agenda os jobs
SCHEDULE.forEach(({ hour, cron: cronExpr, topics }) => {
  cron.schedule(cronExpr, () => {
    console.log(`\n⏰ Cron disparado: ${hour}h`)
    console.log(`   Topicos: ${topics.join(', ')}`)
    runBot(topics)
  }, {
    timezone: TIMEZONE
  })

  console.log(`   ✅ Agendado: ${hour}h (${topics.length} posts: ${topics.join(', ')})`)
})

// Mantém o processo rodando
console.log('\n🟢 Daemon rodando. Ctrl+C para parar.')
console.log('   Proximo horario sera executado automaticamente.\n')

// Comando manual para testar
process.stdin.setEncoding('utf8')
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase()
  if (cmd === 'run' || cmd === 'r') {
    // Descobre qual horario usar baseado na hora atual
    const currentHour = new Date().getHours()
    let topics = ['crypto', 'investing', 'vibeCoding']  // default (8h, 12h)
    if (currentHour >= 13 && currentHour < 17) {
      topics = ['vibeCoding']  // 14h
    } else if (currentHour >= 17) {
      topics = ['vibeCoding']  // 18h
    }
    console.log('📤 Executando manualmente...')
    runBot(topics)
  } else if (cmd.startsWith('run ')) {
    // run crypto,vibeCoding - permite especificar topicos
    const topics = cmd.replace('run ', '').split(',').map(t => t.trim())
    console.log(`📤 Executando com topicos: ${topics.join(', ')}`)
    runBot(topics)
  } else if (cmd === 'status' || cmd === 's') {
    console.log(`⏰ Hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
    console.log(`📅 Proximos horarios:`)
    SCHEDULE.forEach(({ hour, topics }) => {
      console.log(`   ${hour}h: ${topics.join(', ')}`)
    })
  } else if (cmd === 'help' || cmd === 'h') {
    console.log('Comandos:')
    console.log('  run (r)              - Executa com topicos do horario atual')
    console.log('  run crypto,vibeCoding - Executa com topicos especificos')
    console.log('  status (s)           - Mostra horarios agendados')
    console.log('  help (h)             - Este menu')
  }
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Encerrando daemon...')
  try {
    await sendNotification('🔴 <b>Bot-X-Posts</b> encerrado.')
  } catch {}
  process.exit(0)
})

// Notifica inicio
sendNotification(`🟢 <b>Bot-X-Posts</b> iniciado!\n\n⏰ Horarios: 8h, 12h, 14h, 18h (Seg-Sex)\n📊 8 posts/dia (4 vibeCoding, 2 crypto, 2 investing)\n📍 Timezone: ${TIMEZONE}`)
  .then(() => console.log('📱 Notificacao de inicio enviada'))
  .catch(err => console.error('Erro ao notificar:', err.message))
