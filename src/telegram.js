import TelegramBot from 'node-telegram-bot-api'

let bot = null

export function initTelegram(polling = false) {
  if (bot) {
    // Se já existe um bot e queremos polling, precisamos recriar
    if (polling && !bot.isPolling()) {
      bot.startPolling()
    }
    return bot
  }

  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: polling ? { interval: 1000, autoStart: true } : false
  })

  if (polling) {
    bot.on('polling_error', (err) => {
      console.error('Polling error:', err.message)
    })
  }

  return bot
}

export async function sendNotification(message) {
  const telegramBot = initTelegram(false)
  return telegramBot.sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    message,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  )
}

export async function sendPostsForApproval(posts) {
  const telegramBot = initTelegram(false)
  const chatId = process.env.TELEGRAM_CHAT_ID

  await telegramBot.sendMessage(chatId,
    `<b>🎯 Posts Gerados - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</b>\n\nClique para publicar ou envie seu texto:`,
    { parse_mode: 'HTML' }
  )

  for (let i = 0; i < posts.length; i++) {
    const { topic, post, chars } = posts[i]
    const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : topic === 'ia' ? '🤖' : '💻'

    await telegramBot.sendMessage(chatId,
      `${emoji} <b>[${i + 1}] ${topic.toUpperCase()}</b> <i>(${chars} chars)</i>\n\n"${post}"`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Publicar', callback_data: `pub_${i}` },
            { text: '✏️ Editar', callback_data: `edit_${i}` }
          ]]
        }
      }
    )

    await new Promise(r => setTimeout(r, 300))
  }

  await telegramBot.sendMessage(chatId,
    `💡 Ou envie qualquer texto para postar diretamente`,
    { parse_mode: 'HTML' }
  )
}

export async function waitForChoice(posts, onPublish) {
  // Criar novo bot com polling
  const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: { interval: 500, autoStart: true }
  })

  const chatId = process.env.TELEGRAM_CHAT_ID
  let resolved = false
  let pendingText = null

  console.log('🔄 Polling iniciado, aguardando interacao...')

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.log('⏰ Timeout atingido')
        telegramBot.sendMessage(chatId, '⏰ Timeout - rode novamente quando quiser postar')
        cleanup()
        resolve({ success: false, reason: 'timeout' })
      }
    }, 10 * 60 * 1000)

    function cleanup() {
      resolved = true
      clearTimeout(timeout)
      telegramBot.stopPolling()
    }

    // Handler para botoes
    telegramBot.on('callback_query', async (query) => {
      if (resolved) return
      console.log('📥 Callback recebido:', query.data)

      try {
        if (query.data.startsWith('pub_')) {
          const index = parseInt(query.data.split('_')[1])
          const selectedPost = posts[index]

          if (selectedPost) {
            await telegramBot.answerCallbackQuery(query.id, { text: '📤 Publicando...' })

            console.log('📤 Publicando post:', index)
            const result = await onPublish(selectedPost.post)

            await telegramBot.sendMessage(chatId,
              `✅ <b>Publicado!</b>\n\n<a href="${result.url}">Ver no X</a>`,
              { parse_mode: 'HTML' }
            )

            cleanup()
            resolve({ success: true, url: result.url })
          }
        } else if (query.data.startsWith('edit_')) {
          const index = parseInt(query.data.split('_')[1])
          const selectedPost = posts[index]

          if (selectedPost) {
            await telegramBot.answerCallbackQuery(query.id, { text: '✏️ Modo edição' })

            // Envia o texto para o usuario copiar e editar
            await telegramBot.sendMessage(chatId,
              `✏️ <b>Editar post [${index + 1}]</b>\n\nCopie, edite e envie de volta:\n\n<code>${selectedPost.post}</code>`,
              { parse_mode: 'HTML' }
            )
          }
        } else if (query.data === 'confirm_text') {
          if (pendingText) {
            await telegramBot.answerCallbackQuery(query.id, { text: '📤 Publicando...' })

            console.log('📤 Publicando texto customizado')
            const result = await onPublish(pendingText)

            await telegramBot.sendMessage(chatId,
              `✅ <b>Publicado!</b>\n\n<a href="${result.url}">Ver no X</a>`,
              { parse_mode: 'HTML' }
            )

            cleanup()
            resolve({ success: true, url: result.url })
          }
        } else if (query.data === 'cancel_text') {
          await telegramBot.answerCallbackQuery(query.id, { text: 'Cancelado' })
          pendingText = null
        }
      } catch (err) {
        console.error('❌ Erro no callback:', err.message)
        await telegramBot.answerCallbackQuery(query.id, { text: '❌ Erro' })
        await telegramBot.sendMessage(chatId, `❌ Erro: ${err.message}`)
      }
    })

    // Handler para texto customizado
    telegramBot.on('message', async (msg) => {
      if (resolved) return
      if (msg.chat.id.toString() !== chatId) return
      if (!msg.text || msg.text.startsWith('/')) return

      const text = msg.text.trim()
      console.log('📥 Mensagem recebida:', text.substring(0, 50) + '...')

      if (text.length > 280) {
        await telegramBot.sendMessage(chatId,
          `⚠️ <b>Muito longo!</b> ${text.length}/280 chars`,
          { parse_mode: 'HTML' }
        )
        return
      }

      pendingText = text

      await telegramBot.sendMessage(chatId,
        `📝 <b>Confirmar?</b>\n\n"${text}"\n\n<i>(${text.length}/280)</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Publicar', callback_data: 'confirm_text' },
              { text: '❌ Cancelar', callback_data: 'cancel_text' }
            ]]
          }
        }
      )
    })

    telegramBot.on('polling_error', (err) => {
      console.error('Polling error:', err.message)
    })
  })
}
