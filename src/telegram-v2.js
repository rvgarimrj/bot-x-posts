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

  // Header
  await telegramBot.sendMessage(chatId,
    `<b>🎯 Posts Gerados - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</b>\n\nRevise os 4 posts abaixo:`,
    { parse_mode: 'HTML' }
  )

  // Envia cada post para review (sem botões individuais)
  for (let i = 0; i < posts.length; i++) {
    const { topic, post, chars } = posts[i]
    const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : topic === 'ia' ? '🤖' : '💻'

    await telegramBot.sendMessage(chatId,
      `${emoji} <b>[${i + 1}] ${topic.toUpperCase()}</b> <i>(${chars} chars)</i>\n\n"${escapeHtml(post)}"`,
      { parse_mode: 'HTML' }
    )

    await new Promise(r => setTimeout(r, 300))
  }

  // Botões de ação global
  await telegramBot.sendMessage(chatId,
    `👆 <b>Revise os 4 posts acima</b>\n\n⏰ Se não clicar em nada, publica automaticamente em 20 minutos.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Aprovar e Publicar Todos', callback_data: 'approve_all' },
          { text: '🔄 Regenerar', callback_data: 'regenerate_all' }
        ]]
      }
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
  console.log('🔄 Polling iniciado, aguardando aprovação...')

  return new Promise((resolve) => {
    let resolved = false

    // Timeout de 20 minutos - depois publica automaticamente
    const TIMEOUT_MS = 20 * 60 * 1000

    const timeout = setTimeout(async () => {
      if (!resolved) {
        resolved = true
        console.log('⏰ Timeout atingido - publicando automaticamente...')

        await telegramBot.sendMessage(chatId,
          '⏰ <b>Tempo esgotado!</b>\n\n🤖 Publicando os 4 posts automaticamente...',
          { parse_mode: 'HTML' }
        )

        const results = await publishAllPosts(posts, onPublish, telegramBot, chatId)

        cleanup()
        resolve({ success: true, action: 'auto', results })
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
        if (query.data === 'approve_all') {
          resolved = true
          clearTimeout(timeout)

          await telegramBot.answerCallbackQuery(query.id, { text: '✅ Aprovado! Publicando...' })

          await telegramBot.sendMessage(chatId,
            '✅ <b>Aprovado!</b>\n\n🤖 Publicando os 4 posts (aguarde, respeitando rate limits)...',
            { parse_mode: 'HTML' }
          )

          const results = await publishAllPosts(posts, onPublish, telegramBot, chatId)

          cleanup()
          resolve({ success: true, action: 'approved', results })

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

async function publishAllPosts(posts, onPublish, telegramBot, chatId) {
  const results = []
  const DELAY_BETWEEN_POSTS = 30000 // 30 segundos entre posts para evitar rate limit

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]

    console.log(`📤 Publicando [${i + 1}] ${post.topic}...`)

    try {
      const result = await onPublish(post.post)
      results.push({ success: true, topic: post.topic, url: result.url })

      await telegramBot.sendMessage(chatId,
        `✅ <b>[${i + 1}/${posts.length}] ${post.topic.toUpperCase()}</b> publicado!\n\n<a href="${result.url}">Ver no X</a>`,
        { parse_mode: 'HTML' }
      )

      console.log(`   ✅ ${result.url}`)

      // Aguarda entre posts (exceto no último)
      if (i < posts.length - 1) {
        console.log(`   ⏳ Aguardando 30s antes do próximo...`)
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS))
      }

    } catch (err) {
      console.error(`   ❌ Erro: ${err.message}`)
      results.push({ success: false, topic: post.topic, error: err.message })

      let errorMsg = err.message

      // Rate limit persistente - não tentar mais, seguir em frente
      if (err.isRateLimit || err.message?.includes('429') || err.message === 'RATE_LIMIT_EXCEEDED') {
        errorMsg = '⚠️ Rate limit do Twitter atingido. Limite diário possivelmente esgotado.'
        console.log(`   ⚠️ Rate limit persistente - pulando para próximo post`)

        // Se é o primeiro post com rate limit, abortar todos os demais
        if (i === 0) {
          await telegramBot.sendMessage(chatId,
            `🚫 <b>Rate limit do Twitter!</b>\n\nO limite de posts foi atingido. Tente novamente mais tarde (geralmente reseta à meia-noite).\n\nNenhum post foi publicado.`,
            { parse_mode: 'HTML' }
          )
          return results
        }
      }

      await telegramBot.sendMessage(chatId,
        `❌ <b>[${i + 1}/${posts.length}] ${post.topic.toUpperCase()}</b> falhou\n\n${errorMsg}`,
        { parse_mode: 'HTML' }
      )
    }
  }

  // Resumo final
  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  await telegramBot.sendMessage(chatId,
    `🏁 <b>Publicação concluída!</b>\n\n✅ ${successCount} publicados\n❌ ${failedCount} falharam`,
    { parse_mode: 'HTML' }
  )

  return results
}
