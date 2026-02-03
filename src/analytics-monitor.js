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
  await new Promise(r => setTimeout(r, 3000))

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

    // Funcao auxiliar para extrair texto de elementos
    const getText = (selector) => {
      const el = document.querySelector(selector)
      return el ? el.textContent.trim() : null
    }

    // Funcao para encontrar metrica por label
    const findMetricByLabel = (labelText) => {
      const allElements = document.querySelectorAll('span, div, p')
      for (const el of allElements) {
        if (el.textContent.toLowerCase().includes(labelText.toLowerCase())) {
          // Procura numero no elemento pai ou irmao
          const parent = el.parentElement
          if (parent) {
            const numberEl = parent.querySelector('[dir="ltr"]') ||
                            parent.previousElementSibling ||
                            parent.nextElementSibling
            if (numberEl) {
              return numberEl.textContent.trim()
            }
          }
        }
      }
      return null
    }

    // Tenta diferentes abordagens para extrair metricas

    // Abordagem 1: Busca por data-testid
    const testIdMappings = {
      'impressions': ['impressions', 'impressionCount'],
      'engagements': ['engagements', 'engagementCount'],
      'newFollowers': ['newFollowers', 'followerCount', 'followers'],
      'profileVisits': ['profileVisits', 'profileVisitCount']
    }

    // Abordagem 2: Busca todos os elementos com numeros grandes
    const allText = document.body.innerText
    const sections = allText.split('\n').filter(line => line.trim())

    // Procura padroes comuns de metricas
    for (let i = 0; i < sections.length; i++) {
      const line = sections[i].toLowerCase()
      const nextLine = sections[i + 1] || ''
      const prevLine = sections[i - 1] || ''

      // Impressions
      if (line.includes('impression') || line.includes('impresso')) {
        const numMatch = (prevLine + ' ' + nextLine).match(/[\d,\.]+[KMB]?/i)
        if (numMatch) result.rawData.impressions = numMatch[0]
      }

      // Engagements
      if (line.includes('engagement') || line.includes('engajament')) {
        const numMatch = (prevLine + ' ' + nextLine).match(/[\d,\.]+[KMB]?/i)
        if (numMatch) result.rawData.engagements = numMatch[0]
      }

      // New followers
      if (line.includes('follower') || line.includes('seguidor')) {
        const numMatch = (prevLine + ' ' + nextLine).match(/[\d,\.]+[KMB]?/i)
        if (numMatch) result.rawData.newFollowers = numMatch[0]
      }

      // Profile visits
      if (line.includes('profile visit') || line.includes('visita')) {
        const numMatch = (prevLine + ' ' + nextLine).match(/[\d,\.]+[KMB]?/i)
        if (numMatch) result.rawData.profileVisits = numMatch[0]
      }
    }

    // Abordagem 3: Extrai todos os numeros visiveis na pagina
    const numberElements = document.querySelectorAll('[dir="ltr"], .css-1jxf684, .r-poiln3')
    const numbers = []
    numberElements.forEach(el => {
      const text = el.textContent.trim()
      if (/^[\d,\.]+[KMB]?$/i.test(text)) {
        numbers.push(text)
      }
    })
    result.rawData.allNumbers = numbers

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

  let report = `
=====================================
   ANALYTICS REPORT - ${date} ${time}
=====================================

METRICAS DO DIA:
  Impressoes:     ${entry.metrics.impressions.toLocaleString()}
  Engajamentos:   ${entry.metrics.engagements.toLocaleString()}
  Novos seguid.:  ${entry.metrics.newFollowers.toLocaleString()}
  Visitas perfil: ${entry.metrics.profileVisits.toLocaleString()}

COMPARACAO COM DIA ANTERIOR:
  Impressoes:     ${comparison.impressions.change >= 0 ? '+' : ''}${comparison.impressions.change.toLocaleString()} (${comparison.impressions.percent}%)
  Engajamentos:   ${comparison.engagements.change >= 0 ? '+' : ''}${comparison.engagements.change.toLocaleString()} (${comparison.engagements.percent}%)
  Novos seguid.:  ${comparison.newFollowers.change >= 0 ? '+' : ''}${comparison.newFollowers.change.toLocaleString()} (${comparison.newFollowers.percent}%)
  Visitas perfil: ${comparison.profileVisits.change >= 0 ? '+' : ''}${comparison.profileVisits.change.toLocaleString()} (${comparison.profileVisits.percent}%)

PROJECAO PARA META (5M impressoes):
  Media diaria:   ${projection.dailyAverage.toLocaleString()} impressoes
  Meta diaria:    ${projection.dailyTarget.toLocaleString()} impressoes
  Total acumul.:  ${projection.totalImpressions.toLocaleString()} (${projection.percentComplete}%)
  Faltam:         ${projection.remaining?.toLocaleString() || 'N/A'} impressoes
  Dias restantes: ${projection.daysToGoal || 'N/A'}
  Data projetada: ${projection.projectedDate || 'N/A'}
  Status:         ${projection.onTrack ? 'NO RITMO' : 'ABAIXO DA META'}

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
      history.startDate = new Date().toISOString().split('T')[0]
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

    // Cria entrada do dia
    const today = new Date().toISOString().split('T')[0]
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
