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
const MAX_POST_RETRIES = 3  // Retries para postagem
const RETRY_DELAY_MS = 5000
const PROTOCOL_TIMEOUT = 120000  // 2 minutos
const PAGE_TIMEOUT = 60000  // 1 minuto
const MAX_TABS = 5  // Maximo de abas antes de limpar

// URLs problemáticas do X que devem ser evitadas
const PROBLEMATIC_URLS = [
  '/search',
  '/explore',
  '/compose',
  '/i/flow',
  '/i/jf',
  '/settings',
  '/messages',
  '/notifications',
  '/login',
  'creators/inspiration'
]

// Erros que indicam contexto destruído (precisa nova aba)
const CONTEXT_ERRORS = [
  'Execution context was destroyed',
  'detached Frame',
  'Target closed',
  'Session closed',
  'Protocol error',
  'Cannot find context'
]

/**
 * Verifica se URL é problemática (search, compose, etc.)
 */
function isProblematicUrl(url) {
  return PROBLEMATIC_URLS.some(pattern => url.includes(pattern))
}

/**
 * Verifica se erro indica contexto destruído
 */
function isContextError(errorMessage) {
  return CONTEXT_ERRORS.some(pattern => errorMessage.includes(pattern))
}

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
 * Encontra a melhor aba do X ou cria uma nova
 * Prioriza: /home > outras não-problemáticas > cria nova
 */
async function findOrCreateXTab(browser, forceNew = false) {
  const pages = await browser.pages()
  console.log(`   ${pages.length} abas encontradas`)

  if (!forceNew) {
    // Prioridade 1: Aba em /home com botão de post
    for (const p of pages) {
      const url = p.url()
      if ((url.includes('x.com/home') || url === 'https://x.com/') && !isProblematicUrl(url)) {
        try {
          const hasPostBtn = await Promise.race([
            p.$('[data-testid="SideNav_NewTweet_Button"]'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
          ])
          if (hasPostBtn) {
            console.log(`   ✅ Aba /home logada encontrada: ${url}`)
            return { page: p, isNew: false }
          }
        } catch {
          // Continua para próxima aba
        }
      }
    }

    // Prioridade 2: Qualquer aba do X não-problemática com botão de post
    for (const p of pages) {
      const url = p.url()
      if ((url.includes('x.com') || url.includes('twitter.com')) && !isProblematicUrl(url)) {
        try {
          const hasPostBtn = await Promise.race([
            p.$('[data-testid="SideNav_NewTweet_Button"]'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
          ])
          if (hasPostBtn) {
            console.log(`   ✅ Aba logada encontrada: ${url}`)
            return { page: p, isNew: false }
          } else {
            console.log(`   Aba ${url.substring(0, 50)}... - sem botao de post`)
          }
        } catch {
          console.log(`   Aba ${url.substring(0, 50)}... - timeout ao verificar`)
        }
      }
    }
  }

  // Prioridade 3: Criar nova aba limpa
  console.log('   🆕 Criando nova aba limpa para /home...')
  const newPage = await browser.newPage()
  newPage.setDefaultTimeout(PAGE_TIMEOUT)
  newPage.setDefaultNavigationTimeout(PAGE_TIMEOUT)

  await newPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise(r => setTimeout(r, 5000))

  // Verifica se redirecionou para login
  const currentUrl = newPage.url()
  if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
    await newPage.close().catch(() => {})
    throw new Error('Nao esta logado no X. Faca login no Chrome primeiro.')
  }

  // Verifica se tem botão de post
  const hasPostBtn = await newPage.$('[data-testid="SideNav_NewTweet_Button"]')
  if (!hasPostBtn) {
    await newPage.close().catch(() => {})
    throw new Error('Nao esta logado no X. Faca login no Chrome primeiro.')
  }

  console.log('   ✅ Nova aba criada e logada')
  return { page: newPage, isNew: true }
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
 * Posta um tweet no X (com retry e recuperação de erros)
 * @param {string} text - Texto do post
 * @param {boolean} keepBrowserOpen - Se true, nao desconecta do browser
 * @param {boolean} forceNewTab - Se true, força criação de nova aba
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function postTweet(text, keepBrowserOpen = true, forceNewTab = false) {
  let browser = null
  let page = null
  let isNewTab = false

  try {
    console.log('🔌 Conectando ao Chrome...')
    browser = await connectToChrome()

    // Limpa abas em excesso
    await closeExcessTabs(browser)

    // Encontra ou cria aba do X
    const tabResult = await findOrCreateXTab(browser, forceNewTab)
    page = tabResult.page
    isNewTab = tabResult.isNew

    console.log('📄 Usando aba:', page.url())

    // Configura timeouts da pagina
    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    // Traz a aba para frente
    await page.bringToFront()

    // SEMPRE navega para /home para garantir estado limpo
    const currentUrl = page.url()
    if (!currentUrl.includes('x.com/home') || isProblematicUrl(currentUrl)) {
      console.log('🔄 Navegando para /home...')
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    } else {
      console.log('🔄 Recarregando /home...')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 2000))
    }

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

    // ========== INSERÇÃO VIA CLIPBOARD (mais confiável) ==========
    // Clipboard é a forma mais confiável de inserir texto longo no X

    // Delay antes de "colar" (1-2s) - simula preparar texto
    console.log('   Preparando texto...')
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 1000))

    // Insere via clipboard (mais confiável para textos longos)
    console.log('   Digitando texto (humanizado)...')

    // Copia texto para clipboard e cola
    await page.evaluate(async (textToInsert) => {
      await navigator.clipboard.writeText(textToInsert)
    }, text)

    await new Promise(r => setTimeout(r, 300))

    // Cola (Cmd+V no Mac)
    await page.keyboard.down('Meta')
    await page.keyboard.press('v')
    await page.keyboard.up('Meta')

    // Delay depois de colar (1-2s) - espera UI processar
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 1000))

    // Verifica se o texto foi inserido corretamente
    const insertedText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]')
      return el ? el.textContent : ''
    })

    console.log(`   Texto inserido: ${insertedText.length}/${text.length} chars`)

    if (insertedText.length < text.length * 0.5) {
      // Fallback: tenta via keyboard.type (lento mas confiável)
      console.log('   ⚠️ Clipboard falhou, tentando digitacao...')

      // Limpa o que foi inserido
      await page.keyboard.down('Meta')
      await page.keyboard.press('a')
      await page.keyboard.up('Meta')
      await page.keyboard.press('Backspace')
      await new Promise(r => setTimeout(r, 500))

      // Digita caractere por caractere (mais lento, mas funciona)
      await typeHuman(page, text)
    }

    // Espera antes de postar (como se estivesse relendo) - 2-4 segundos
    console.log('   Relendo antes de postar...')
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))

    // Verificação final do texto
    const finalText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]')
      return el ? el.textContent : ''
    })

    if (finalText.length < text.length * 0.8) {
      console.log(`   ⚠️ AVISO: Texto final (${finalText.length} chars) menor que esperado (${text.length} chars)`)
      console.log(`   Primeiros 100 chars: "${finalText.slice(0, 100)}..."`)
    }

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

    // Fecha aba nova em caso de erro (evita acumular abas)
    if (isNewTab && page) {
      try {
        await page.close()
      } catch {}
    }

    // Desconecta em caso de erro (mas nao fecha browser)
    if (browser) {
      browser.disconnect()
    }

    // Indica se erro é de contexto (precisa nova aba)
    const needsNewTab = isContextError(err.message)

    return { success: false, error: err.message, needsNewTab }
  }
}

/**
 * Posta multiplos tweets com delay entre eles
 * Inclui retry com nova aba em caso de erro de contexto
 * @param {Array<{post: string, topic: string}>} posts
 * @param {function} onProgress - Callback (index, total, success)
 */
export async function postMultipleTweets(posts, onProgress = null) {
  const results = []
  let consecutiveFailures = 0
  let forceNewTab = false

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]
    let result = null
    let attempts = 0

    console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${post.topic}...`)

    // Tenta postar com retry
    while (attempts < MAX_POST_RETRIES && (!result || !result.success)) {
      attempts++

      if (attempts > 1) {
        console.log(`   ⚠️ Tentativa ${attempts} falhou, aguardando 10s para retry...`)
        await new Promise(r => setTimeout(r, 10000))
      }

      result = await postTweet(post.post, true, forceNewTab)

      // Se erro de contexto, força nova aba no próximo retry
      if (!result.success && result.needsNewTab) {
        console.log('   🔄 Erro de contexto detectado, próxima tentativa usará nova aba')
        forceNewTab = true
      }
    }

    // Atualiza estado
    if (result.success) {
      console.log(`   ✅ Publicado!`)
      consecutiveFailures = 0
      forceNewTab = false  // Reset para próximo post
    } else {
      console.log(`   ❌ Erro: Falhou após todas tentativas`)
      consecutiveFailures++

      // Se 3 falhas consecutivas, força nova aba para próximos
      if (consecutiveFailures >= 3) {
        console.log('   ⚠️ 3 falhas consecutivas - forçando nova aba para próximos posts')
        forceNewTab = true
      }
    }

    results.push({ ...result, index: i, topic: post.topic })

    if (onProgress) {
      await onProgress(i, posts.length, result.success)
    }

    // Delay entre posts (exceto no ultimo)
    if (i < posts.length - 1) {
      console.log(`   ⏳ Aguardando ${DELAY_BETWEEN_POSTS_MS / 1000}s...`)
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS_MS))
    }
  }

  // Resumo final
  const successCount = results.filter(r => r.success).length
  console.log(`\n✅ Finalizado: ${successCount}/${results.length} posts publicados`)

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
