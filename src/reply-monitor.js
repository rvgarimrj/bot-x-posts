/**
 * Reply Monitor - Monitors and responds to comments on OUR OWN posts
 *
 * USES PUPPETEER (not Twitter API) to avoid rate limits
 *
 * Features:
 * - Fetches replies on our own recent posts
 * - Generates humanized responses with Claude
 * - Uses emojis and friendly tone
 * - Tracks reply performance for learning
 * - Avoids duplicate responses
 */

import Anthropic from '@anthropic-ai/sdk'
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'

const anthropic = new Anthropic()

// ==================== CONFIGURATION ====================

const DATA_DIR = '/Users/user/AppsCalude/Bot-X-Posts/data'
const REPLIES_LOG_FILE = path.join(DATA_DIR, 'replies-log.json')
const REPLIED_IDS_FILE = path.join(DATA_DIR, 'replied-ids.json')

// Puppeteer config
const PROTOCOL_TIMEOUT = 120000
const PAGE_TIMEOUT = 60000

// Our X username (to find our posts)
const OUR_USERNAME = 'gaaborges_'

// Reply styles for variety
const REPLY_STYLES = [
  { name: 'friendly', instruction: 'Super amigável e caloroso. Use emojis como 😊🙌✨' },
  { name: 'helpful', instruction: 'Prestativo e informativo, mas leve. Use emojis como 💡👍📚' },
  { name: 'funny', instruction: 'Bem humorado, faça uma piada leve se couber. Use emojis como 😂🤣💀' },
  { name: 'grateful', instruction: 'Agradeça genuinamente. Use emojis como 🙏❤️🔥' },
  { name: 'curious', instruction: 'Mostre interesse genuíno, faça uma pergunta de volta. Use emojis como 🤔👀💭' }
]

// Types of comments and how to handle them
const COMMENT_TYPES = {
  question: {
    detect: ['?', 'como', 'how', 'what', 'why', 'quando', 'where', 'qual', 'quem', 'can you', 'could you', 'pode', 'consegue'],
    priority: 'high',
    styles: ['helpful', 'friendly']
  },
  agreement: {
    detect: ['concordo', 'agree', 'exactly', 'isso', 'true', 'real', 'fato', 'based', 'this', '100%', 'facts'],
    priority: 'medium',
    styles: ['grateful', 'friendly']
  },
  disagreement: {
    detect: ['discordo', 'disagree', 'but', 'mas', 'however', 'nah', 'wrong', 'errado', 'não é bem assim'],
    priority: 'high',
    styles: ['friendly', 'curious']
  },
  compliment: {
    detect: ['great', 'awesome', 'love', 'best', 'amazing', 'top', 'boa', 'otimo', 'excelente', 'genial', 'mito', 'crack'],
    priority: 'medium',
    styles: ['grateful', 'funny']
  },
  joke: {
    detect: ['kk', 'lol', 'lmao', 'haha', '😂', '🤣', 'kkk', 'rsrs'],
    priority: 'low',
    styles: ['funny', 'friendly']
  },
  generic: {
    detect: [],
    priority: 'low',
    styles: ['friendly', 'grateful']
  }
}

// ==================== PUPPETEER CONNECTION ====================

async function connectToChrome() {
  try {
    console.log('   Conectando ao Chrome...')
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
      protocolTimeout: PROTOCOL_TIMEOUT
    })
    return browser
  } catch (err) {
    throw new Error(`Chrome nao conectado: ${err.message}`)
  }
}

async function getPage(browser) {
  const pages = await browser.pages()

  // Procura aba do X
  for (const p of pages) {
    const url = p.url()
    if (url.includes('x.com') && !url.includes('/login')) {
      p.setDefaultTimeout(PAGE_TIMEOUT)
      return p
    }
  }

  // Cria nova aba
  const newPage = await browser.newPage()
  newPage.setDefaultTimeout(PAGE_TIMEOUT)
  await newPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
  return newPage
}

// ==================== FETCH OUR POSTS AND THEIR REPLIES ====================

/**
 * Fetch our recent posts from profile
 */
async function fetchOurRecentPosts(page, limit = 10) {
  try {
    console.log(`   Navegando para perfil @${OUR_USERNAME}...`)
    await page.goto(`https://x.com/${OUR_USERNAME}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    await new Promise(r => setTimeout(r, 3000))

    // Aguarda posts carregarem
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => null)
    await new Promise(r => setTimeout(r, 2000))

    // Extrai nossos posts
    const posts = await page.evaluate((maxItems, ourUsername) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]')
      const results = []

      for (let i = 0; i < Math.min(articles.length, maxItems); i++) {
        const article = articles[i]

        try {
          // Verifica se é nosso post (não retweet)
          const authorLink = article.querySelector(`a[href="/${ourUsername}"]`)
          if (!authorLink) continue

          // ID do tweet
          const tweetLink = article.querySelector('a[href*="/status/"]')
          const href = tweetLink?.href || ''
          const idMatch = href.match(/\/status\/(\d+)/)
          const id = idMatch ? idMatch[1] : null

          // Texto do post
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent || ''

          // Número de replies (se mostrar)
          const replyBtn = article.querySelector('[data-testid="reply"]')
          const replyCount = replyBtn?.textContent?.match(/\d+/)?.[0] || '0'

          if (id && parseInt(replyCount) > 0) {
            results.push({
              id,
              text: text.substring(0, 100),
              url: href,
              replyCount: parseInt(replyCount)
            })
          }
        } catch (e) {
          // Ignora erros
        }
      }

      return results
    }, limit, OUR_USERNAME)

    console.log(`   Encontrados ${posts.length} posts com replies`)
    return posts

  } catch (err) {
    console.log(`   Erro ao buscar posts: ${err.message}`)
    return []
  }
}

/**
 * Fetch replies to a specific post
 */
async function fetchRepliesForPost(page, postUrl, postId) {
  try {
    console.log(`   Buscando replies do post ${postId.substring(0, 8)}...`)
    await page.goto(postUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    await new Promise(r => setTimeout(r, 3000))

    // Aguarda replies carregarem
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => null)
    await new Promise(r => setTimeout(r, 2000))

    // Extrai replies (pula o primeiro que é nosso post original)
    const replies = await page.evaluate((ourUsername) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]')
      const results = []
      let isFirstPost = true

      for (const article of articles) {
        try {
          // ID do tweet
          const tweetLink = article.querySelector('a[href*="/status/"]')
          const href = tweetLink?.href || ''
          const idMatch = href.match(/\/status\/(\d+)/)
          const id = idMatch ? idMatch[1] : null

          // Autor
          const userLinks = article.querySelectorAll('a[href^="/"]')
          let authorUsername = ''
          for (const link of userLinks) {
            const linkHref = link.getAttribute('href')
            if (linkHref && linkHref.match(/^\/[a-zA-Z0-9_]+$/) && !linkHref.includes('/status/')) {
              authorUsername = linkHref.replace('/', '')
              break
            }
          }

          // Pula nosso próprio post (primeiro) e nossas próprias replies
          if (authorUsername.toLowerCase() === ourUsername.toLowerCase()) {
            isFirstPost = false
            continue
          }

          // Texto
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent || ''

          // Tempo
          const timeEl = article.querySelector('time')
          const createdAt = timeEl?.getAttribute('datetime') || new Date().toISOString()

          if (id && text && authorUsername) {
            results.push({
              id,
              text,
              authorUsername,
              createdAt,
              url: href
            })
          }
        } catch (e) {
          // Ignora
        }
      }

      return results
    }, OUR_USERNAME)

    return replies

  } catch (err) {
    console.log(`   Erro ao buscar replies: ${err.message}`)
    return []
  }
}

/**
 * Post a reply to a comment on our post
 */
async function postReplyToComment(page, replyText, commentId) {
  try {
    // Já estamos na página do post/thread
    // Procura o comentário específico e clica em reply

    const replied = await page.evaluate(async (targetId, text) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      for (const article of articles) {
        const link = article.querySelector(`a[href*="/status/${targetId}"]`)
        if (link) {
          // Encontrou o comentário, clica no botão de reply
          const replyBtn = article.querySelector('[data-testid="reply"]')
          if (replyBtn) {
            replyBtn.click()
            return true
          }
        }
      }
      return false
    }, commentId, replyText)

    if (!replied) {
      // Tenta navegar diretamente para o tweet e responder
      await page.goto(`https://x.com/i/status/${commentId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
      await new Promise(r => setTimeout(r, 3000))
    }

    await new Promise(r => setTimeout(r, 2000))

    // Procura campo de texto
    let textbox = await page.$('[data-testid="tweetTextarea_0"]')

    if (!textbox) {
      // Clica no botão reply se existir
      const replyBtn = await page.$('[data-testid="reply"]')
      if (replyBtn) {
        await replyBtn.click()
        await new Promise(r => setTimeout(r, 2000))
        textbox = await page.$('[data-testid="tweetTextarea_0"]')
      }
    }

    if (!textbox) {
      throw new Error('Campo de texto não encontrado')
    }

    // Clica e insere texto
    await textbox.click()
    await new Promise(r => setTimeout(r, 500))

    // Cola via clipboard
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t)
    }, replyText)

    await page.keyboard.down('Meta')
    await page.keyboard.press('v')
    await page.keyboard.up('Meta')
    await new Promise(r => setTimeout(r, 1500))

    // Clica em postar
    const postBtn = await page.$('[data-testid="tweetButtonInline"]') ||
                    await page.$('[data-testid="tweetButton"]')

    if (!postBtn) {
      throw new Error('Botão de postar não encontrado')
    }

    await postBtn.click()
    await new Promise(r => setTimeout(r, 3000))

    // Verifica se modal fechou
    const stillOpen = await page.$('[data-testid="tweetTextarea_0"]')
    if (stillOpen) {
      // Tenta clicar de novo
      const btn2 = await page.$('[data-testid="tweetButtonInline"]') ||
                   await page.$('[data-testid="tweetButton"]')
      if (btn2) await btn2.click()
      await new Promise(r => setTimeout(r, 2000))
    }

    console.log(`   ✅ Resposta postada!`)
    return { success: true }

  } catch (err) {
    console.log(`   ❌ Erro ao postar: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ==================== COMMENT CLASSIFICATION ====================

function classifyComment(text) {
  const textLower = text.toLowerCase()

  for (const [type, config] of Object.entries(COMMENT_TYPES)) {
    if (type === 'generic') continue

    for (const keyword of config.detect) {
      if (textLower.includes(keyword.toLowerCase())) {
        return { type, ...config }
      }
    }
  }

  return { type: 'generic', ...COMMENT_TYPES.generic }
}

function selectReplyStyle(commentType) {
  const styles = commentType.styles || ['friendly']
  const styleName = styles[Math.floor(Math.random() * styles.length)]
  return REPLY_STYLES.find(s => s.name === styleName) || REPLY_STYLES[0]
}

// ==================== REPLY GENERATION ====================

async function generateReply(comment, originalPost = '', retries = 2) {
  const commentType = classifyComment(comment.text)
  const style = selectReplyStyle(commentType)

  const systemPrompt = `Você é o @${OUR_USERNAME} no X (Twitter). Alguém comentou no seu post e você vai responder.

=== REGRAS ABSOLUTAS ===
- SEMPRE use emojis (2-4 por resposta)
- Seja educado, gentil e bem humorado
- Respostas CURTAS (max 180 chars)
- NUNCA pareça robô ou formal
- Use português brasileiro casual (ou inglês se o comentário for em inglês)
- Se for pergunta, responda de forma útil
- Se for elogio, agradeça genuinamente
- Se for crítica, seja respeitoso mas mantenha sua opinião
- Se for piada, entre na brincadeira
- NÃO comece com @username (será adicionado automaticamente)

=== ESTILO DESTA RESPOSTA ===
${style.instruction}

=== CONTEXTO ===
Seu post original: "${originalPost}"

=== PALAVRAS PROIBIDAS ===
NUNCA use: "Interestingly", "Notably", "Certainly", "Absolutely", "Indeed", "Furthermore"

=== EXEMPLOS BONS ===
- "boa pergunta! 🤔 na real, depende muito do contexto..."
- "kkkk exatamente isso 😂🙌"
- "valeu demais pelo feedback! ❤️🔥"
- "hmm interessante ponto de vista 👀 mas e se..."`

  const userPrompt = `COMENTÁRIO de @${comment.authorUsername}:
"${comment.text}"

TIPO: ${commentType.type}

Responda de forma ${style.name}. Max 180 chars. Use emojis! NÃO inclua @username.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    })

    let reply = message.content[0].text.trim()

    // Remove @ do início se Claude adicionou
    if (reply.startsWith('@')) {
      reply = reply.replace(/^@\w+\s*/, '')
    }

    // Adiciona @ mention
    reply = `@${comment.authorUsername} ${reply}`

    // Max length
    if (reply.length > 280) {
      reply = reply.substring(0, 277) + '...'
    }

    return {
      text: reply,
      style: style.name,
      commentType: commentType.type,
      generatedAt: new Date().toISOString()
    }
  } catch (err) {
    console.log(`   Erro ao gerar resposta: ${err.message}`)
    if (retries > 0) {
      return generateReply(comment, originalPost, retries - 1)
    }
    return null
  }
}

// ==================== TRACKING ====================

function loadRepliedIds() {
  try {
    if (fs.existsSync(REPLIED_IDS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(REPLIED_IDS_FILE, 'utf-8')))
    }
  } catch (err) {}
  return new Set()
}

function saveRepliedIds(ids) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(REPLIED_IDS_FILE, JSON.stringify([...ids]))
  } catch (err) {}
}

function loadRepliesLog() {
  try {
    if (fs.existsSync(REPLIES_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(REPLIES_LOG_FILE, 'utf-8'))
    }
  } catch (err) {}
  return { replies: [], stats: { total: 0, byType: {}, byStyle: {} } }
}

function saveRepliesLog(log) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(REPLIES_LOG_FILE, JSON.stringify(log, null, 2))
  } catch (err) {}
}

function logReply(comment, reply, result) {
  const log = loadRepliesLog()

  log.replies.push({
    id: Date.now().toString(),
    commentId: comment.id,
    commentText: comment.text,
    commentAuthor: comment.authorUsername,
    commentType: reply.commentType,
    replyText: reply.text,
    replyStyle: reply.style,
    success: result.success,
    timestamp: new Date().toISOString()
  })

  log.stats.total++
  log.stats.byType[reply.commentType] = (log.stats.byType[reply.commentType] || 0) + 1
  log.stats.byStyle[reply.style] = (log.stats.byStyle[reply.style] || 0) + 1

  if (log.replies.length > 500) {
    log.replies = log.replies.slice(-500)
  }

  saveRepliesLog(log)
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Process replies on our own posts
 */
export async function processReplies(maxReplies = 5, dryRun = false) {
  console.log('Reply Monitor - Checking comments on OUR posts')
  console.log('='.repeat(50))

  let browser = null

  try {
    browser = await connectToChrome()
    const page = await getPage(browser)
    const repliedIds = loadRepliedIds()

    // 1. Busca nossos posts recentes que têm replies
    console.log('\n1. Buscando nossos posts com comentários...')
    const ourPosts = await fetchOurRecentPosts(page, 15)

    if (ourPosts.length === 0) {
      console.log('   Nenhum post com comentários encontrado')
      return { processed: 0, replied: 0 }
    }

    console.log(`   ${ourPosts.length} posts têm comentários`)

    // 2. Para cada post, busca replies
    let allReplies = []

    for (const post of ourPosts.slice(0, 5)) { // Limita a 5 posts
      const replies = await fetchRepliesForPost(page, post.url, post.id)

      // Adiciona contexto do post original
      for (const reply of replies) {
        reply.originalPostId = post.id
        reply.originalPostText = post.text
        reply.originalPostUrl = post.url
      }

      allReplies = allReplies.concat(replies)
      await new Promise(r => setTimeout(r, 2000))
    }

    // Filtra já respondidos
    const pending = allReplies.filter(r => !repliedIds.has(r.id))
    console.log(`\n   Total: ${allReplies.length} comentários, ${pending.length} novos`)

    if (pending.length === 0) {
      console.log('   Todos os comentários já foram respondidos')
      return { processed: 0, replied: 0 }
    }

    // 3. Processa replies (prioriza perguntas)
    const sorted = pending.sort((a, b) => {
      const typeA = classifyComment(a.text)
      const typeB = classifyComment(b.text)
      const order = { high: 0, medium: 1, low: 2 }
      return (order[typeA.priority] || 2) - (order[typeB.priority] || 2)
    })

    const toProcess = sorted.slice(0, maxReplies)
    let repliedCount = 0

    console.log(`\n2. Respondendo ${toProcess.length} comentários...`)

    for (const comment of toProcess) {
      const commentType = classifyComment(comment.text)
      console.log(`\n   [@${comment.authorUsername}] (${commentType.type})`)
      console.log(`   "${comment.text.substring(0, 50)}${comment.text.length > 50 ? '...' : ''}"`)

      // Gera resposta
      const reply = await generateReply(comment, comment.originalPostText)

      if (!reply) {
        console.log('   ❌ Falha ao gerar resposta')
        repliedIds.add(comment.id)
        continue
      }

      console.log(`   Resposta (${reply.style}): "${reply.text.substring(0, 50)}..."`)

      if (dryRun) {
        console.log('   [DRY RUN] Não postaria')
        repliedIds.add(comment.id)
        continue
      }

      // Navega para o post original e responde
      await page.goto(comment.originalPostUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
      await new Promise(r => setTimeout(r, 2000))

      const result = await postReplyToComment(page, reply.text, comment.id)

      repliedIds.add(comment.id)

      if (result.success) {
        repliedCount++
        logReply(comment, reply, result)
      }

      // Aguarda entre replies
      if (toProcess.indexOf(comment) < toProcess.length - 1) {
        console.log('   ⏳ Aguardando 30s...')
        await new Promise(r => setTimeout(r, 30000))
      }
    }

    saveRepliedIds(repliedIds)

    // Volta para home
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})

    console.log(`\n${'='.repeat(50)}`)
    console.log(`Processados: ${toProcess.length}, Respondidos: ${repliedCount}`)

    return { processed: toProcess.length, replied: repliedCount }

  } catch (err) {
    console.log(`Erro no Reply Monitor: ${err.message}`)
    return { processed: 0, replied: 0, error: err.message }
  } finally {
    if (browser) {
      browser.disconnect()
    }
  }
}

/**
 * Get reply statistics
 */
export function getReplyStats() {
  const log = loadRepliesLog()
  return {
    total: log.stats.total,
    byType: log.stats.byType,
    byStyle: log.stats.byStyle,
    recentReplies: log.replies.slice(-10)
  }
}

// If run directly
if (process.argv[1]?.includes('reply-monitor')) {
  const dryRun = process.argv.includes('--dry-run')
  processReplies(5, dryRun)
    .then(result => {
      console.log('\nResultado:', result)
      process.exit(0)
    })
    .catch(err => {
      console.error('Erro:', err)
      process.exit(1)
    })
}

export default {
  processReplies,
  getReplyStats,
  generateReply,
  classifyComment
}
