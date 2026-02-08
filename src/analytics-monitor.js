/**
 * Analytics Monitor for Bot-X-Posts
 *
 * Coleta metricas diarias do X Analytics e calcula projecoes
 * para atingir metas de crescimento.
 *
 * Metas:
 * - 5M impressoes em 3 meses (~55k/dia)
 * - 500 Premium followers
 * - 2000 verified followers
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuracoes
const ANALYTICS_URL = 'https://x.com/i/account_analytics'
const DATA_DIR = path.join(__dirname, '..', 'data')
const HISTORY_FILE = path.join(DATA_DIR, 'analytics-history.json')
const TIMEZONE = 'America/Sao_Paulo'

/**
 * Get today's date string in BRT timezone (YYYY-MM-DD)
 */
function getTodayBRT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

// Metas de crescimento
const GOALS = {
  impressions: {
    target: 5_000_000,
    timeframeDays: 90,
    dailyTarget: Math.ceil(5_000_000 / 90) // ~55,556/dia
  },
  premiumFollowers: {
    target: 500,
    timeframeDays: 90
  },
  verifiedFollowers: {
    target: 2000,
    timeframeDays: 90
  }
}

// Configuracoes de conexao (mesmo padrao do puppeteer-post.js)
const MAX_CONNECTION_RETRIES = 3
const RETRY_DELAY_MS = 5000
const PROTOCOL_TIMEOUT = 120000
const PAGE_TIMEOUT = 60000

/**
 * Conecta ao Chrome com retry automatico
 */
async function connectToChrome() {
  for (let attempt = 1; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
    try {
      console.log(`   Tentativa ${attempt}/${MAX_CONNECTION_RETRIES}...`)
      const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null,
        protocolTimeout: PROTOCOL_TIMEOUT
      })
      return browser
    } catch (err) {
      const isTimeout = err.message.includes('timed out')

      if (isTimeout && attempt < MAX_CONNECTION_RETRIES) {
        console.log(`   Timeout na conexao, aguardando ${RETRY_DELAY_MS / 1000}s...`)
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      if (attempt === MAX_CONNECTION_RETRIES) {
        console.error('Erro ao conectar ao Chrome:', err.message)
        throw new Error('Chrome nao esta rodando em modo debug na porta 9222')
      }
    }
  }
}

/**
 * Carrega historico de analytics do arquivo JSON
 */
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Erro ao carregar historico:', err.message)
  }
  return { entries: [], startDate: null, goals: GOALS }
}

/**
 * Salva historico de analytics no arquivo JSON
 */
function saveHistory(history) {
  try {
    // Garante que diretorio existe
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
    console.log(`   Historico salvo em ${HISTORY_FILE}`)
  } catch (err) {
    console.error('Erro ao salvar historico:', err.message)
    throw err
  }
}

/**
 * Extrai numero de uma string (remove virgulas, pontos, etc)
 */
function parseMetricValue(text) {
  if (!text) return 0

  // Remove caracteres nao numericos exceto K, M, B para sufixos
  const cleaned = text.trim().toUpperCase()

  // Trata sufixos K, M, B
  if (cleaned.endsWith('K')) {
    return Math.round(parseFloat(cleaned.replace('K', '')) * 1000)
  }
  if (cleaned.endsWith('M')) {
    return Math.round(parseFloat(cleaned.replace('M', '')) * 1_000_000)
  }
  if (cleaned.endsWith('B')) {
    return Math.round(parseFloat(cleaned.replace('B', '')) * 1_000_000_000)
  }

  // Remove virgulas e pontos usados como separadores de milhar
  const numStr = cleaned.replace(/[,\.]/g, '').replace(/[^0-9-]/g, '')
  return parseInt(numStr, 10) || 0
}

/**
 * Extrai metricas da pagina de analytics do X
 */
async function extractMetrics(page) {
  console.log('   Extraindo metricas da pagina...')

  // Aguarda pagina carregar completamente
  await new Promise(r => setTimeout(r, 5000))

  const metrics = await page.evaluate(() => {
    const result = {
      impressions: 0,
      engagements: 0,
      newFollowers: 0,
      profileVisits: 0,
      mentions: 0,
      linkClicks: 0,
      retweets: 0,
      likes: 0,
      replies: 0,
      rawData: {}
    }

    // Helper: extrai numero de string (suporta K, M, B, virgulas, pontos)
    const extractNumber = (text) => {
      if (!text) return null
      const cleaned = text.trim().toUpperCase()
      if (cleaned.endsWith('K')) {
        return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1000)
      }
      if (cleaned.endsWith('M')) {
        return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1_000_000)
      }
      if (cleaned.endsWith('B')) {
        return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1_000_000_000)
      }
      const numStr = cleaned.replace(/[,\.]/g, '').replace(/[^0-9]/g, '')
      return parseInt(numStr, 10) || null
    }

    // Helper: encontra metrica por label (mais robusto)
    const findMetricNearLabel = (labels) => {
      for (const label of labels) {
        // Procura em todos os elementos de texto
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        )
        let node
        while (node = walker.nextNode()) {
          if (node.textContent.toLowerCase().includes(label.toLowerCase())) {
            // Procura numero no elemento pai, avos, ou irmaos
            let current = node.parentElement
            for (let depth = 0; depth < 4 && current; depth++) {
              // Procura numeros no container
              const allText = current.innerText || ''
              const lines = allText.split('\n').map(l => l.trim()).filter(Boolean)
              for (const line of lines) {
                if (/^[\d,\.]+[KMB]?$/i.test(line)) {
                  const num = extractNumber(line)
                  if (num !== null && num > 0) {
                    return line
                  }
                }
              }
              current = current.parentElement
            }
          }
        }
      }
      return null
    }

    // Abordagem 1: Busca estruturada por cards/metricas
    const cards = document.querySelectorAll('[data-testid], [role="group"], section, article')
    cards.forEach(card => {
      const text = card.innerText || ''
      const textLower = text.toLowerCase()

      // Procura numeros no card
      const numbers = text.match(/[\d,\.]+[KMB]?/gi) || []

      if (textLower.includes('impression') || textLower.includes('impresso') || textLower.includes('visualiza')) {
        const num = numbers.find(n => extractNumber(n) > 100) // Impressions geralmente > 100
        if (num) result.rawData.impressions = num
      }

      if (textLower.includes('engagement') || textLower.includes('engajament') || textLower.includes('interac')) {
        const num = numbers.find(n => extractNumber(n) > 0)
        if (num && !result.rawData.engagements) result.rawData.engagements = num
      }

      if ((textLower.includes('follower') || textLower.includes('seguidor')) && !textLower.includes('following')) {
        const num = numbers.find(n => extractNumber(n) > 0)
        if (num && !result.rawData.newFollowers) result.rawData.newFollowers = num
      }

      if (textLower.includes('profile visit') || textLower.includes('visita ao perfil') || textLower.includes('visita')) {
        const num = numbers.find(n => extractNumber(n) > 0)
        if (num && !result.rawData.profileVisits) result.rawData.profileVisits = num
      }
    })

    // Abordagem 2: Busca por labels comuns
    if (!result.rawData.impressions) {
      result.rawData.impressions = findMetricNearLabel(['impressions', 'impressoes', 'impressões', 'views', 'visualizacoes'])
    }
    if (!result.rawData.engagements) {
      result.rawData.engagements = findMetricNearLabel(['engagements', 'engajamentos', 'interactions', 'interacoes'])
    }
    if (!result.rawData.newFollowers) {
      result.rawData.newFollowers = findMetricNearLabel(['new followers', 'novos seguidores', 'followers', 'seguidores'])
    }
    if (!result.rawData.profileVisits) {
      result.rawData.profileVisits = findMetricNearLabel(['profile visits', 'visitas ao perfil', 'visitas'])
    }

    // Abordagem 3: Busca todos os numeros grandes (heuristica para impressions)
    const allText = document.body.innerText
    const bigNumbers = allText.match(/[\d,\.]+[KMB]|[\d]{4,}/gi) || []
    result.rawData.allNumbers = bigNumbers.slice(0, 10)

    // Se ainda nao temos impressions, pega o maior numero da pagina
    if (!result.rawData.impressions && bigNumbers.length > 0) {
      const sorted = bigNumbers
        .map(n => ({ raw: n, val: extractNumber(n) }))
        .filter(n => n.val !== null && n.val > 100)
        .sort((a, b) => b.val - a.val)
      if (sorted.length > 0) {
        result.rawData.impressions = sorted[0].raw
      }
    }

    return result
  })

  // Processa os valores extraidos
  const processed = {
    impressions: parseMetricValue(metrics.rawData.impressions) || 0,
    engagements: parseMetricValue(metrics.rawData.engagements) || 0,
    newFollowers: parseMetricValue(metrics.rawData.newFollowers) || 0,
    profileVisits: parseMetricValue(metrics.rawData.profileVisits) || 0,
    rawData: metrics.rawData
  }

  return processed
}

/**
 * Calcula comparacao com dia anterior
 */
function calculateComparison(current, previous) {
  if (!previous) {
    return {
      impressions: { change: 0, percent: 0 },
      engagements: { change: 0, percent: 0 },
      newFollowers: { change: 0, percent: 0 },
      profileVisits: { change: 0, percent: 0 }
    }
  }

  const calc = (curr, prev) => {
    const change = curr - prev
    const percent = prev > 0 ? ((change / prev) * 100).toFixed(1) : 0
    return { change, percent: parseFloat(percent) }
  }

  return {
    impressions: calc(current.impressions, previous.impressions),
    engagements: calc(current.engagements, previous.engagements),
    newFollowers: calc(current.newFollowers, previous.newFollowers),
    profileVisits: calc(current.profileVisits, previous.profileVisits)
  }
}

/**
 * Calcula projecao para atingir meta de 5M impressoes
 */
function calculateProjection(history) {
  const entries = history.entries
  if (entries.length < 2) {
    return {
      dailyAverage: 0,
      daysToGoal: null,
      projectedDate: null,
      onTrack: false,
      totalImpressions: entries[0]?.metrics?.impressions || 0,
      percentComplete: 0
    }
  }

  // Calcula media diaria das ultimas 7 entradas (ou todas se menos)
  const recentEntries = entries.slice(-7)
  const dailyImpressions = []

  for (let i = 1; i < recentEntries.length; i++) {
    const diff = recentEntries[i].metrics.impressions - recentEntries[i - 1].metrics.impressions
    if (diff > 0) {
      dailyImpressions.push(diff)
    }
  }

  const dailyAverage = dailyImpressions.length > 0
    ? Math.round(dailyImpressions.reduce((a, b) => a + b, 0) / dailyImpressions.length)
    : 0

  // Calcula total de impressoes acumuladas
  const latestEntry = entries[entries.length - 1]
  const firstEntry = entries[0]
  const totalImpressions = latestEntry.metrics.impressions
  const impressionsInPeriod = totalImpressions - (firstEntry?.metrics?.impressions || 0)

  // Calcula dias restantes e data projetada
  const remaining = GOALS.impressions.target - impressionsInPeriod
  const daysToGoal = dailyAverage > 0 ? Math.ceil(remaining / dailyAverage) : null

  let projectedDate = null
  if (daysToGoal !== null && daysToGoal > 0) {
    const date = new Date()
    date.setDate(date.getDate() + daysToGoal)
    projectedDate = date.toISOString().split('T')[0]
  }

  // Verifica se esta no ritmo
  const daysElapsed = entries.length
  const expectedImpressions = GOALS.impressions.dailyTarget * daysElapsed
  const onTrack = impressionsInPeriod >= expectedImpressions * 0.8 // 80% da meta

  const percentComplete = ((impressionsInPeriod / GOALS.impressions.target) * 100).toFixed(2)

  return {
    dailyAverage,
    daysToGoal,
    projectedDate,
    onTrack,
    totalImpressions: impressionsInPeriod,
    percentComplete: parseFloat(percentComplete),
    dailyTarget: GOALS.impressions.dailyTarget,
    remaining
  }
}

/**
 * Gera relatorio de analytics
 */
function generateReport(entry, comparison, projection) {
  const date = new Date().toLocaleDateString('pt-BR')
  const time = new Date().toLocaleTimeString('pt-BR')

  // Helper function to safely format numbers
  const safeLocale = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '0'
    return val.toLocaleString()
  }

  const metrics = entry?.metrics || {}
  const comp = comparison || {}
  const proj = projection || {}

  let report = `
=====================================
   ANALYTICS REPORT - ${date} ${time}
=====================================

METRICAS DO DIA:
  Impressoes:     ${safeLocale(metrics.impressions)}
  Engajamentos:   ${safeLocale(metrics.engagements)}
  Novos seguid.:  ${safeLocale(metrics.newFollowers)}
  Visitas perfil: ${safeLocale(metrics.profileVisits)}

COMPARACAO COM DIA ANTERIOR:
  Impressoes:     ${(comp.impressions?.change || 0) >= 0 ? '+' : ''}${safeLocale(comp.impressions?.change)} (${comp.impressions?.percent || 0}%)
  Engajamentos:   ${(comp.engagements?.change || 0) >= 0 ? '+' : ''}${safeLocale(comp.engagements?.change)} (${comp.engagements?.percent || 0}%)
  Novos seguid.:  ${(comp.newFollowers?.change || 0) >= 0 ? '+' : ''}${safeLocale(comp.newFollowers?.change)} (${comp.newFollowers?.percent || 0}%)
  Visitas perfil: ${(comp.profileVisits?.change || 0) >= 0 ? '+' : ''}${safeLocale(comp.profileVisits?.change)} (${comp.profileVisits?.percent || 0}%)

PROJECAO PARA META (5M impressoes):
  Media diaria:   ${safeLocale(proj.dailyAverage)} impressoes
  Meta diaria:    ${safeLocale(proj.dailyTarget || GOALS.impressions.dailyTarget)} impressoes
  Total acumul.:  ${safeLocale(proj.totalImpressions)} (${proj.percentComplete || 0}%)
  Faltam:         ${proj.remaining ? safeLocale(proj.remaining) : 'N/A'} impressoes
  Dias restantes: ${proj.daysToGoal || 'N/A'}
  Data projetada: ${proj.projectedDate || 'N/A'}
  Status:         ${proj.onTrack ? 'NO RITMO' : 'ABAIXO DA META'}

=====================================
`

  return report
}

/**
 * Coleta analytics diarios do X
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function collectDailyAnalytics() {
  let browser = null

  try {
    console.log('Analytics Monitor - Coletando metricas diarias')
    console.log('================================================')

    // Carrega historico existente
    const history = loadHistory()
    if (!history.startDate) {
      history.startDate = getTodayBRT()
    }

    // Conecta ao Chrome
    console.log('\n1. Conectando ao Chrome...')
    browser = await connectToChrome()
    console.log('   Conectado!')

    // Pega todas as paginas abertas
    const pages = await browser.pages()
    console.log(`   ${pages.length} abas encontradas`)

    // Procura uma aba do X logada ou abre nova
    let page = null
    for (const p of pages) {
      const url = p.url()
      if ((url.includes('x.com') || url.includes('twitter.com')) &&
          !url.includes('/login') && !url.includes('/i/flow/login')) {
        page = p
        break
      }
    }

    if (!page) {
      console.log('   Abrindo nova aba...')
      page = await browser.newPage()
    }

    // Configura timeouts
    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    // Navega para pagina de analytics
    console.log('\n2. Navegando para Analytics...')
    await page.bringToFront()
    await page.goto(ANALYTICS_URL, { waitUntil: 'networkidle2', timeout: 30000 })

    // Aguarda pagina carregar
    console.log('   Aguardando pagina carregar...')
    await new Promise(r => setTimeout(r, 5000))

    // Verifica se esta logado
    const currentUrl = page.url()
    if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
      throw new Error('Nao esta logado no X. Faca login no Chrome primeiro.')
    }

    // Extrai metricas
    console.log('\n3. Extraindo metricas...')
    const metrics = await extractMetrics(page)

    // Staleness detection: check if values are identical to previous entries
    const prevEntries = history.entries.slice(-3)
    const isStale = prevEntries.length >= 2 && prevEntries.every(prev =>
      prev.metrics.impressions === metrics.impressions &&
      prev.metrics.engagements === metrics.engagements &&
      prev.metrics.newFollowers === metrics.newFollowers &&
      prev.metrics.profileVisits === metrics.profileVisits
    )

    if (isStale) {
      console.log('   WARNING: Analytics values unchanged for 3+ days - data likely stale/unreliable')
      console.log('   The X Analytics page DOM may have changed. Values may be chart labels, not actual metrics.')
      metrics.stale = true
      metrics.staleWarning = 'Values unchanged for multiple days - scraper may be reading wrong elements'
    }

    // Cria entrada do dia (use BRT timezone, not UTC)
    const today = getTodayBRT()
    const entry = {
      date: today,
      timestamp: new Date().toISOString(),
      metrics
    }

    // Verifica se ja tem entrada de hoje (atualiza) ou adiciona nova
    const existingIndex = history.entries.findIndex(e => e.date === today)
    if (existingIndex >= 0) {
      console.log('   Atualizando entrada existente de hoje...')
      history.entries[existingIndex] = entry
    } else {
      console.log('   Adicionando nova entrada...')
      history.entries.push(entry)
    }

    // Calcula comparacao com dia anterior
    const previousEntry = history.entries.length > 1
      ? history.entries[history.entries.length - 2]
      : null
    const comparison = calculateComparison(metrics, previousEntry?.metrics)

    // Calcula projecao
    const projection = calculateProjection(history)

    // Adiciona metadados
    entry.comparison = comparison
    entry.projection = projection

    // Salva historico
    console.log('\n4. Salvando historico...')
    saveHistory(history)

    // Gera e exibe relatorio
    const report = generateReport(entry, comparison, projection)
    console.log(report)

    // Desconecta (mas nao fecha)
    browser.disconnect()

    return {
      success: true,
      data: {
        entry,
        comparison,
        projection,
        historyLength: history.entries.length
      }
    }

  } catch (err) {
    console.error('\nErro ao coletar analytics:', err.message)

    if (browser) {
      browser.disconnect()
    }

    return {
      success: false,
      error: err.message
    }
  }
}

/**
 * Retorna historico completo de analytics
 */
export function getAnalyticsHistory() {
  return loadHistory()
}

/**
 * Retorna projecao atual baseada no historico
 */
export function getCurrentProjection() {
  const history = loadHistory()
  return calculateProjection(history)
}

/**
 * Retorna ultima entrada de analytics
 */
export function getLatestAnalytics() {
  const history = loadHistory()
  if (history.entries.length === 0) {
    return null
  }
  return history.entries[history.entries.length - 1]
}

/**
 * Exporta relatorio em formato texto
 */
export function exportReport() {
  const history = loadHistory()
  if (history.entries.length === 0) {
    return 'Nenhum dado de analytics disponivel.'
  }

  const latest = history.entries[history.entries.length - 1]
  const previous = history.entries.length > 1
    ? history.entries[history.entries.length - 2]
    : null

  const comparison = calculateComparison(latest.metrics, previous?.metrics)
  const projection = calculateProjection(history)

  return generateReport(latest, comparison, projection)
}

// Se executado diretamente
if (process.argv[1] && process.argv[1].includes('analytics-monitor')) {
  collectDailyAnalytics()
    .then(result => {
      if (!result.success) {
        process.exit(1)
      }
    })
    .catch(err => {
      console.error('Erro fatal:', err)
      process.exit(1)
    })
}
