import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import { createTwitterClient, postTweet } from '../src/twitter.js'

const chatId = process.env.TELEGRAM_CHAT_ID

// Posts de teste COM HASHTAGS - 4 topicos
const posts = [
  { topic: 'crypto', post: 'BTC testando suporte em $88k enquanto ouro bate recordes. O safe haven digital ainda nao convenceu os institucionais. #Bitcoin #Crypto', chars: 140 },
  { topic: 'investing', post: 'S&P 500 em alta de 0.5% com earnings da Nvidia acima do esperado. Wall Street ignora risco de shutdown enquanto Fed mantem juros. #SP500 #NASDAQ #Stocks', chars: 160 },
  { topic: 'vibeCoding', post: 'Claude Code usa 5.5x menos tokens que Cursor. A guerra nao e inteligencia, e eficiencia de capital. #VibeCoding #ClaudeCode #Dev', chars: 130 },
  { topic: 'ia', post: 'GPT-5 vs Claude 4 vs Gemini 2: benchmarks mostram empate tecnico. A diferenca real? Quem cobra menos por milhao de tokens. #AI #OpenAI #Claude', chars: 145 }
]

console.log('🧪 Teste de Botoes do Telegram')
console.log('='.repeat(50))

// Criar bot COM polling
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: { interval: 500, autoStart: true }
})

console.log('📤 Enviando posts com botoes...')

// Enviar header
await bot.sendMessage(chatId, '🧪 <b>TESTE DE BOTOES</b>\n\nClique em qualquer botao:', { parse_mode: 'HTML' })

// Enviar cada post
for (let i = 0; i < posts.length; i++) {
  const { topic, post, chars } = posts[i]
  const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : topic === 'ia' ? '🤖' : '💻'

  await bot.sendMessage(chatId,
    `${emoji} <b>[${i + 1}] ${topic.toUpperCase()}</b>\n\n"${post}"`,
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
  console.log(`   Enviado: [${i + 1}] ${topic}`)
  await new Promise(r => setTimeout(r, 300))
}

console.log('\n🔄 Aguardando clique (60 segundos)...')

let pendingEdit = null

// Handler para callbacks
bot.on('callback_query', async (query) => {
  console.log('\n📥 CALLBACK RECEBIDO!')
  console.log('   Data:', query.data)
  console.log('   From:', query.from.username)

  const [action, indexStr] = query.data.split('_')
  const index = parseInt(indexStr)
  const selectedPost = posts[index]

  if (action === 'pub') {
    await bot.answerCallbackQuery(query.id, { text: '📤 Publicando...' })

    console.log('\n📤 Publicando no X...')
    try {
      const client = createTwitterClient()
      const result = await postTweet(client, selectedPost.post)

      await bot.sendMessage(chatId,
        `✅ <b>SUCESSO!</b>\n\n<a href="${result.url}">Ver no X</a>`,
        { parse_mode: 'HTML' }
      )

      console.log('✅ Publicado:', result.url)
    } catch (err) {
      console.error('❌ Erro ao publicar:', err.message)
      await bot.sendMessage(chatId, `❌ Erro: ${err.message}`)
    }

    bot.stopPolling()
    process.exit(0)
  } else if (action === 'edit') {
    await bot.answerCallbackQuery(query.id, { text: '✏️ Modo edição' })
    pendingEdit = index

    await bot.sendMessage(chatId,
      `✏️ <b>Editar post [${index + 1}]</b>\n\nCopie, edite e envie:\n\n<code>${selectedPost.post}</code>`,
      { parse_mode: 'HTML' }
    )
  } else if (action === 'confirm') {
    if (pendingEdit !== null) {
      await bot.answerCallbackQuery(query.id, { text: '📤 Publicando...' })

      console.log('\n📤 Publicando texto editado...')
      try {
        const client = createTwitterClient()
        const result = await postTweet(client, pendingEdit)

        await bot.sendMessage(chatId,
          `✅ <b>SUCESSO!</b>\n\n<a href="${result.url}">Ver no X</a>`,
          { parse_mode: 'HTML' }
        )

        console.log('✅ Publicado:', result.url)
      } catch (err) {
        console.error('❌ Erro ao publicar:', err.message)
        await bot.sendMessage(chatId, `❌ Erro: ${err.message}`)
      }

      bot.stopPolling()
      process.exit(0)
    }
  } else if (action === 'cancel') {
    await bot.answerCallbackQuery(query.id, { text: 'Cancelado' })
    pendingEdit = null
  }
})

// Handler para mensagens (texto editado)
bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== chatId) return
  if (!msg.text || msg.text.startsWith('/')) return

  const text = msg.text.trim()
  console.log('📥 Texto recebido:', text.substring(0, 50) + '...')

  if (text.length > 280) {
    await bot.sendMessage(chatId, `⚠️ Muito longo! ${text.length}/280 chars`)
    return
  }

  pendingEdit = text

  await bot.sendMessage(chatId,
    `📝 <b>Confirmar?</b>\n\n"${text}"\n\n<i>(${text.length}/280)</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Publicar', callback_data: 'confirm_0' },
          { text: '❌ Cancelar', callback_data: 'cancel_0' }
        ]]
      }
    }
  )
})

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message)
})

// Timeout
setTimeout(() => {
  console.log('\n⏰ Timeout - nenhum clique recebido')
  bot.stopPolling()
  process.exit(0)
}, 60000)
