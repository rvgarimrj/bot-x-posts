import TelegramBot from 'node-telegram-bot-api'

let bot = null

function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
  }
  return bot
}

// Escapa HTML para evitar erros de parsing
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Formata data/hora no Brasil
function formatDateTime() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

export async function sendNotification(message) {
  return getBot().sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    message,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  )
}

export async function sendPostsForReview(posts) {
  const telegramBot = getBot()
  const chatId = process.env.TELEGRAM_CHAT_ID
  const hour = new Date().getHours()

  // Header
  await telegramBot.sendMessage(chatId,
    `<b>🎯 Posts das ${hour}h - ${formatDateTime()}</b>\n\nRevise os ${posts.length} posts abaixo:`,
    { parse_mode: 'HTML' }
  )

  // Envia cada post para review
  for (let i = 0; i < posts.length; i++) {
    const { topic, post, chars } = posts[i]
    const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : '💻'

    await telegramBot.sendMessage(chatId,
      `${emoji} <b>[${i + 1}] ${topic.toUpperCase()}</b> <i>(${chars} chars)</i>\n\n"${escapeHtml(post)}"`,
      { parse_mode: 'HTML' }
    )

    await new Promise(r => setTimeout(r, 300))
  }

  // Gera botoes dinamicos baseado no numero de posts
  const copyButtons = posts.map((_, i) => ({ text: `📋 ${i + 1}`, callback_data: `copy_${i}` }))
  const postButtons = posts.map((_, i) => ({ text: `✨ Postar ${i + 1}`, callback_data: `post_${i}` }))

  // Monta teclado inline
  const keyboard = [
    copyButtons,  // Linha de copiar
    postButtons,  // Linha de postar individual
    [
      { text: '🚀 Postar Todos', callback_data: 'post_all' },
      { text: '🔄 Regenerar', callback_data: 'regenerate_all' }
    ],
    [
      { text: '❌ Cancelar', callback_data: 'cancel' }
    ]
  ]

  await telegramBot.sendMessage(chatId,
    `👆 <b>Escolha uma acao:</b>\n\n` +
    `📋 <b>1, 2...</b> - Envia post formatado pra copiar\n` +
    `✨ <b>Postar 1, 2...</b> - Publica via Playwright\n` +
    `🚀 <b>Postar Todos</b> - Publica todos automaticamente\n\n` +
    `⏰ <b>Timeout 10min</b> - Posta todos automaticamente`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    }
  )
}

export async function waitForApproval(posts, onPublish, onRegenerate) {
  const telegramBot = getBot()
  const chatId = process.env.TELEGRAM_CHAT_ID

  // Remover listeners antigos
  telegramBot.removeAllListeners('callback_query')
  telegramBot.removeAllListeners('polling_error')

  // Iniciar polling
  telegramBot.startPolling({ interval: 500 })
  console.log('🔄 Polling iniciado, aguardando acao...')

  // Track de posts ja publicados
  const postedIndexes = new Set()

  return new Promise((resolve) => {
    let resolved = false

    // Timeout de 10 minutos - posta todos automaticamente
    const TIMEOUT_MS = 10 * 60 * 1000

    const timeout = setTimeout(async () => {
      if (!resolved) {
        resolved = true
        console.log('⏰ Timeout atingido - postando todos automaticamente...')

        await telegramBot.sendMessage(chatId,
          '⏰ <b>Tempo esgotado!</b>\n\n🚀 Postando todos automaticamente via Playwright...',
          { parse_mode: 'HTML' }
        )

        // Retorna acao de postar todos
        cleanup()
        resolve({ success: true, action: 'timeout_post_all', posts, postedIndexes: Array.from(postedIndexes) })
      }
    }, TIMEOUT_MS)

    function cleanup() {
      resolved = true
      clearTimeout(timeout)
      telegramBot.stopPolling()
    }

    telegramBot.on('callback_query', async (query) => {
      if (resolved) return

      console.log(`📥 Callback recebido: ${query.data}`)

      try {
        // COPIAR POST INDIVIDUAL: copy_0, copy_1, etc
        if (query.data.startsWith('copy_')) {
          const index = parseInt(query.data.replace('copy_', ''))
          const post = posts[index]

          if (!post) {
            await telegramBot.answerCallbackQuery(query.id, { text: '❌ Post nao encontrado' })
            return
          }

          await telegramBot.answerCallbackQuery(query.id, { text: `📋 Enviando post ${index + 1}...` })

          // Envia post formatado para copiar
          const emoji = post.topic === 'crypto' ? '₿' : post.topic === 'investing' ? '📊' : '💻'

          // Gera link para abrir X ja com o texto (intent tweet)
          const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.post)}`

          await telegramBot.sendMessage(chatId,
            `${emoji} <b>Post ${index + 1} - ${post.topic.toUpperCase()}</b>\n\n` +
            `<code>${escapeHtml(post.post)}</code>\n\n` +
            `👆 Toque para copiar\n\n` +
            `<a href="${tweetIntentUrl}">🚀 Abrir no X (ja com texto)</a>`,
            { parse_mode: 'HTML' }
          )

          // NAO resolve - usuario pode continuar escolhendo
          return

        // POSTAR INDIVIDUAL: post_0, post_1, etc
        } else if (query.data.startsWith('post_')) {
          const index = parseInt(query.data.replace('post_', ''))
          const post = posts[index]

          if (!post) {
            await telegramBot.answerCallbackQuery(query.id, { text: '❌ Post nao encontrado' })
            return
          }

          if (postedIndexes.has(index)) {
            await telegramBot.answerCallbackQuery(query.id, { text: '⚠️ Ja postado!' })
            return
          }

          await telegramBot.answerCallbackQuery(query.id, { text: `🚀 Postando ${index + 1}...` })

          await telegramBot.sendMessage(chatId,
            `🚀 <b>Postando ${index + 1}/${posts.length}...</b>\n\n<i>Aguarde confirmacao</i>`,
            { parse_mode: 'HTML' }
          )

          postedIndexes.add(index)

          // Retorna para o caller postar via Playwright
          cleanup()
          resolve({ success: true, action: 'post_single', postIndex: index, post, postedIndexes: Array.from(postedIndexes) })
          return

        // POSTAR TODOS
        } else if (query.data === 'post_all') {
          resolved = true
          clearTimeout(timeout)

          await telegramBot.answerCallbackQuery(query.id, { text: '🚀 Postando todos...' })

          await telegramBot.sendMessage(chatId,
            `🚀 <b>Postando ${posts.length} posts...</b>\n\n<i>Aguarde confirmacao de cada um</i>`,
            { parse_mode: 'HTML' }
          )

          cleanup()
          resolve({ success: true, action: 'post_all', posts, postedIndexes: Array.from(postedIndexes) })

        // REGENERAR
        } else if (query.data === 'regenerate_all') {
          resolved = true
          clearTimeout(timeout)

          await telegramBot.answerCallbackQuery(query.id, { text: '🔄 Regenerando...' })

          await telegramBot.sendMessage(chatId,
            '🔄 <b>Regenerando posts...</b>\n\nAguarde novos posts.',
            { parse_mode: 'HTML' }
          )

          cleanup()
          resolve({ success: false, action: 'regenerate' })

        // CANCELAR
        } else if (query.data === 'cancel') {
          resolved = true
          clearTimeout(timeout)

          await telegramBot.answerCallbackQuery(query.id, { text: '❌ Cancelado' })

          await telegramBot.sendMessage(chatId,
            '❌ <b>Cancelado</b>\n\nNenhum post foi publicado.',
            { parse_mode: 'HTML' }
          )

          cleanup()
          resolve({ success: false, action: 'cancel' })
        }

      } catch (err) {
        if (err.message?.includes('query is too old')) {
          console.log('⚠️ Callback antigo ignorado')
          return
        }
        console.error('❌ Erro no callback:', err.message)
        try {
          await telegramBot.answerCallbackQuery(query.id, { text: '❌ Erro' })
        } catch {}
      }
    })

    telegramBot.on('polling_error', (err) => {
      console.error('Polling error:', err.message)
    })
  })
}

// Envia confirmacao de post publicado
export async function sendPostConfirmation(index, total, topic, success, url = null) {
  const telegramBot = getBot()
  const chatId = process.env.TELEGRAM_CHAT_ID
  const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : '💻'

  if (success) {
    await telegramBot.sendMessage(chatId,
      `✅ <b>[${index + 1}/${total}] ${topic.toUpperCase()}</b> publicado!${url ? `\n\n<a href="${url}">Ver no X</a>` : ''}`,
      { parse_mode: 'HTML' }
    )
  } else {
    await telegramBot.sendMessage(chatId,
      `❌ <b>[${index + 1}/${total}] ${topic.toUpperCase()}</b> falhou`,
      { parse_mode: 'HTML' }
    )
  }
}
