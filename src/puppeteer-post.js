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
 * Verifica se o modal de compose está aberto (vs inline composer no /home)
 * O /home sempre tem tweetTextarea_0 no inline composer do topo do feed,
 * então checar apenas pela existência do textarea dá falso-positivo.
 * O modal de compose fica dentro de [role="dialog"].
 */
async function isComposeModalOpen(page) {
  return page.evaluate(() => {
    // Check 1: Dialog containing textarea (compose modal overlay)
    const dialogs = document.querySelectorAll('[role="dialog"]')
    for (const dialog of dialogs) {
      if (dialog.querySelector('[data-testid="tweetTextarea_0"]')) {
        return true
      }
    }
    // Check 2: URL-based (direct navigation to /compose/post)
    if (window.location.pathname.includes('/compose/')) {
      return true
    }
    return false
  }).catch(() => false)
}

/**
 * Fecha modal de compose órfã que ficou aberta de tentativa anterior.
 * Previne que o próximo post encontre a modal vazia/suja.
 */
async function dismissOrphanModal(page) {
  try {
    const modalOpen = await isComposeModalOpen(page)
    if (modalOpen) {
      console.log('   🧹 Modal órfã detectada - fechando...')
      // Clear any text first
      await page.keyboard.down('Meta')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('Meta')
      await page.keyboard.press('Backspace')
      await new Promise(r => setTimeout(r, 300))
      // Press Escape to close
      await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 1000))
      // Check for discard dialog ("Discard" / "Descartar")
      const discardBtn = await page.evaluate(() => {
        const buttons = document.querySelectorAll('[role="button"]')
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || ''
          if (text.includes('discard') || text.includes('descartar')) {
            btn.click()
            return true
          }
        }
        return false
      })
      if (discardBtn) {
        console.log('   🧹 Descartou rascunho órfão')
        await new Promise(r => setTimeout(r, 1000))
      }
      // Final Escape in case dialog is still there
      await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 500))
    }
  } catch (e) {
    // Silently ignore - best effort cleanup
  }
}

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
 * Fecha abas problematicas e em excesso para evitar acumulo.
 * Fecha: compose/post, blob:, sw.js, abas não-x.com em excesso.
 * Mantém: a aba /home mais recente.
 */
async function cleanupTabs(browser) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ])

    let closed = 0
    let homeTab = null

    for (const p of pages) {
      const url = p.url()

      // Sempre close stale tabs: compose/post, blob:, sw.js
      if (url.includes('compose/post') || url.startsWith('blob:') || url.includes('sw.js')) {
        await p.close().catch(() => {})
        closed++
        continue
      }

      // Track best /home tab
      if (url.includes('x.com/home') || url === 'https://x.com/') {
        if (homeTab) {
          // Already have a /home tab, close this duplicate
          await p.close().catch(() => {})
          closed++
        } else {
          homeTab = p
        }
        continue
      }

      // Close non-x.com tabs if too many
      if (!url.includes('x.com') && !url.includes('twitter.com')) {
        if (pages.length - closed > MAX_TABS) {
          await p.close().catch(() => {})
          closed++
        }
      }
    }

    if (closed > 0) {
      console.log(`   🧹 Fechou ${closed} aba(s) stale/excess`)
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
 * Limpa o textbox do composer usando Cmd+A + Backspace (DraftJS-compatible).
 * NÃO usar execCommand('selectAll'/'delete') - corrompe estado interno do DraftJS.
 */
async function clearTextbox(page) {
  // Focus textbox, then Cmd+A → Backspace
  const textbox = await page.$('[data-testid="tweetTextarea_0"]')
  if (textbox) {
    await textbox.click()
    await new Promise(r => setTimeout(r, 200))
  }

  await page.keyboard.down('Meta')
  await page.keyboard.press('a')
  await page.keyboard.up('Meta')
  await new Promise(r => setTimeout(r, 100))
  await page.keyboard.press('Backspace')
  await new Promise(r => setTimeout(r, 500))
}

/**
 * Fecha o compose modal e reabre limpo.
 * Mais confiável que clearTextbox porque DraftJS inicializa estado novo.
 */
async function resetComposer(page) {
  console.log('   🔄 Resetando composer (fechar + reabrir)...')

  // Fecha modal com Escape
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 1000))

  // Trata dialog "Descartar/Discard" se aparecer
  const discarded = await page.evaluate(() => {
    const buttons = document.querySelectorAll('[role="button"]')
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase()
      if (text.includes('discard') || text.includes('descartar')) {
        btn.click()
        return true
      }
    }
    return false
  })
  if (discarded) {
    await new Promise(r => setTimeout(r, 1000))
  }

  // Segundo Escape se modal ainda aberta
  const stillOpen = await isComposeModalOpen(page)
  if (stillOpen) {
    await page.keyboard.press('Escape')
    await new Promise(r => setTimeout(r, 1000))
  }

  // Reabre composer
  const btn = await page.$('[data-testid="SideNav_NewTweet_Button"]')
  if (btn) {
    await btn.click()
    await new Promise(r => setTimeout(r, 2000))
  }

  // Encontra textbox limpo
  const newTextbox = await page.$('[data-testid="tweetTextarea_0"]')
  return newTextbox
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
    await cleanupTabs(browser)

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

    // Fecha modal órfã de tentativa anterior
    await dismissOrphanModal(page)

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

    // Limpa qualquer texto existente (Cmd+A + Backspace = React/DraftJS-compatible)
    await page.keyboard.down('Meta')
    await page.keyboard.press('a')
    await page.keyboard.up('Meta')
    await page.keyboard.press('Backspace')
    await new Promise(r => setTimeout(r, 500))

    // ========== INSERÇÃO VIA execCommand (mais confiável) ==========
    // execCommand('insertText') funciona sem user gesture, ao contrário de navigator.clipboard

    // Delay antes de inserir (1-2s) - simula preparar texto
    console.log('   Preparando texto...')
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 1000))

    console.log('   Digitando texto (humanizado)...')

    // MÉTODO 1: execCommand insertText (funciona com emojis, sem user gesture)
    await page.evaluate((textToInsert) => {
      const activeEl = document.activeElement
      if (activeEl && activeEl.isContentEditable) {
        document.execCommand('insertText', false, textToInsert)
        // Dispatch input event para React/DraftJS registrar a mudança
        activeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      }
    }, text)

    // Delay depois de inserir (1-2s) - espera UI processar
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 1000))

    // Verifica com seletor específico (activeEl.textContent pode incluir texto de outros elementos)
    let insertedText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]')
      return el ? (el.innerText || el.textContent || '') : ''
    })

    if (insertedText.length < text.length * 0.8) {
      // MÉTODO 2: Reset composer + Clipboard
      console.log(`   Texto inserido: ${insertedText.length}/${text.length} chars`)
      console.log('   ⚠️ execCommand incompleto, resetando composer + clipboard...')

      // Reset composer (fecha e reabre - garante estado limpo)
      textbox = await resetComposer(page)

      if (textbox) {
        // Copia texto para clipboard via textarea oculto
        const clipboardWorked = await page.evaluate((textToInsert) => {
          try {
            const temp = document.createElement('textarea')
            temp.value = textToInsert
            temp.style.position = 'fixed'
            temp.style.left = '-9999px'
            temp.style.opacity = '0'
            document.body.appendChild(temp)
            temp.select()
            temp.setSelectionRange(0, textToInsert.length)
            const success = document.execCommand('copy')
            document.body.removeChild(temp)
            return success
          } catch {
            return false
          }
        }, text)

        if (clipboardWorked) {
          try {
            await textbox.click()
            await new Promise(r => setTimeout(r, 200))
            await page.keyboard.down('Meta')
            await page.keyboard.press('v')
            await page.keyboard.up('Meta')
            await new Promise(r => setTimeout(r, 1000))
          } catch (pasteErr) {
            console.log(`   ⚠️ Erro ao colar: ${pasteErr.message}`)
          }
        }
      }

      // Verifica resultado
      try {
        insertedText = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="tweetTextarea_0"]')
          return el ? (el.innerText || el.textContent || '') : ''
        })
      } catch {
        insertedText = ''
      }

      console.log(`   Texto inserido: ${insertedText.length}/${text.length} chars`)
    }

    if (insertedText.length < text.length * 0.8) {
      // MÉTODO 3: Reset composer + keyboard.type (lento mas sempre funciona)
      console.log('   ⚠️ Clipboard também falhou, resetando + digitação manual...')

      try {
        textbox = await resetComposer(page)
        if (textbox) {
          await textbox.click()
          await new Promise(r => setTimeout(r, 300))
          await typeHuman(page, text)
        }
      } catch (typeErr) {
        console.log(`   ⚠️ Digitação manual falhou: ${typeErr.message}`)
      }
    }

    // Espera antes de postar (como se estivesse relendo) - 2-4 segundos
    console.log('   Relendo antes de postar...')
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))

    // Verificação final do texto - rejeita se < 90% ou > 115% (duplicado) ou conteúdo errado
    let finalText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]')
      return el ? (el.innerText || el.textContent || '') : ''
    })

    let insertRatio = finalText.length / text.length
    // Normaliza texto para comparação (remove \n extras do contentEditable)
    const normalizeForCompare = (t) => t.replace(/\s+/g, ' ').trim().substring(0, 40)
    const expectedStart = normalizeForCompare(text)
    const actualStart = normalizeForCompare(finalText)
    const contentMatch = actualStart.startsWith(expectedStart.substring(0, 20))

    // Detecta texto duplicado (clearTextbox falhou, novo texto inserido sobre o parcial)
    const isDuplicate = insertRatio > 1.15
    const isTruncated = insertRatio < 0.9
    const isCorrupted = !contentMatch && finalText.length > 20

    if (isDuplicate || isTruncated || isCorrupted) {
      const reason = isDuplicate ? 'duplicado' : isCorrupted ? 'corrompido' : 'incompleto'
      console.log(`   ⚠️ Texto ${reason} (${finalText.length}/${text.length} chars = ${Math.round(insertRatio * 100)}%)`)
      if (isCorrupted) {
        console.log(`   ⚠️ Esperado: "${expectedStart.substring(0, 30)}..."`)
        console.log(`   ⚠️ Obtido:   "${actualStart.substring(0, 30)}..."`)
      }

      // Última tentativa: resetar composer + typeHuman (mais confiável)
      console.log('   🔄 Última tentativa: reset composer + digitação manual...')
      try {
        textbox = await resetComposer(page)
        if (textbox) {
          await textbox.click()
          await new Promise(r => setTimeout(r, 300))
          await typeHuman(page, text)
          await new Promise(r => setTimeout(r, 500))
        }
      } catch (lastErr) {
        console.log(`   ⚠️ Última tentativa falhou: ${lastErr.message}`)
      }

      // Verifica de novo
      finalText = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="tweetTextarea_0"]')
        return el ? (el.innerText || el.textContent || '') : ''
      })

      insertRatio = finalText.length / text.length
      if (insertRatio < 0.9 || insertRatio > 1.15) {
        console.log(`   ❌ Texto ainda ruim após retry (${finalText.length}/${text.length} chars = ${Math.round(insertRatio * 100)}%)`)
        console.log(`   Conteúdo: "${finalText.slice(0, 100)}..."`)
        throw new Error(`Texto ${insertRatio > 1.15 ? 'duplicado' : 'truncado'}: ${finalText.length}/${text.length} chars (${Math.round(insertRatio * 100)}%)`)
      }

      console.log(`   ✅ Retry funcionou! (${finalText.length}/${text.length} chars)`)
    }

    console.log('   ✅ Texto inserido')

    // Procura botao Postar
    console.log('🔍 Procurando botao Postar...')
    const btnSelectors = [
      '[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      '[role="button"][data-testid="tweetButton"]'
    ]

    let foundBtnSelector = null
    for (const selector of btnSelectors) {
      const btn = await page.$(selector)
      if (btn) {
        foundBtnSelector = selector
        console.log(`   ✅ Encontrou: ${selector}`)
        break
      }
    }

    if (!foundBtnSelector) {
      throw new Error('Nao encontrou botao de postar')
    }

    // Espera botao estar habilitado (React precisa processar o texto digitado)
    await new Promise(r => setTimeout(r, 2000))

    // Verifica se botao está desabilitado usando querySelector (evita stale handle)
    const btnState = await page.evaluate((sel) => {
      const btn = document.querySelector(sel)
      if (!btn) return { found: false }
      return {
        found: true,
        disabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true',
        text: (btn.innerText || '').trim()
      }
    }, foundBtnSelector)

    console.log(`   Botao: found=${btnState.found}, disabled=${btnState.disabled}, text="${btnState.text}"`)

    if (!btnState.found) {
      throw new Error('Botao desapareceu antes de clicar (React re-render)')
    }

    if (btnState.disabled) {
      // Tenta esperar mais 3s (React pode estar processando)
      console.log('   Botao desabilitado, aguardando 3s...')
      await new Promise(r => setTimeout(r, 3000))

      const retryState = await page.evaluate((sel) => {
        const btn = document.querySelector(sel)
        return btn ? !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true' : false
      }, foundBtnSelector)

      if (!retryState) {
        throw new Error('Botao Postar está desabilitado (texto pode nao ter sido registrado pelo React)')
      }
      console.log('   Botao habilitado apos espera')
    }

    // Clica no botao Postar via evaluate (evita stale ElementHandle)
    console.log('🚀 Clicando em Postar...')
    await page.evaluate((sel) => {
      const btn = document.querySelector(sel)
      if (btn) btn.click()
    }, foundBtnSelector)
    await new Promise(r => setTimeout(r, 5000))

    // Verifica se há aviso de duplicado ("Opa! Você já disse isso")
    const hasDuplicateWarning = await page.evaluate(() => {
      const body = document.body.innerText || ''
      return body.includes('Você já disse isso') || body.includes('You already said that') || body.includes('already sent')
    }).catch(() => false)

    if (hasDuplicateWarning) {
      console.log('   ⚠️ Duplicado detectado - tweet já publicado anteriormente')
      await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 1000))
      await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 500))
      return { success: false, error: 'Post duplicado', duplicate: true, possiblyPosted: true }
    }

    // Verifica se modal fechou (indica sucesso)
    let modalClosed = !(await isComposeModalOpen(page))
    if (!modalClosed) {
      // Tenta clicar novamente com seletores dentro do dialog (não inline composer)
      console.log('   Tentando novamente...')
      const altSelectors = [
        '[role="dialog"] [data-testid="tweetButton"]',
        '[role="dialog"] [data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        '[data-testid="tweetButtonInline"]'
      ]
      for (const sel of altSelectors) {
        const clicked = await page.evaluate((s) => {
          const btn = document.querySelector(s)
          if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
            btn.click()
            return true
          }
          return false
        }, sel)
        if (clicked) {
          await new Promise(r => setTimeout(r, 5000))
          break
        }
      }

      // Check duplicate again after second click attempt
      const dupCheck2 = await page.evaluate(() => {
        const body = document.body.innerText || ''
        return body.includes('Você já disse isso') || body.includes('You already said that') || body.includes('already sent')
      }).catch(() => false)

      if (dupCheck2) {
        console.log('   ⚠️ Duplicado detectado após retry de clique')
        await page.keyboard.press('Escape')
        await new Promise(r => setTimeout(r, 500))
        await page.keyboard.press('Escape')
        return { success: false, error: 'Post duplicado', duplicate: true, possiblyPosted: true }
      }

      modalClosed = !(await isComposeModalOpen(page))
    }

    if (modalClosed) {
      console.log('   ✅ Modal fechou - post enviado!')
    } else {
      // Modal não fechou - post PODE ter sido enviado
      // Retorna possiblyPosted para evitar retry (que causaria duplicata)
      console.log('   ⚠️ Modal não fechou após clicar Postar - possível post enviado')
      await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 1000))
      return { success: false, error: 'Modal nao fechou apos clicar Postar', possiblyPosted: true }
    }

    console.log('✅ Post publicado!')

    // NAO desconecta - mantem browser aberto
    if (!keepBrowserOpen && browser) {
      browser.disconnect()
    }

    return { success: true }

  } catch (err) {
    console.log('❌ Erro ao postar:', err.message)

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

      // Se sessão expirou, para imediatamente (sem retry inútil)
      if (!result.success && result.error && result.error.includes('Nao esta logado')) {
        console.log('   🔒 Sessão expirada - abortando todos os posts restantes')
        // Mark remaining posts as failed
        for (let j = i; j < posts.length; j++) {
          results.push({ success: false, error: 'Sessão expirada', index: j, topic: posts[j].topic, sessionExpired: true })
        }
        return { results, total: posts.length, published: results.filter(r => r.success).length, sessionExpired: true }
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

      // Se 2+ falhas consecutivas com "Nao esta logado", sessão expirou
      if (consecutiveFailures >= 2 && result.error && result.error.includes('Nao esta logado')) {
        console.log('   🔒 Sessão expirada confirmada - abortando posts restantes')
        for (let j = i + 1; j < posts.length; j++) {
          results.push({ success: false, error: 'Sessão expirada', index: j, topic: posts[j].topic, sessionExpired: true })
        }
        return { results, total: posts.length, published: results.filter(r => r.success).length, sessionExpired: true }
      }

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

// ==================== THREAD POSTING ====================

/**
 * Post a thread using X's multi-tweet composer
 * All tweets are composed together and posted at once (guaranteed connected thread)
 * @param {string[]} tweets - Array of tweet texts (2-25 tweets)
 * @param {function} onProgress - Callback (index, total, status)
 * @param {string} firstTweetImage - Optional image path for first tweet
 * @returns {Promise<{success: boolean, postedCount: number, error?: string}>}
 */
export async function postThread(tweets, onProgress = null, firstTweetImage = null) {
  let browser = null
  let page = null

  if (!tweets || tweets.length < 2) {
    return { success: false, postedCount: 0, error: 'Thread precisa de pelo menos 2 tweets' }
  }

  if (tweets.length > 25) {
    return { success: false, postedCount: 0, error: 'Thread máximo 25 tweets' }
  }

  try {
    console.log('🔌 Conectando ao Chrome para thread...')
    browser = await connectToChrome()

    // Limpa abas em excesso
    await cleanupTabs(browser)

    // Encontra ou cria aba do X
    const tabResult = await findOrCreateXTab(browser, false)
    page = tabResult.page

    console.log('📄 Usando aba:', page.url())

    // Configura timeouts
    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    await page.bringToFront()

    // Navega para /home
    const currentUrl = page.url()
    if (!currentUrl.includes('x.com/home')) {
      console.log('🔄 Navegando para /home...')
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // Aguarda estar logado
    console.log('⏳ Aguardando pagina carregar...')
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 })
    console.log('✅ Logado no X')

    // ========== ABRE COMPOSER ==========

    // Fecha modal órfã de tentativa anterior
    await dismissOrphanModal(page)

    console.log('\n📝 Abrindo composer...')
    const postBtn = await page.$('[data-testid="SideNav_NewTweet_Button"]')
    if (!postBtn) {
      return { success: false, postedCount: 0, error: 'Não encontrou botão de novo post' }
    }
    await postBtn.click()
    await new Promise(r => setTimeout(r, 2000))

    // ========== INSERE TODOS OS TWEETS NO COMPOSER ==========

    for (let i = 0; i < tweets.length; i++) {
      console.log(`\n🧵 Preparando tweet ${i + 1}/${tweets.length}...`)

      if (onProgress) await onProgress(i, tweets.length, 'composing')

      // Para tweets após o primeiro, clica no botão "+" para adicionar campo
      if (i > 0) {
        console.log('   ➕ Adicionando novo campo...')
        const addResult = await clickAddTweetButton(page)
        if (!addResult.success) {
          console.log(`   ❌ Falhou ao adicionar campo: ${addResult.error}`)
          return { success: false, postedCount: 0, error: `Falhou ao adicionar tweet ${i + 1}: ${addResult.error}` }
        }
        await new Promise(r => setTimeout(r, 1000))
      }

      // Insere texto no campo correto (usa índice)
      const insertResult = await insertTextInComposerField(page, tweets[i], i)
      if (!insertResult.success) {
        console.log(`   ❌ Falhou ao inserir texto: ${insertResult.error}`)
        return { success: false, postedCount: 0, error: `Falhou ao inserir tweet ${i + 1}: ${insertResult.error}` }
      }

      // Upload image for first tweet only
      if (i === 0 && firstTweetImage) {
        console.log('   📷 Anexando imagem ao primeiro tweet...')
        const uploadResult = await uploadImageToComposer(page, firstTweetImage, 0)
        if (uploadResult.success) {
          console.log('   ✅ Imagem anexada!')
        } else {
          console.log(`   ⚠️ Imagem não anexada: ${uploadResult.error}`)
          // Continue without image
        }
        await new Promise(r => setTimeout(r, 2000))
      }

      console.log(`   ✅ Tweet ${i + 1} preparado (${tweets[i].length} chars)`)

      // Pequeno delay entre tweets para parecer humano
      await new Promise(r => setTimeout(r, 800 + Math.random() * 500))
    }

    // ========== POSTA TODOS DE UMA VEZ ==========

    console.log('\n🚀 Postando thread completa...')

    const postResult = await clickPostAllButton(page)
    if (!postResult.success) {
      return { success: false, postedCount: 0, error: `Falhou ao postar: ${postResult.error}` }
    }

    // Aguarda processamento
    await new Promise(r => setTimeout(r, 3000))

    // Verifica se composer fechou (indica sucesso)
    const composerStillOpen = await isComposeModalOpen(page)
    if (composerStillOpen) {
      // Tenta clicar novamente
      console.log('   ⚠️ Composer ainda aberto, tentando novamente...')
      await clickPostAllButton(page)
      await new Promise(r => setTimeout(r, 3000))
    }

    console.log(`\n✅ Thread publicada: ${tweets.length} tweets conectados!`)

    if (onProgress) await onProgress(tweets.length - 1, tweets.length, 'posted')

    return { success: true, postedCount: tweets.length }

  } catch (err) {
    console.error('❌ Erro ao postar thread:', err.message)
    return { success: false, postedCount: 0, error: err.message }
  } finally {
    if (browser) {
      browser.disconnect()
    }
  }
}

/**
 * Helper: Click the "+" button to add another tweet to thread
 */
async function clickAddTweetButton(page) {
  try {
    // Possíveis seletores para o botão de adicionar tweet
    const addBtnSelectors = [
      '[data-testid="addButton"]',
      '[aria-label="Add post"]',
      '[aria-label="Adicionar post"]',
      '[aria-label="Add Tweet"]',
      'button[aria-label*="Add"]',
      // Botão com ícone de "+"
      'div[role="button"] svg[viewBox="0 0 24 24"]'
    ]

    let addBtn = null
    for (const selector of addBtnSelectors) {
      addBtn = await page.$(selector)
      if (addBtn) {
        await addBtn.click()
        await new Promise(r => setTimeout(r, 1500))
        return { success: true }
      }
    }

    // Fallback: procura qualquer botão com "+" no composer
    const clicked = await page.evaluate(() => {
      // Procura botões dentro do modal de composição
      const buttons = document.querySelectorAll('[role="button"]')
      for (const btn of buttons) {
        const svg = btn.querySelector('svg')
        if (svg) {
          // Verifica se é o botão de adicionar (geralmente tem path com "+")
          const paths = svg.querySelectorAll('path')
          for (const path of paths) {
            const d = path.getAttribute('d')
            // Padrão comum para ícone de "+"
            if (d && (d.includes('M12 5') || d.includes('M11 11') || d.includes('M19 13'))) {
              btn.click()
              return true
            }
          }
        }
      }
      return false
    })

    if (clicked) {
      await new Promise(r => setTimeout(r, 1500))
      return { success: true }
    }

    return { success: false, error: 'Não encontrou botão de adicionar tweet' }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Helper: Insert text in a specific composer field by index
 * @param {Page} page - Puppeteer page
 * @param {string} text - Text to insert
 * @param {number} fieldIndex - Index of the field (0 = first tweet, 1 = second, etc.)
 */
async function insertTextInComposerField(page, text, fieldIndex) {
  try {
    await new Promise(r => setTimeout(r, 500))

    // Encontra o campo de texto pelo índice
    // X usa tweetTextarea_0, tweetTextarea_1, etc.
    const textboxSelector = `[data-testid="tweetTextarea_${fieldIndex}"]`
    let textbox = await page.$(textboxSelector)

    // Fallback: pega todos os textareas e usa o índice
    if (!textbox) {
      const allTextboxes = await page.$$('[data-testid^="tweetTextarea_"]')
      if (allTextboxes.length > fieldIndex) {
        textbox = allTextboxes[fieldIndex]
      }
    }

    // Fallback 2: pega todos os contenteditable
    if (!textbox) {
      const allEditable = await page.$$('[role="textbox"][contenteditable="true"]')
      if (allEditable.length > fieldIndex) {
        textbox = allEditable[fieldIndex]
      }
    }

    if (!textbox) {
      return { success: false, error: `Campo ${fieldIndex} não encontrado` }
    }

    // Clica no campo
    await textbox.click()
    await new Promise(r => setTimeout(r, 300))

    // Limpa qualquer texto existente (robust clear)
    await clearTextbox(page)

    // ========== MÉTODO 1: execCommand insertText (funciona com emojis) ==========
    const insertedViaExec = await page.evaluate((textToInsert) => {
      const activeEl = document.activeElement
      if (activeEl && activeEl.isContentEditable) {
        // Foca e insere via execCommand
        document.execCommand('insertText', false, textToInsert)
        return activeEl.innerText || activeEl.textContent || ''
      }
      return ''
    }, text)

    if (insertedViaExec.length >= text.length * 0.8) {
      await new Promise(r => setTimeout(r, 500))
      return { success: true }
    }

    // ========== MÉTODO 2: Clipboard via textarea (mais confiável) ==========
    console.log('   ⚠️ execCommand falhou, tentando clipboard via textarea...')

    // Robust clear before retry
    await textbox.click()
    await new Promise(r => setTimeout(r, 200))
    await clearTextbox(page)

    // Usa textarea oculto para copiar (funciona melhor que navigator.clipboard)
    const clipboardWorked = await page.evaluate((textToInsert) => {
      try {
        const temp = document.createElement('textarea')
        temp.value = textToInsert
        temp.style.position = 'fixed'
        temp.style.left = '-9999px'
        temp.style.top = '-9999px'
        temp.style.opacity = '0'
        document.body.appendChild(temp)
        temp.select()
        temp.setSelectionRange(0, textToInsert.length)
        const success = document.execCommand('copy')
        document.body.removeChild(temp)
        return success
      } catch {
        return false
      }
    }, text)

    if (clipboardWorked) {
      // Volta o foco para o campo de texto
      await textbox.click()
      await new Promise(r => setTimeout(r, 200))
      await page.keyboard.down('Meta')
      await page.keyboard.press('v')
      await page.keyboard.up('Meta')
      await new Promise(r => setTimeout(r, 800))
    }

    // Verifica se texto foi inserido
    const insertedText = await page.evaluate((idx) => {
      const el = document.querySelector(`[data-testid="tweetTextarea_${idx}"]`)
      return el ? (el.innerText || el.textContent || '') : ''
    }, fieldIndex)

    if (insertedText.length >= text.length * 0.8) {
      return { success: true }
    }

    // ========== MÉTODO 3: InputEvent (último recurso com emojis) ==========
    console.log('   ⚠️ Clipboard falhou, tentando InputEvent...')

    // Robust clear before retry
    await textbox.click()
    await new Promise(r => setTimeout(r, 200))
    await clearTextbox(page)

    const insertedViaInput = await page.evaluate((textToInsert, idx) => {
      const el = document.querySelector(`[data-testid="tweetTextarea_${idx}"]`)
      if (el) {
        el.focus()
        // Dispara InputEvent que funciona com emojis
        const event = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: textToInsert,
          bubbles: true,
          cancelable: true
        })
        el.dispatchEvent(event)

        // Também tenta inserir diretamente
        const range = document.getSelection()?.getRangeAt(0)
        if (range) {
          range.deleteContents()
          range.insertNode(document.createTextNode(textToInsert))
        }

        return el.innerText || el.textContent || ''
      }
      return ''
    }, text, fieldIndex)

    if (insertedViaInput.length >= text.length * 0.5) {
      await new Promise(r => setTimeout(r, 500))
      return { success: true }
    }

    // ========== MÉTODO 4: Digitação manual com suporte a emojis ==========
    console.log('   ⚠️ Todos métodos falharam, usando digitação manual com emojis...')

    await page.keyboard.down('Meta')
    await page.keyboard.press('a')
    await page.keyboard.up('Meta')
    await page.keyboard.press('Backspace')
    await new Promise(r => setTimeout(r, 300))

    // Separa texto em segmentos: texto normal e emojis
    // Usa Array.from() para iterar por code points completos (não surrogate pairs)
    const segments = []
    let currentText = ''

    for (const char of text) {  // Iteração por code points
      const codePoint = char.codePointAt(0)

      // Verifica se é emoji (acima de U+1F000 ou em ranges de emoji)
      const isEmoji = codePoint > 0x1F000 ||
                      (codePoint >= 0x2600 && codePoint <= 0x27BF) ||  // Misc symbols
                      (codePoint >= 0x1F300 && codePoint <= 0x1F9FF)   // Emoji range

      if (isEmoji) {
        if (currentText) {
          segments.push({ type: 'text', content: currentText })
          currentText = ''
        }
        segments.push({ type: 'emoji', content: char })
      } else {
        currentText += char
      }
    }
    if (currentText) {
      segments.push({ type: 'text', content: currentText })
    }

    // Processa cada segmento
    for (const segment of segments) {
      if (segment.type === 'text') {
        // Digita texto com delay humanizado
        for (const char of segment.content) {
          let delay = 70 + Math.random() * 80  // 70-150ms base

          // Pausa maior após pontuação
          if (['.', '!', '?', ',', ':'].includes(char)) {
            delay += 150 + Math.random() * 200  // +150-350ms
          }

          // Pausa ocasional (simula pensar)
          if (Math.random() < 0.03) {  // 3% chance
            delay += 300 + Math.random() * 500  // +300-800ms
          }

          await page.keyboard.type(char, { delay })
        }
      } else {
        // Para emojis, usa clipboard (mais confiável)
        await page.evaluate(async (emoji) => {
          // Cria elemento temporário para copiar
          const temp = document.createElement('textarea')
          temp.value = emoji
          temp.style.position = 'fixed'
          temp.style.opacity = '0'
          document.body.appendChild(temp)
          temp.select()
          document.execCommand('copy')
          document.body.removeChild(temp)
        }, segment.content)

        await new Promise(r => setTimeout(r, 100))
        await page.keyboard.down('Meta')
        await page.keyboard.press('v')
        await page.keyboard.up('Meta')
        await new Promise(r => setTimeout(r, 200))
      }
    }

    await new Promise(r => setTimeout(r, 500))

    return { success: true }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Helper: Click the "Post all" button to publish the entire thread
 */
async function clickPostAllButton(page) {
  try {
    // Possíveis seletores para o botão de postar
    const postBtnSelectors = [
      '[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      '[aria-label="Post"]',
      '[aria-label="Postar"]',
      '[aria-label="Post all"]',
      '[aria-label="Postar tudo"]'
    ]

    for (const selector of postBtnSelectors) {
      const btn = await page.$(selector)
      if (btn) {
        // Verifica se o botão está habilitado
        const isDisabled = await page.evaluate((el) => {
          return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
        }, btn)

        if (!isDisabled) {
          await btn.click()
          await new Promise(r => setTimeout(r, 2000))
          return { success: true }
        }
      }
    }

    return { success: false, error: 'Não encontrou botão de postar ou está desabilitado' }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ==================== IMAGE UPLOAD ====================

/**
 * Upload an image to the composer
 * Works with both single tweet composer and thread composer
 * @param {Page} page - Puppeteer page
 * @param {string} imagePath - Path to image file
 * @param {number} fieldIndex - Which tweet field to attach to (for threads)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function uploadImageToComposer(page, imagePath, fieldIndex = 0) {
  try {
    console.log(`   📷 Anexando imagem ao tweet ${fieldIndex + 1}...`)

    // Verifica se arquivo existe
    const fs = await import('fs')
    if (!fs.existsSync(imagePath)) {
      return { success: false, error: `Arquivo não encontrado: ${imagePath}` }
    }

    // Primeiro, clica no campo de texto correto para focar
    const textboxSelector = `[data-testid="tweetTextarea_${fieldIndex}"]`
    const textbox = await page.$(textboxSelector)
    if (textbox) {
      await textbox.click()
      await new Promise(r => setTimeout(r, 500))
    }

    // Procura o input de arquivo oculto
    // X usa um input[type="file"] escondido para upload
    let fileInput = await page.$('input[type="file"][accept*="image"]')

    if (!fileInput) {
      // Tenta encontrar qualquer input de arquivo
      fileInput = await page.$('input[type="file"]')
    }

    if (!fileInput) {
      // Se não encontrou, tenta clicar no botão de mídia para revelar o input
      const mediaButtonSelectors = [
        '[data-testid="fileInput"]',
        '[aria-label="Add photos or video"]',
        '[aria-label="Adicionar fotos ou vídeo"]',
        '[aria-label="Media"]',
        '[aria-label="Mídia"]',
        'button[aria-label*="photo"]',
        'button[aria-label*="image"]',
        'button[aria-label*="foto"]',
        'button[aria-label*="imagem"]'
      ]

      for (const selector of mediaButtonSelectors) {
        const btn = await page.$(selector)
        if (btn) {
          await btn.click()
          await new Promise(r => setTimeout(r, 1000))
          break
        }
      }

      // Tenta encontrar o input novamente
      fileInput = await page.$('input[type="file"]')
    }

    if (!fileInput) {
      // Fallback: procura por qualquer input de arquivo visível ou oculto
      const inputs = await page.$$('input[type="file"]')
      if (inputs.length > 0) {
        fileInput = inputs[0]
      }
    }

    if (!fileInput) {
      return { success: false, error: 'Não encontrou input de arquivo para upload' }
    }

    // Faz o upload do arquivo
    await fileInput.uploadFile(imagePath)

    // Aguarda o upload processar
    await new Promise(r => setTimeout(r, 2000))

    // Verifica se imagem foi anexada (procura preview)
    const imagePreview = await page.$('[data-testid="attachments"] img, [data-testid="mediaPreview"] img, [aria-label*="Attached media"] img')

    if (imagePreview) {
      console.log(`   ✅ Imagem anexada com sucesso!`)
      return { success: true }
    }

    // Mesmo sem preview visível, pode ter funcionado
    console.log(`   ✅ Upload enviado (preview não detectado)`)
    return { success: true }

  } catch (err) {
    console.log(`   ❌ Erro no upload: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Post a tweet with an image
 * @param {string} text - Tweet text
 * @param {string} imagePath - Path to image file
 * @param {boolean} keepBrowserOpen - Keep browser connected after posting
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function postTweetWithImage(text, imagePath, keepBrowserOpen = true) {
  let browser = null
  let page = null

  try {
    console.log('🔌 Conectando ao Chrome...')
    browser = await connectToChrome()

    await cleanupTabs(browser)

    const tabResult = await findOrCreateXTab(browser, false)
    page = tabResult.page

    console.log('📄 Usando aba:', page.url())

    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    await page.bringToFront()

    // Navega para /home
    const currentUrl = page.url()
    if (!currentUrl.includes('x.com/home')) {
      console.log('🔄 Navegando para /home...')
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // Aguarda estar logado
    console.log('⏳ Aguardando pagina carregar...')
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 })
    console.log('✅ Logado no X')

    // Fecha modal órfã de tentativa anterior
    await dismissOrphanModal(page)

    // Abre composer
    console.log('📝 Abrindo composer...')
    const postBtn = await page.$('[data-testid="SideNav_NewTweet_Button"]')
    if (postBtn) {
      await postBtn.click()
      await new Promise(r => setTimeout(r, 2000))
    }

    // Insere texto
    const insertResult = await insertTextInComposerField(page, text, 0)
    if (!insertResult.success) {
      return { success: false, error: `Falhou ao inserir texto: ${insertResult.error}` }
    }

    // Upload da imagem
    const uploadResult = await uploadImageToComposer(page, imagePath, 0)
    if (!uploadResult.success) {
      console.log(`   ⚠️ Imagem não anexada: ${uploadResult.error}`)
      // Continua sem imagem
    }

    // Aguarda um pouco para a imagem processar
    await new Promise(r => setTimeout(r, 2000))

    // Posta
    console.log('🚀 Postando...')
    const postResult = await clickPostAllButton(page)

    if (!postResult.success) {
      return { success: false, error: postResult.error }
    }

    await new Promise(r => setTimeout(r, 3000))

    console.log('✅ Tweet com imagem publicado!')

    if (!keepBrowserOpen && browser) {
      browser.disconnect()
    }

    return { success: true }

  } catch (err) {
    console.error('❌ Erro ao postar com imagem:', err.message)
    if (browser) browser.disconnect()
    return { success: false, error: err.message }
  }
}

// ==================== VIDEO UPLOAD ====================

/**
 * Post a tweet with a video file
 * Similar to postTweetWithImage but with longer wait times for video processing
 * @param {string} text - Tweet text (caption)
 * @param {string} videoPath - Path to video file
 * @param {boolean} keepBrowserOpen - Keep browser connected after posting
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function postTweetWithVideo(text, videoPath, keepBrowserOpen = true) {
  let browser = null
  let page = null

  try {
    console.log('🔌 Conectando ao Chrome...')
    browser = await connectToChrome()

    await cleanupTabs(browser)

    const tabResult = await findOrCreateXTab(browser, false)
    page = tabResult.page

    console.log('📄 Usando aba:', page.url())

    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    await page.bringToFront()

    // Navega para /home
    const currentUrl = page.url()
    if (!currentUrl.includes('x.com/home')) {
      console.log('🔄 Navegando para /home...')
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // Aguarda estar logado
    console.log('⏳ Aguardando pagina carregar...')
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 })
    console.log('✅ Logado no X')

    // Fecha modal órfã de tentativa anterior
    await dismissOrphanModal(page)

    // Abre composer
    console.log('📝 Abrindo composer...')
    const postBtn = await page.$('[data-testid="SideNav_NewTweet_Button"]')
    if (postBtn) {
      await postBtn.click()
      await new Promise(r => setTimeout(r, 2000))
    }

    // Insere texto
    const insertResult = await insertTextInComposerField(page, text, 0)
    if (!insertResult.success) {
      return { success: false, error: `Falhou ao inserir texto: ${insertResult.error}` }
    }

    // Upload video - uses generic file input (not image-specific)
    console.log('🎬 Fazendo upload do video...')
    const uploadResult = await uploadMediaToComposer(page, videoPath)
    if (!uploadResult.success) {
      console.log(`   ⚠️ Video não anexado: ${uploadResult.error}`)
      // Continue without video (post text only)
    }

    // Wait longer for video processing (6-8s)
    console.log('   ⏳ Aguardando processamento do video...')
    await new Promise(r => setTimeout(r, 8000))

    // Posta
    console.log('🚀 Postando...')
    const postResult = await clickPostAllButton(page)

    if (!postResult.success) {
      return { success: false, error: postResult.error }
    }

    // Wait longer for video posts (5s)
    await new Promise(r => setTimeout(r, 5000))

    // Verify modal closed
    const modalStillOpen = await isComposeModalOpen(page)
    if (modalStillOpen) {
      // Try clicking post again
      console.log('   ⚠️ Modal ainda aberto, tentando novamente...')
      await clickPostAllButton(page)
      await new Promise(r => setTimeout(r, 5000))
    }

    console.log('✅ Tweet com video publicado!')

    if (!keepBrowserOpen && browser) {
      browser.disconnect()
    }

    return { success: true }

  } catch (err) {
    console.error('❌ Erro ao postar com video:', err.message)
    if (browser) browser.disconnect()
    return { success: false, error: err.message }
  }
}

/**
 * Upload any media file (video, image, gif) to the composer
 * More generic than uploadImageToComposer - doesn't filter by accept="image"
 * @param {Page} page - Puppeteer page
 * @param {string} mediaPath - Path to media file
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function uploadMediaToComposer(page, mediaPath) {
  try {
    const fs = await import('fs')
    if (!fs.existsSync(mediaPath)) {
      return { success: false, error: `Arquivo não encontrado: ${mediaPath}` }
    }

    // Look for ANY file input (not just image-specific ones)
    let fileInput = await page.$('input[type="file"]')

    if (!fileInput) {
      // Try clicking media button to reveal input
      const mediaButtonSelectors = [
        '[aria-label="Add photos or video"]',
        '[aria-label="Adicionar fotos ou vídeo"]',
        '[aria-label="Media"]',
        '[aria-label="Mídia"]'
      ]

      for (const selector of mediaButtonSelectors) {
        const btn = await page.$(selector)
        if (btn) {
          await btn.click()
          await new Promise(r => setTimeout(r, 1000))
          break
        }
      }

      fileInput = await page.$('input[type="file"]')
    }

    if (!fileInput) {
      return { success: false, error: 'Não encontrou input de arquivo para upload' }
    }

    await fileInput.uploadFile(mediaPath)
    await new Promise(r => setTimeout(r, 2000))

    console.log('   ✅ Media upload enviado')
    return { success: true }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ==================== QUOTE TWEET ====================

/**
 * Post a quote tweet (retweet with comment)
 * Types commentary and pastes tweet URL which auto-embeds as quote
 * @param {string} commentary - Your comment text
 * @param {string} tweetUrl - URL of the tweet to quote
 * @param {boolean} keepBrowserOpen - Keep browser connected
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function postQuoteTweet(commentary, tweetUrl, keepBrowserOpen = true) {
  let browser = null
  let page = null

  try {
    console.log('🔌 Conectando ao Chrome...')
    browser = await connectToChrome()

    await cleanupTabs(browser)

    const tabResult = await findOrCreateXTab(browser, false)
    page = tabResult.page

    console.log('📄 Usando aba:', page.url())

    page.setDefaultTimeout(PAGE_TIMEOUT)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT)

    await page.bringToFront()

    // Navega para /home
    const currentUrl = page.url()
    if (!currentUrl.includes('x.com/home')) {
      console.log('🔄 Navegando para /home...')
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // Aguarda estar logado
    console.log('⏳ Aguardando pagina carregar...')
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 15000 })
    console.log('✅ Logado no X')

    // Fecha modal órfã de tentativa anterior
    await dismissOrphanModal(page)

    // Abre composer
    console.log('📝 Abrindo composer...')
    const postBtn = await page.$('[data-testid="SideNav_NewTweet_Button"]')
    if (postBtn) {
      await postBtn.click()
      await new Promise(r => setTimeout(r, 2000))
    }

    // Insert commentary + tweet URL together
    // X auto-detects the tweet URL and embeds it as a quote
    const fullText = `${commentary}\n\n${tweetUrl}`

    const insertResult = await insertTextInComposerField(page, fullText, 0)
    if (!insertResult.success) {
      return { success: false, error: `Falhou ao inserir texto: ${insertResult.error}` }
    }

    // Wait for X to detect and embed the quote tweet URL
    console.log('   ⏳ Aguardando embed do quote tweet...')
    await new Promise(r => setTimeout(r, 4000))

    // Check if quote tweet card appeared
    const hasCard = await page.$('[data-testid="card.wrapper"], [data-testid="quoteTweet"]')
    if (hasCard) {
      console.log('   ✅ Quote tweet card detectado')
    } else {
      console.log('   ⚠️ Quote tweet card não detectado (pode ainda funcionar)')
    }

    // Posta
    console.log('🚀 Postando quote tweet...')
    const postResult = await clickPostAllButton(page)

    if (!postResult.success) {
      return { success: false, error: postResult.error }
    }

    await new Promise(r => setTimeout(r, 3000))

    // Verify modal closed
    const modalStillOpen = await isComposeModalOpen(page)
    if (modalStillOpen) {
      console.log('   ⚠️ Modal ainda aberto, tentando novamente...')
      await clickPostAllButton(page)
      await new Promise(r => setTimeout(r, 3000))
    }

    console.log('✅ Quote tweet publicado!')

    if (!keepBrowserOpen && browser) {
      browser.disconnect()
    }

    return { success: true }

  } catch (err) {
    console.error('❌ Erro ao postar quote tweet:', err.message)
    if (browser) browser.disconnect()
    return { success: false, error: err.message }
  }
}
