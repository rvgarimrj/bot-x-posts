/**
 * Puppeteer integration for X (Twitter) posting
 * Conecta ao Chrome em modo debug e posta como humano
 *
 * Anti-suspensão: Chrome deve rodar com flags:
 * --disable-background-timer-throttling
 * --disable-backgrounding-occluded-windows
 * --disable-renderer-backgrounding
 */

import puppeteer from 'puppeteer-core'

// Delays de digitacao humana (em ms)
const TYPING_DELAY = { min: 50, max: 120 }
const DELAY_BETWEEN_POSTS_MS = 60000  // 60 segundos

// Configurações de timeout e retry
const MAX_CONNECTION_RETRIES = 3
const RETRY_DELAY_MS = 5000
const PROTOCOL_TIMEOUT = 120000  // 2 minutos
const PAGE_TIMEOUT = 60000  // 1 minuto
const MAX_TABS = 5  // Maximo de abas antes de limpar

/**
 * Conecta ao Chrome com retry automático
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
        console.log(`   ⚠️ Timeout na conexao, aguardando ${RETRY_DELAY_MS/1000}s...`)
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
 * Fecha abas em excesso para liberar memoria
 */
async function closeExcessTabs(browser) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ])

    if (pages.length > MAX_TABS) {
      console.log(`   🧹 Fechando ${pages.length - MAX_TABS} abas em excesso...`)
      // Fecha as mais antigas, mantendo as ultimas MAX_TABS
      const toClose = pages.slice(0, pages.length - MAX_TABS)
      for (const p of toClose) {
        const url = p.url()
        // Nao fecha a aba do X
        if (!url.includes('x.com') && !url.includes('twitter.com')) {
          await p.close().catch(() => {})
        }
      }
    }
  } catch (e) {
    // Ignora erros - limpeza nao e critica
  }
}

/**
 * Digita texto como humano (com delays variaveis)
 */
async function typeHuman(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.random() * (TYPING_DELAY.max - TYPING_DELAY.min) + TYPING_DELAY.min
    })

    // Pausa maior apos pontuacao
    if (['.', ',', '!', '?', ';', ':'].includes(char)) {
      await new Promise(r => setTimeout(r, Math.random() * 300 + 100))
    }
  }
}

/**
 * Posta um tweet no X
 * @param {string} text - Texto do post
 * @param {boolean} keepBrowserOpen - Se true, nao desconecta do browser
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function postTweet(text, keepBrowserOpen = true) {
  let browser = null

  try {
    console.log('🔌 Conectando ao Chrome...')
    browser = await connectToChrome()

    // Limpa abas em excesso
    await closeExcessTabs(browser)

    // Pega todas as paginas abertas
    const pages = await browser.pages()
    console.log(`   ${pages.length} abas encontradas`)

    // Procura uma aba do X que esteja LOGADA (tem botao de postar)
    let page = null
    for (const p of pages) {
      const url = p.url()
      if (url.includes('x.com') || url.includes('twitter.com')) {
        // Verifica se esta logada (nao esta na pagina de login)
        if (url.includes('/login') || url.includes('/i/flow/login')) {
          console.log(`   Aba ${url} - pagina de login, pulando...`)
          continue
        }

        // Verifica se tem o botao de postar (indica que esta logado)
        const hasPostBtn = await p.$('[data-testid="SideNav_NewTweet_Button"]')
        if (hasPostBtn) {
          console.log(`   ✅ Aba logada encontrada: ${url}`)
          page = p
          break
        } else {
          console.log(`   Aba ${url} - sem botao de post, verificando proxima...`)
        }
      }
    }

    if (!page) {
      // Nenhuma aba logada encontrada - tenta a primeira do X que nao seja login
      page = pages.find(p => {
        const url = p.url()
        return (url.includes('x.com') || url.includes('twitter.com')) &&
               !url.includes('/login') && !url.includes('/i/flow/login')
      })

      if (!page) {
        // Nenhuma aba do X encontrada - abre uma nova
        console.log('   ⚠️ Nenhuma aba do X encontrada, abrindo nova...')
        page = await browser.newPage()
        page.setDefaultTimeout(PAGE_TIMEOUT)
        page.setDefaultNavigationTimeout(PAGE_TIMEOUT)
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise(r => setTimeout(r, 5000))

        // Verifica se redirecionou para login
        const currentUrl = page.url()
        if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
          throw new Error('Nao esta logado no X. Faca login no Chrome primeiro.')
        }
      }
    }

    console.log('📄 Usando aba:', page.url())

    // Configura timeouts da pagina
    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    // Traz a aba para frente
    await page.bringToFront()

    // Navega para /home para garantir estado limpo (fecha modais abertos)
    console.log('🔄 Navegando para /home...')
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 3000))  // Espera carregar completamente

    // Aguarda o botao de postar aparecer (indica que esta logado e carregou)
    console.log('⏳ Aguardando pagina carregar...')
    try {
      await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 })
    } catch (e) {
      throw new Error('Nao esta logado no X. Faca login no Chrome primeiro.')
    }

    console.log('✅ Logado no X')

    // Tenta clicar no botao de novo post primeiro (mais rapido)
    console.log('📝 Abrindo composer...')
    let composerOpened = false

    // Tenta clicar no botao de post na sidebar
    const postBtnSelectors = [
      '[data-testid="SideNav_NewTweet_Button"]',
      'a[href="/compose/post"]',
      '[aria-label="Post"]',
      '[aria-label="Postar"]'
    ]

    for (const selector of postBtnSelectors) {
      const btn = await page.$(selector)
      if (btn) {
        console.log(`   Clicando em: ${selector}`)
        await btn.click()
        await new Promise(r => setTimeout(r, 2000))
        composerOpened = true
        break
      }
    }

    // Se nao encontrou botao, navega para /compose/post
    if (!composerOpened) {
      console.log('   Navegando para /compose/post...')
      await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // Espera um pouco mais para o modal carregar completamente
    await new Promise(r => setTimeout(r, 2000))

    // Encontra o campo de texto - tenta varios seletores
    console.log('🔍 Procurando campo de texto...')
    let textbox = null
    const selectors = [
      '[data-testid="tweetTextarea_0"]',
      '.public-DraftStyleDefault-block',
      '[data-testid="tweetTextarea_0_label"]',
      '[role="textbox"][data-testid="tweetTextarea_0"]',
      '[role="textbox"]',
      '.public-DraftEditor-content',
      '[contenteditable="true"]',
      'div[data-contents="true"]',
      '.DraftEditor-root',
      '[data-offset-key]'
    ]

    // Tenta cada seletor com pequeno delay
    for (const selector of selectors) {
      textbox = await page.$(selector)
      if (textbox) {
        console.log(`   ✅ Encontrou: ${selector}`)
        break
      }
      await new Promise(r => setTimeout(r, 200))
    }

    // Se nao achou, espera mais e tenta de novo
    if (!textbox) {
      console.log('   Esperando mais 3s...')
      await new Promise(r => setTimeout(r, 3000))
      for (const selector of selectors) {
        textbox = await page.$(selector)
        if (textbox) {
          console.log(`   ✅ Encontrou (2a tentativa): ${selector}`)
          break
        }
      }
    }

    if (!textbox) {
      console.log('❌ Nao encontrou campo de texto. Seletores testados:', selectors.join(', '))
      throw new Error('Nao encontrou campo de texto do post')
    }

    // Clica no campo
    console.log('⌨️ Inserindo texto...')
    await textbox.click()
    await new Promise(r => setTimeout(r, 500))

    // Limpa qualquer texto existente (Ctrl+A, Delete)
    await page.keyboard.down('Meta')  // Cmd no Mac
    await page.keyboard.press('a')
    await page.keyboard.up('Meta')
    await page.keyboard.press('Backspace')
    await new Promise(r => setTimeout(r, 500))

    // Digita caractere por caractere com delay variavel (parece humano)
    console.log('   Digitando texto (humanizado)...')
    let charCount = 0
    for (const char of text) {
      await page.keyboard.type(char)
      charCount++

      // Delay base: 70-130ms
      let delay = Math.random() * 60 + 70

      // Pausa maior apos pontuacao (200-500ms)
      if (['.', ',', '!', '?', ';', ':'].includes(char)) {
        delay = Math.random() * 300 + 200
      }

      // Pausa aleatoria "pensando" a cada ~30 chars (1-2 segundos)
      if (charCount % 30 === 0 && Math.random() > 0.5) {
        delay += Math.random() * 1000 + 1000
        console.log('   ... pensando ...')
      }

      await new Promise(r => setTimeout(r, delay))
    }

    // Espera antes de postar (como se estivesse relendo) - 2-4 segundos
    console.log('   Relendo antes de postar...')
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))

    console.log('   ✅ Texto inserido')

    // Procura botao Postar
    console.log('🔍 Procurando botao Postar...')
    let postBtn = null
    const btnSelectors = [
      '[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      '[role="button"][data-testid="tweetButton"]'
    ]

    for (const selector of btnSelectors) {
      postBtn = await page.$(selector)
      if (postBtn) {
        console.log(`   ✅ Encontrou: ${selector}`)
        break
      }
    }

    if (!postBtn) {
      throw new Error('Nao encontrou botao de postar')
    }

    // Espera botao estar habilitado
    await new Promise(r => setTimeout(r, 1000))

    // Clica no botao Postar usando evaluate (mais confiavel)
    console.log('🚀 Clicando em Postar...')
    await page.evaluate((sel) => {
      const btn = document.querySelector(sel)
      if (btn) {
        btn.click()
        console.log('Clicou no botao')
      }
    }, '[data-testid="tweetButton"]')

    // Aguarda um pouco
    await new Promise(r => setTimeout(r, 2000))

    // Tenta clicar novamente se ainda existir (as vezes precisa 2 cliques)
    const stillExists = await page.$('[data-testid="tweetButton"]')
    if (stillExists) {
      console.log('   Clicando novamente...')
      await stillExists.click()
      await new Promise(r => setTimeout(r, 3000))
    }

    // Verifica se modal fechou (indica sucesso)
    const modalClosed = !(await page.$('[data-testid="tweetTextarea_0"]'))
    if (modalClosed) {
      console.log('   ✅ Modal fechou - post enviado!')
    } else {
      console.log('   ⚠️ Modal ainda aberta - verificar manualmente')
    }

    console.log('✅ Post publicado!')

    // NAO desconecta - mantem browser aberto
    if (!keepBrowserOpen && browser) {
      browser.disconnect()
    }

    return { success: true }

  } catch (err) {
    console.error('❌ Erro ao postar:', err.message)

    // Desconecta em caso de erro (mas nao fecha)
    if (browser) {
      browser.disconnect()
    }

    return { success: false, error: err.message }
  }
}

/**
 * Posta multiplos tweets com delay entre eles
 * @param {Array<{post: string, topic: string}>} posts
 * @param {function} onProgress - Callback (index, total, success)
 */
export async function postMultipleTweets(posts, onProgress = null) {
  const results = []

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]

    console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${post.topic}...`)

    const result = await postTweet(post.post, true)
    results.push({ ...result, index: i, topic: post.topic })

    if (onProgress) {
      await onProgress(i, posts.length, result.success)
    }

    // Delay entre posts (exceto no ultimo)
    if (i < posts.length - 1) {
      console.log(`⏳ Aguardando ${DELAY_BETWEEN_POSTS_MS / 1000}s antes do proximo...`)
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS_MS))
    }
  }

  return results
}

/**
 * Verifica se Chrome esta conectado
 */
export async function checkChromeConnection() {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null
    })
    const version = await browser.version()
    browser.disconnect()
    return { connected: true, version }
  } catch {
    return { connected: false, version: null }
  }
}
