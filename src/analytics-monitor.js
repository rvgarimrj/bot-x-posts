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
import 'dotenv/config'

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
 * Extrai metricas da pagina de analytics via Screenshot + Gemini Vision API
 * Mais confiavel que DOM scraping pois le os numeros visuais da pagina
 */
async function extractMetricsViaVision(page) {
  const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY

  if (!GEMINI_API_KEY) {
    console.log('   GOOGLE_GEMINI_API_KEY nao configurada, pulando Vision')
    return null
  }

  const screenshotPath = '/tmp/bot-x-analytics-screenshot.png'

  try {
    // Scroll to top to ensure summary cards are visible
    await page.evaluate(() => window.scrollTo(0, 0))
    await new Promise(r => setTimeout(r, 2000))

    // Take screenshot of visible area
    await page.screenshot({ path: screenshotPath, fullPage: false })
    console.log('   Screenshot capturado')

    // Read as base64
    const imageBuffer = fs.readFileSync(screenshotPath)
    const base64Image = imageBuffer.toString('base64')

    const FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

    const response = await fetch(`${FLASH_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Image
              }
            },
            {
              text: `This is a screenshot of the X (Twitter) Analytics page.
Extract the SUMMARY METRICS shown as the main KPI numbers at the top of the page.

IMPORTANT:
- Look for the large summary numbers displayed prominently (e.g., "198K" impressions, "1.9K" engagements)
- Do NOT use chart Y-axis labels (e.g., "20K", "40K", "60K", "80K" going up the left side of a chart)
- Do NOT use navigation numbers or sidebar counts
- The page may be in English or Portuguese

Return ONLY a JSON object with these fields (use 0 if a metric is not visible):
{"impressions": <number>, "engagements": <number>, "newFollowers": <number>, "profileVisits": <number>}

Convert suffixed numbers to full integers: "198K" = 198000, "1.9K" = 1900, "3M" = 3000000.
Return ONLY the JSON, no markdown, no explanations.`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      console.log(`   Gemini Vision API error: ${response.status}`)
      try { fs.unlinkSync(screenshotPath) } catch(e) {}
      return null
    }

    const data = await response.json()
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    console.log(`   Gemini Vision raw: ${responseText.substring(0, 200)}`)

    // Parse JSON - handle markdown code blocks
    let jsonStr = responseText.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    }

    const parsed = JSON.parse(jsonStr)

    // Validate: impressions should be a positive number
    if (typeof parsed.impressions !== 'number' || parsed.impressions < 0) {
      console.log('   Vision returned invalid data, skipping')
      try { fs.unlinkSync(screenshotPath) } catch(e) {}
      return null
    }

    console.log(`   Metricas via Vision:`)
    console.log(`      Impressions:    ${(parsed.impressions || 0).toLocaleString()}`)
    console.log(`      Engagements:    ${(parsed.engagements || 0).toLocaleString()}`)
    console.log(`      New Followers:  ${(parsed.newFollowers || 0).toLocaleString()}`)
    console.log(`      Profile Visits: ${(parsed.profileVisits || 0).toLocaleString()}`)

    try { fs.unlinkSync(screenshotPath) } catch(e) {}

    return {
      impressions: parsed.impressions || 0,
      engagements: parsed.engagements || 0,
      newFollowers: parsed.newFollowers || 0,
      profileVisits: parsed.profileVisits || 0,
      source: 'gemini-vision'
    }

  } catch (err) {
    console.log(`   Vision error: ${err.message}`)
    try { fs.unlinkSync(screenshotPath) } catch(e) {}
    return null
  }
}

/**
 * Extrai metricas via DOM scraping (fallback quando Vision nao disponivel)
 */
async function extractMetricsDOMFallback(page) {
  console.log('   [DOM fallback] Extraindo metricas via DOM scraping...')

  await new Promise(r => setTimeout(r, 3000))

  const metrics = await page.evaluate(() => {
    const result = { rawData: {} }

    const extractNumber = (text) => {
      if (!text) return null
      const cleaned = text.trim().toUpperCase()
      if (cleaned.endsWith('K')) return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1000)
      if (cleaned.endsWith('M')) return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1_000_000)
      if (cleaned.endsWith('B')) return Math.round(parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 1_000_000_000)
      const numStr = cleaned.replace(/[,\.]/g, '').replace(/[^0-9]/g, '')
      return parseInt(numStr, 10) || null
    }

    // Collect all visible numbers from the page
    const allText = document.body.innerText
    const bigNumbers = allText.match(/[\d,\.]+[KMB]|[\d]{4,}/gi) || []
    result.rawData.allNumbers = bigNumbers.slice(0, 15)

    return result
  })

  // Return raw numbers for logging - values are unreliable
  return {
    impressions: 0,
    engagements: 0,
    newFollowers: 0,
    profileVisits: 0,
    source: 'dom-fallback',
    rawData: metrics.rawData,
    unreliable: true
  }
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

METRICAS DO DIA (fonte: ${metrics.source || 'unknown'}):
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

    // Extrai metricas - Vision API primeiro, DOM fallback
    console.log('\n3. Extraindo metricas...')

    // Primary: Gemini Vision (screenshot-based, resistant to DOM changes)
    console.log('   Tentando Gemini Vision (screenshot)...')
    let metrics = await extractMetricsViaVision(page)

    if (metrics) {
      console.log(`   Fonte: ${metrics.source}`)
    } else {
      // Fallback: DOM scraping (unreliable but better than nothing)
      console.log('   Vision falhou, usando DOM fallback (valores podem ser imprecisos)...')
      metrics = await extractMetricsDOMFallback(page)
      metrics.stale = true
      metrics.staleWarning = 'Using DOM fallback - values may be chart axis labels, not actual metrics'
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
