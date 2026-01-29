/**
 * Playwright MCP Integration for X (Twitter) posting
 *
 * Este modulo conecta ao Chrome em modo debug e digita posts
 * como um humano usando Playwright MCP.
 *
 * REQUISITOS:
 * - Chrome rodando com: --remote-debugging-port=9222
 * - Usuario logado no X.com
 * - Playwright MCP disponivel no ambiente Claude Code
 */

// Delays de digitacao humana (em ms)
const TYPING_DELAYS = {
  minChar: 50,      // Minimo entre caracteres
  maxChar: 150,     // Maximo entre caracteres
  afterPunctuation: { min: 200, max: 500 },  // Apos . , ! ? ; :
  thinkingPause: { min: 500, max: 1500, probability: 0.05 }  // 5% chance de pausar
}

// Delay entre posts
const DELAY_BETWEEN_POSTS_MS = 60000  // 60 segundos

/**
 * Calcula delay entre caracteres baseado no caractere anterior
 */
function getTypingDelay(char, prevChar) {
  // Pausa maior apos pontuacao
  if (['.', ',', '!', '?', ';', ':'].includes(prevChar)) {
    const { min, max } = TYPING_DELAYS.afterPunctuation
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  // Pausa ocasional "pensando"
  if (Math.random() < TYPING_DELAYS.thinkingPause.probability) {
    const { min, max } = TYPING_DELAYS.thinkingPause
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  // Delay normal entre caracteres
  const { minChar, maxChar } = TYPING_DELAYS
  return Math.floor(Math.random() * (maxChar - minChar + 1)) + minChar
}

/**
 * Gera instrucoes para digitar texto como humano
 * Retorna array de { char, delay } para processamento sequencial
 */
export function generateHumanTypingSequence(text) {
  const sequence = []
  let prevChar = ''

  for (const char of text) {
    const delay = getTypingDelay(char, prevChar)
    sequence.push({ char, delay })
    prevChar = char
  }

  return sequence
}

/**
 * Verifica se Chrome esta conectado na porta debug
 */
export async function checkChromeConnection() {
  try {
    const response = await fetch('http://localhost:9222/json/version')
    if (response.ok) {
      const data = await response.json()
      return { connected: true, browser: data.Browser }
    }
  } catch {
    // Chrome nao esta em modo debug
  }
  return { connected: false, browser: null }
}

/**
 * Instrucoes para o agente Playwright MCP postar um tweet
 * Retorna objeto com passos a seguir
 */
export function getPostingInstructions(postText) {
  return {
    steps: [
      {
        action: 'navigate',
        description: 'Navegar para X.com',
        command: 'browser_navigate',
        params: { url: 'https://x.com' }
      },
      {
        action: 'wait',
        description: 'Aguardar pagina carregar',
        waitMs: 2000
      },
      {
        action: 'click',
        description: 'Clicar no botao de novo post',
        command: 'browser_click',
        selector: '[data-testid="SideNav_NewTweet_Button"]',
        fallbackSelector: 'a[href="/compose/post"]'
      },
      {
        action: 'wait',
        description: 'Aguardar modal de compose abrir',
        waitMs: 1500
      },
      {
        action: 'type',
        description: 'Digitar texto do post como humano',
        command: 'browser_type',
        text: postText,
        humanTyping: true,
        typingSequence: generateHumanTypingSequence(postText)
      },
      {
        action: 'wait',
        description: 'Aguardar antes de publicar',
        waitMs: 1000
      },
      {
        action: 'click',
        description: 'Clicar no botao Postar',
        command: 'browser_click',
        selector: '[data-testid="tweetButton"]',
        fallbackSelector: '[data-testid="tweetButtonInline"]'
      },
      {
        action: 'wait',
        description: 'Aguardar post ser publicado',
        waitMs: 3000
      }
    ],
    totalEstimatedTime: 8000 + (postText.length * 100)  // tempo base + tempo de digitacao
  }
}

/**
 * Gera script de Playwright para postar multiplos tweets
 */
export function generateMultiPostScript(posts) {
  const scripts = []

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]

    scripts.push({
      index: i + 1,
      total: posts.length,
      topic: post.topic,
      text: post.post,
      instructions: getPostingInstructions(post.post),
      delayAfter: i < posts.length - 1 ? DELAY_BETWEEN_POSTS_MS : 0
    })
  }

  return {
    scripts,
    totalPosts: posts.length,
    estimatedTotalTime: posts.length * (8000 + 200 * 100) + (posts.length - 1) * DELAY_BETWEEN_POSTS_MS
  }
}

/**
 * Mensagem formatada para usuario sobre pre-requisitos
 */
export function getPrerequisitesMessage() {
  return `Para usar Auto-Digitar via Playwright:

1. Abra Chrome em modo debug:
   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222

2. Faca login no X.com nesse Chrome

3. Mantenha o Chrome aberto e volte aqui

O bot vai digitar cada post como humano (50-150ms entre teclas) e esperar 60s entre posts.`
}

/**
 * Formata post para copiar (versao Telegram)
 */
export function formatPostForCopy(post, index, total) {
  const emoji = post.topic === 'crypto' ? '\u20bf' :
                post.topic === 'investing' ? '\ud83d\udcca' : '\ud83d\udcbb'

  return `${emoji} Post ${index}/${total} - ${post.topic.toUpperCase()}

${post.post}

(${post.chars} chars)`
}
