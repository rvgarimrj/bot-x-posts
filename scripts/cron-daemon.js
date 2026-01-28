import 'dotenv/config'
import cron from 'node-cron'
import { spawn } from 'child_process'
import { sendNotification } from '../src/telegram-v2.js'

const TIMEZONE = 'America/Sao_Paulo'
const SCHEDULE = [
  { hour: 12, cron: '0 12 * * 1-5', desc: '12h (Seg-Sex)' }
]

console.log('🤖 Bot-X-Posts Daemon')
console.log('='.repeat(50))
console.log(`⏰ Horario: 12h apenas dias úteis (Seg-Sex)`)
console.log(`📅 Iniciado em: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
console.log('='.repeat(50))

// Funcao que executa o bot interativo
async function runBot() {
  const now = new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })
  console.log(`\n🚀 [${now}] Iniciando geracao de posts...`)

  try {
    await sendNotification(`🤖 <b>Bot-X-Posts</b>\n\n⏰ Gerando posts das ${new Date().getHours()}h...\nAguarde as opcoes.`)
  } catch (err) {
    console.error('Erro ao notificar inicio:', err.message)
  }

  // Executa o script interativo v2 como processo filho
  const child = spawn('node', ['scripts/interactive-post-v2.js'], {
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
SCHEDULE.forEach(({ hour, cron: cronExpr }) => {
  cron.schedule(cronExpr, () => {
    console.log(`\n⏰ Cron disparado: ${hour}h`)
    runBot()
  }, {
    timezone: TIMEZONE
  })

  console.log(`   ✅ Agendado: ${hour}h`)
})

// Mantém o processo rodando
console.log('\n🟢 Daemon rodando. Ctrl+C para parar.')
console.log('   Proximo horario sera executado automaticamente.\n')

// Comando manual para testar
process.stdin.setEncoding('utf8')
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase()
  if (cmd === 'run' || cmd === 'r') {
    console.log('📤 Executando manualmente...')
    runBot()
  } else if (cmd === 'status' || cmd === 's') {
    console.log(`⏰ Hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`)
    console.log(`📅 Proximos horarios: 12h (Seg-Sex)`)
  } else if (cmd === 'help' || cmd === 'h') {
    console.log('Comandos: run (r), status (s), help (h)')
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
sendNotification(`🟢 <b>Bot-X-Posts</b> iniciado!\n\n⏰ Horarios: 12h (Seg-Sex)\n📍 Timezone: ${TIMEZONE}`)
  .then(() => console.log('📱 Notificacao de inicio enviada'))
  .catch(err => console.error('Erro ao notificar:', err.message))
