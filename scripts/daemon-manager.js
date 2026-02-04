#!/usr/bin/env node

/**
 * Daemon Manager - Gerencia o daemon de forma inteligente
 *
 * Comandos:
 *   node daemon-manager.js restart     - Reinicia daemon gracefully
 *   node daemon-manager.js health      - Verifica saude completa
 *   node daemon-manager.js status      - Status simples
 *   node daemon-manager.js emergency   - Reinicio de emergencia
 *   node daemon-manager.js scheduled   - Reinicio agendado (00:05)
 *
 * Integra com:
 *   - PID file em logs/daemon-v2.pid
 *   - Telegram para notificacoes
 *   - Chrome debug port 9222
 */

import 'dotenv/config'
import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ESM dirname fix
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths
const PROJECT_ROOT = path.resolve(__dirname, '..')
const PIDFILE = path.join(PROJECT_ROOT, 'logs', 'daemon-v2.pid')
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs')
const DAEMON_LOG = path.join(PROJECT_ROOT, 'logs', 'daemon-v2.log')
const DAEMON_ERROR_LOG = path.join(PROJECT_ROOT, 'logs', 'daemon-v2-error.log')
const DAEMON_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'cron-daemon-v2.js')
const NODE_PATH = '/usr/local/bin/node'

// Configuracoes
const RESTART_WAIT_MS = 5000
const HEALTH_CHECK_TIMEOUT_MS = 10000
const LOG_RETENTION_DAYS = 7

// ==================== TELEGRAM NOTIFICATION ====================

async function sendTelegramNotification(message) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (!token || !chatId) {
      console.log('[WARN] Telegram nao configurado, pulando notificacao')
      return false
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    })

    return response.ok
  } catch (err) {
    console.error('[ERROR] Erro ao enviar Telegram:', err.message)
    return false
  }
}

// ==================== PID MANAGEMENT ====================

function readPid() {
  try {
    if (fs.existsSync(PIDFILE)) {
      const pid = fs.readFileSync(PIDFILE, 'utf8').trim()
      return parseInt(pid, 10)
    }
    return null
  } catch (err) {
    console.error('[ERROR] Erro ao ler PID:', err.message)
    return null
  }
}

function isProcessRunning(pid) {
  if (!pid) return false

  try {
    // Tenta enviar sinal 0 (verifica se processo existe)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isDaemonProcess(pid) {
  if (!pid || !isProcessRunning(pid)) return false

  try {
    const cmd = execSync(`ps -p ${pid} -o args=`, { stdio: 'pipe' }).toString()
    return cmd.includes('cron-daemon-v2')
  } catch {
    return false
  }
}

// ==================== CHROME CHECK ====================

async function checkChromeConnection() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch('http://127.0.0.1:9222/json/version', {
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      return {
        connected: true,
        version: data.Browser || data['Browser'] || 'Unknown',
        webSocketUrl: data.webSocketDebuggerUrl
      }
    }

    return { connected: false, error: 'Response not OK' }
  } catch (err) {
    return { connected: false, error: err.message }
  }
}

// ==================== LOG MANAGEMENT ====================

function backupLog(logPath) {
  if (!fs.existsSync(logPath)) return null

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const ext = path.extname(logPath)
  const base = path.basename(logPath, ext)
  const backupPath = path.join(LOGS_DIR, `${base}-${timestamp}${ext}`)

  try {
    fs.copyFileSync(logPath, backupPath)
    console.log(`[BACKUP] ${logPath} -> ${backupPath}`)
    return backupPath
  } catch (err) {
    console.error(`[ERROR] Erro ao fazer backup: ${err.message}`)
    return null
  }
}

function cleanOldLogs(days = LOG_RETENTION_DAYS) {
  const now = Date.now()
  const maxAge = days * 24 * 60 * 60 * 1000
  let cleaned = 0

  try {
    const files = fs.readdirSync(LOGS_DIR)

    for (const file of files) {
      // Pula arquivos atuais (sem timestamp no nome)
      if (['daemon-v2.log', 'daemon-v2-error.log', 'daemon-v2.pid',
           'daemon.log', 'daemon-error.log', 'output.log', 'error.log'].includes(file)) {
        continue
      }

      // Pula diretorio de relatorios diarios
      if (file === 'daily-reports') continue

      const filePath = path.join(LOGS_DIR, file)
      const stats = fs.statSync(filePath)

      if (stats.isFile() && (now - stats.mtimeMs) > maxAge) {
        fs.unlinkSync(filePath)
        console.log(`[CLEAN] Removido: ${file}`)
        cleaned++
      }
    }

    console.log(`[CLEAN] ${cleaned} arquivos de log removidos (mais de ${days} dias)`)
    return cleaned
  } catch (err) {
    console.error(`[ERROR] Erro ao limpar logs: ${err.message}`)
    return 0
  }
}

// ==================== LAST POST CHECK ====================

function getLastPostTime() {
  try {
    if (!fs.existsSync(DAEMON_LOG)) return null

    // Le as ultimas linhas do log (mais eficiente que ler tudo)
    const content = fs.readFileSync(DAEMON_LOG, 'utf8')
    const lines = content.split('\n')

    // Pega ultimas 500 linhas para analise
    const recentLines = lines.slice(-500).reverse()

    // Padroes que indicam post bem sucedido
    const postPatterns = [
      'Post publicado',
      'publicado!',
      'Publicado!',
      'posts publicados',
      'Finalizado:'
    ]

    // Procura por padrao de post bem sucedido
    for (const line of recentLines) {
      const hasPostPattern = postPatterns.some(pattern => line.includes(pattern))

      if (hasPostPattern) {
        // Tenta extrair timestamp do log (formato brasileiro)
        // Padrao: [03/02/2026, 19:15:05]
        const brMatch = line.match(/\[(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})\]/)
        if (brMatch) {
          const [, day, month, year, hour, min, sec] = brMatch
          return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`)
        }

        // Padrao ISO: 2026-02-03T19:15:05
        const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
        if (isoMatch) {
          return new Date(isoMatch[1])
        }

        // Se encontrou padrao de post mas nao tem timestamp,
        // usa a data de modificacao do arquivo como aproximacao
        const stats = fs.statSync(DAEMON_LOG)
        return new Date(stats.mtime)
      }
    }

    // Fallback: verifica se log foi modificado recentemente
    // (indica atividade do daemon)
    const stats = fs.statSync(DAEMON_LOG)
    const logAge = Date.now() - stats.mtimeMs

    // Se log foi modificado nas ultimas 4h, retorna essa data
    if (logAge < 4 * 60 * 60 * 1000) {
      return new Date(stats.mtime)
    }

    return null
  } catch (err) {
    console.error('[ERROR] Erro ao verificar ultimo post:', err.message)
    return null
  }
}

function formatTimeSince(date) {
  if (!date) return 'desconhecido'

  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}min atras`
  }
  return `${minutes}min atras`
}

// ==================== DAEMON CONTROL ====================

async function stopDaemon(forceful = false) {
  const pid = readPid()

  if (!pid || !isProcessRunning(pid)) {
    console.log('[INFO] Daemon nao esta rodando')
    return true
  }

  console.log(`[STOP] Parando daemon (PID ${pid})...`)

  try {
    if (forceful) {
      // Kill -9 (SIGKILL)
      process.kill(pid, 'SIGKILL')
      console.log('[STOP] Enviado SIGKILL')
    } else {
      // Kill -15 (SIGTERM) - graceful
      process.kill(pid, 'SIGTERM')
      console.log('[STOP] Enviado SIGTERM')
    }

    // Aguarda processo terminar (max 10s)
    const maxWait = 10000
    const startWait = Date.now()

    while (isProcessRunning(pid) && (Date.now() - startWait) < maxWait) {
      await new Promise(r => setTimeout(r, 500))
    }

    if (isProcessRunning(pid)) {
      console.log('[WARN] Processo ainda rodando, enviando SIGKILL...')
      process.kill(pid, 'SIGKILL')
      await new Promise(r => setTimeout(r, 1000))
    }

    // Remove PID file se ainda existir
    if (fs.existsSync(PIDFILE)) {
      try {
        fs.unlinkSync(PIDFILE)
      } catch {}
    }

    console.log('[STOP] Daemon parado')
    return true

  } catch (err) {
    console.error(`[ERROR] Erro ao parar daemon: ${err.message}`)
    return false
  }
}

function startDaemon() {
  console.log('[START] Iniciando daemon...')

  // Garante que logs dir existe
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }

  // Abre arquivos de log
  const outLog = fs.openSync(DAEMON_LOG, 'a')
  const errLog = fs.openSync(DAEMON_ERROR_LOG, 'a')

  // Spawn daemon detached
  const child = spawn(NODE_PATH, [DAEMON_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', outLog, errLog],
    env: { ...process.env }
  })

  // Desvincula do processo pai
  child.unref()

  console.log(`[START] Daemon iniciado (PID ${child.pid})`)

  // Fecha file descriptors
  fs.closeSync(outLog)
  fs.closeSync(errLog)

  return child.pid
}

async function verifyDaemonStarted(expectedPid, maxWait = 5000) {
  const startTime = Date.now()

  while ((Date.now() - startTime) < maxWait) {
    await new Promise(r => setTimeout(r, 500))

    const pid = readPid()

    // Verifica se o PID file foi criado pelo novo daemon
    if (pid && isDaemonProcess(pid)) {
      console.log(`[VERIFY] Daemon rodando (PID ${pid})`)
      return true
    }
  }

  console.log('[VERIFY] Daemon nao iniciou corretamente')
  return false
}

// ==================== COMMANDS ====================

async function restart() {
  console.log('='.repeat(60))
  console.log('[RESTART] Reiniciando daemon...')
  console.log('='.repeat(60))

  // 1. Para o daemon atual
  const stopped = await stopDaemon()
  if (!stopped) {
    console.log('[ERROR] Falha ao parar daemon')
    await sendTelegramNotification(
      `[DAEMON] <b>Falha no restart</b>\n\nNao foi possivel parar o daemon atual.`
    )
    return false
  }

  // 2. Aguarda 5 segundos
  console.log(`[WAIT] Aguardando ${RESTART_WAIT_MS/1000}s...`)
  await new Promise(r => setTimeout(r, RESTART_WAIT_MS))

  // 3. Inicia novo daemon
  const newPid = startDaemon()

  // 4. Verifica se iniciou
  const started = await verifyDaemonStarted(newPid)

  if (started) {
    console.log('[SUCCESS] Daemon reiniciado com sucesso!')
    await sendTelegramNotification(
      `[DAEMON] <b>Reiniciado</b>\n\n` +
      `PID: ${readPid()}\n` +
      `Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    )
    return true
  } else {
    console.log('[ERROR] Daemon nao iniciou corretamente')
    await sendTelegramNotification(
      `[DAEMON] <b>Falha no restart</b>\n\nDaemon nao iniciou corretamente. Verificar logs.`
    )
    return false
  }
}

async function healthCheck() {
  console.log('='.repeat(60))
  console.log('[HEALTH] Verificando saude do sistema...')
  console.log('='.repeat(60))

  const health = {
    daemon: { ok: false, details: {} },
    chrome: { ok: false, details: {} },
    logs: { ok: false, details: {} },
    lastPost: { ok: false, details: {} }
  }

  // 1. Daemon rodando?
  const pid = readPid()
  health.daemon.details.pid = pid
  health.daemon.details.running = isDaemonProcess(pid)
  health.daemon.ok = health.daemon.details.running

  console.log(`[DAEMON] ${health.daemon.ok ? 'OK' : 'FALHA'} - PID: ${pid || 'N/A'}`)

  // 2. Chrome conectado?
  const chrome = await checkChromeConnection()
  health.chrome.details = chrome
  health.chrome.ok = chrome.connected

  console.log(`[CHROME] ${health.chrome.ok ? 'OK' : 'FALHA'} - ${chrome.connected ? chrome.version : chrome.error}`)

  // 3. Logs existem e tem tamanho razoavel?
  if (fs.existsSync(DAEMON_LOG)) {
    const stats = fs.statSync(DAEMON_LOG)
    health.logs.details.size = stats.size
    health.logs.details.lastModified = stats.mtime
    health.logs.details.sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    health.logs.ok = stats.size > 0 && stats.size < 100 * 1024 * 1024 // < 100MB

    console.log(`[LOGS] ${health.logs.ok ? 'OK' : 'WARN'} - ${health.logs.details.sizeMB}MB, modificado ${new Date(stats.mtime).toLocaleString('pt-BR')}`)
  } else {
    health.logs.details.error = 'Log nao existe'
    console.log(`[LOGS] FALHA - Log nao existe`)
  }

  // 4. Ultimo post/atividade?
  const lastPost = getLastPostTime()
  health.lastPost.details.time = lastPost
  health.lastPost.details.ago = formatTimeSince(lastPost)

  // Considera OK se teve atividade nas ultimas 4 horas
  if (lastPost) {
    const hoursAgo = (Date.now() - lastPost.getTime()) / (1000 * 60 * 60)
    health.lastPost.ok = hoursAgo < 4
  }

  console.log(`[LAST ACTIVITY] ${health.lastPost.ok ? 'OK' : 'WARN'} - ${health.lastPost.details.ago}`)

  // Resume
  console.log('='.repeat(60))
  const allOk = Object.values(health).every(h => h.ok)
  console.log(`[RESULTADO] ${allOk ? 'SISTEMA SAUDAVEL' : 'PROBLEMAS DETECTADOS'}`)
  console.log('='.repeat(60))

  return health
}

async function status() {
  const pid = readPid()
  const running = isDaemonProcess(pid)
  const chrome = await checkChromeConnection()
  const lastPost = getLastPostTime()

  console.log('='.repeat(40))
  console.log('DAEMON STATUS')
  console.log('='.repeat(40))
  console.log(`Daemon:       ${running ? `RODANDO (PID ${pid})` : 'PARADO'}`)
  console.log(`Chrome:       ${chrome.connected ? 'CONECTADO' : 'DESCONECTADO'}`)
  console.log(`Ult atividade: ${formatTimeSince(lastPost)}`)
  console.log(`Hora atual:   ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  console.log('='.repeat(40))

  return { running, pid, chrome: chrome.connected }
}

async function scheduledRestart() {
  console.log('='.repeat(60))
  console.log('[SCHEDULED] Reinicio agendado iniciado...')
  console.log('='.repeat(60))

  const timestamp = new Date().toISOString().slice(0, 10)

  // 1. Backup dos logs
  console.log('[BACKUP] Fazendo backup dos logs...')
  backupLog(DAEMON_LOG)
  backupLog(DAEMON_ERROR_LOG)

  // 2. Reinicia daemon
  const success = await restart()

  // 3. Limpa logs antigos
  if (success) {
    console.log('[CLEAN] Limpando logs antigos...')
    cleanOldLogs(LOG_RETENTION_DAYS)
  }

  // 4. Notifica
  const health = await healthCheck()
  const allOk = Object.values(health).every(h => h.ok)

  await sendTelegramNotification(
    `[SCHEDULED] <b>Reinicio diario</b>\n\n` +
    `Data: ${timestamp}\n` +
    `Status: ${allOk ? 'Sistema saudavel' : 'Problemas detectados'}\n` +
    `Daemon: ${health.daemon.ok ? 'OK' : 'FALHA'}\n` +
    `Chrome: ${health.chrome.ok ? 'OK' : 'FALHA'}`
  )

  return success
}

async function emergencyRestart() {
  console.log('='.repeat(60))
  console.log('[EMERGENCY] REINICIO DE EMERGENCIA')
  console.log('='.repeat(60))

  await sendTelegramNotification(
    `[EMERGENCY] <b>Reinicio de emergencia iniciado!</b>\n\n` +
    `Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
  )

  // 1. Mata todos os processos do daemon
  console.log('[KILL] Matando todos os processos do daemon...')
  try {
    execSync(`pkill -9 -f "cron-daemon-v2" || true`, { stdio: 'pipe' })
  } catch {}

  // 2. Mata processos node orfaos relacionados ao bot
  console.log('[KILL] Matando processos node orfaos...')
  try {
    execSync(`pkill -9 -f "auto-post-v2" || true`, { stdio: 'pipe' })
    execSync(`pkill -9 -f "daily-learning" || true`, { stdio: 'pipe' })
  } catch {}

  // 3. Remove PID file
  if (fs.existsSync(PIDFILE)) {
    try {
      fs.unlinkSync(PIDFILE)
      console.log('[CLEAN] PID file removido')
    } catch {}
  }

  // 4. Aguarda processos morrerem
  console.log('[WAIT] Aguardando 3s...')
  await new Promise(r => setTimeout(r, 3000))

  // 5. Verifica se matou tudo
  try {
    const zombies = execSync(`pgrep -f "cron-daemon-v2" || echo ""`, { stdio: 'pipe' }).toString().trim()
    if (zombies) {
      console.log(`[WARN] Processos ainda vivos: ${zombies}`)
    }
  } catch {}

  // 6. Inicia novo daemon
  console.log('[START] Iniciando daemon limpo...')
  const newPid = startDaemon()

  // 7. Verifica
  await new Promise(r => setTimeout(r, 3000))
  const started = await verifyDaemonStarted(newPid)

  if (started) {
    const health = await healthCheck()
    await sendTelegramNotification(
      `[EMERGENCY] <b>Reinicio concluido</b>\n\n` +
      `PID: ${readPid()}\n` +
      `Daemon: ${health.daemon.ok ? 'OK' : 'FALHA'}\n` +
      `Chrome: ${health.chrome.ok ? 'OK' : 'FALHA'}`
    )
    console.log('[SUCCESS] Reinicio de emergencia concluido!')
    return true
  } else {
    await sendTelegramNotification(
      `[EMERGENCY] <b>FALHA no reinicio!</b>\n\nDaemon nao iniciou. Intervencao manual necessaria.`
    )
    console.log('[FAILURE] Daemon nao iniciou!')
    return false
  }
}

// ==================== CLI ====================

async function main() {
  const command = process.argv[2]

  if (!command) {
    console.log('Daemon Manager - Bot-X-Posts')
    console.log('')
    console.log('Uso: node daemon-manager.js <comando>')
    console.log('')
    console.log('Comandos:')
    console.log('  restart     Reinicia daemon gracefully')
    console.log('  health      Verifica saude completa')
    console.log('  status      Status simples')
    console.log('  scheduled   Reinicio agendado (backup + clean)')
    console.log('  emergency   Reinicio de emergencia (mata tudo)')
    console.log('  stop        Para o daemon')
    console.log('  start       Inicia o daemon')
    process.exit(0)
  }

  let exitCode = 0

  switch (command.toLowerCase()) {
    case 'restart':
      const restarted = await restart()
      exitCode = restarted ? 0 : 1
      break

    case 'health':
      const health = await healthCheck()
      const allHealthy = Object.values(health).every(h => h.ok)
      exitCode = allHealthy ? 0 : 1
      break

    case 'status':
      const stat = await status()
      exitCode = stat.running ? 0 : 1
      break

    case 'scheduled':
      const scheduled = await scheduledRestart()
      exitCode = scheduled ? 0 : 1
      break

    case 'emergency':
      const emergency = await emergencyRestart()
      exitCode = emergency ? 0 : 1
      break

    case 'stop':
      const stopped = await stopDaemon()
      exitCode = stopped ? 0 : 1
      break

    case 'start':
      if (isDaemonProcess(readPid())) {
        console.log('[WARN] Daemon ja esta rodando')
        exitCode = 0
      } else {
        startDaemon()
        await new Promise(r => setTimeout(r, 2000))
        const started = await verifyDaemonStarted()
        exitCode = started ? 0 : 1
      }
      break

    default:
      console.log(`Comando desconhecido: ${command}`)
      console.log('Use: restart, health, status, scheduled, emergency, stop, start')
      exitCode = 1
  }

  process.exit(exitCode)
}

// Exporta funcoes para uso programatico
export {
  restart,
  healthCheck,
  status,
  scheduledRestart,
  emergencyRestart,
  stopDaemon,
  startDaemon,
  checkChromeConnection,
  cleanOldLogs,
  sendTelegramNotification
}

// Roda CLI se executado diretamente
main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
