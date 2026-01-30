import 'dotenv/config'
import { generatePost } from '../src/claude.js'
import { curateContentV2, formatForPrompt, getFallbackContentV2 } from '../src/curate-v2.js'
import { postTweet } from '../src/puppeteer-post.js'
import TelegramBot from 'node-telegram-bot-api'

const WAIT_BEFORE_POST_MS = 2 * 60 * 1000  // 2 minutos para revisar
const DELAY_BETWEEN_POSTS_MS = 60 * 1000   // 60 segundos entre posts
const MAX_RETRIES = 2  // Tentativas extras em caso de falha

// Topicos via argumento ou default
const args = process.argv.slice(2)
const TOPICS = args.length > 0 ? args : ['crypto', 'investing', 'vibeCoding']

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
const chatId = process.env.TELEGRAM_CHAT_ID

let cancelled = false

async function notify(message, options = {}) {
  try {
    return await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    })
  } catch (e) {
    console.log('⚠️ Erro ao enviar notificacao:', e.message)
    return null
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tenta postar com retry
async function postWithRetry(post, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const result = await postTweet(post, true)

    if (result.success) {
      return result
    }

    if (attempt <= maxRetries) {
      console.log(`   ⚠️ Tentativa ${attempt} falhou, aguardando 10s para retry...`)
      await new Promise(r => setTimeout(r, 10000))
    }
  }

  return { success: false, error: 'Falhou apos todas tentativas' }
}

async function main() {
  const hour = new Date().getHours()
  console.log('🎯 Bot-X-Posts - Modo Automatico')
  console.log('='.repeat(50))
  console.log(`⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  console.log(`📋 Topicos: ${TOPICS.join(', ')} (${TOPICS.length} posts)`)

  // 1. Curadoria v2 (dados frescos + análise X)
  console.log('\n1. Curando conteudo (v2 - dados frescos + X)...')
  let content
  try {
    content = await curateContentV2()
  } catch (err) {
    console.log('   ⚠️ Erro na curadoria v2:', err.message)
    console.log('   ⚠️ Usando fallback')
    content = getFallbackContentV2()
  }

  // Mostrar resumo da curadoria
  console.log('\n   📊 Resumo da curadoria:')
  for (const topic of TOPICS) {
    const data = content[topic]
    if (data) {
      const sentiment = data.sentiment || 'neutral'
      const score = data.sentimentScore || 0
      console.log(`      ${topic}: ${sentiment} (${score > 0 ? '+' : ''}${score})`)
    }
  }

  // 2. Gerar posts
  console.log('\n2. Gerando posts...')
  const posts = []

  for (const topic of TOPICS) {
    const data = content[topic]
    if (!data) continue

    // Formatar dados para o prompt
    const fullContext = formatForPrompt(content, topic)

    // Escolher melhor ângulo
    let angle = 'Analise baseada nos dados'
    if (data.angles && data.angles.length > 0) {
      const a = data.angles[0]
      angle = typeof a === 'string' ? a : `[${a.type}] ${a.hook} → ${a.insight}`
    }

    console.log(`   Gerando: ${topic} (sentimento: ${data.sentiment})...`)
    try {
      const post = await generatePost(topic, fullContext, angle, null)
      posts.push({ topic, post, sentiment: data.sentiment })
    } catch (err) {
      console.log(`   ⚠️ Erro em ${topic}: ${err.message}`)
    }
  }

  if (posts.length === 0) {
    console.log('❌ Nenhum post gerado')
    await notify('❌ Nenhum post foi gerado.')
    process.exit(1)
  }

  console.log(`   ✅ ${posts.length} posts gerados`)

  // 3. Notificar no Telegram com botao de cancelar
  console.log('\n3. Enviando preview para Telegram...')

  let previewMsg = `🎯 <b>Posts das ${hour}h</b>\n\n`
  previewMsg += `⏰ Serao publicados em 2 minutos\n`
  previewMsg += `<i>Clique em Cancelar para nao publicar</i>\n\n`

  for (let i = 0; i < posts.length; i++) {
    const { topic, post, sentiment } = posts[i]
    const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : '💻'
    const sentimentEmoji = sentiment === 'bullish' ? '🟢' : sentiment === 'bearish' ? '🔴' : '⚪'
    previewMsg += `${emoji} <b>[${i+1}] ${topic.toUpperCase()}</b> ${sentimentEmoji}\n"${escapeHtml(post)}"\n\n`
  }

  // Envia com botao de cancelar
  const previewResult = await notify(previewMsg, {
    reply_markup: {
      inline_keyboard: [[
        { text: '❌ Cancelar Publicacao', callback_data: 'cancel_post' }
      ]]
    }
  })

  console.log('   ✅ Preview enviado')

  // 4. Aguardar 2 minutos (com polling para cancelamento)
  console.log(`\n4. Aguardando 2 minutos para revisao...`)

  // Inicia polling temporario para capturar cancelamento
  const pollingBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: {
      interval: 1000,
      params: { timeout: 5 }
    }
  })

  pollingBot.on('callback_query', async (query) => {
    if (query.data === 'cancel_post') {
      cancelled = true
      console.log('❌ Cancelamento recebido!')
      try {
        await pollingBot.answerCallbackQuery(query.id, { text: '❌ Publicacao cancelada!' })
        await pollingBot.sendMessage(chatId, '❌ <b>Publicacao cancelada pelo usuario.</b>', { parse_mode: 'HTML' })
      } catch (e) {
        console.log('⚠️ Erro ao responder cancelamento:', e.message)
      }
    }
  })

  pollingBot.on('polling_error', () => {})  // Ignora erros de polling

  // Aguarda 2 minutos ou cancelamento
  const startTime = Date.now()
  while (Date.now() - startTime < WAIT_BEFORE_POST_MS && !cancelled) {
    await new Promise(r => setTimeout(r, 1000))
  }

  // Para polling
  pollingBot.stopPolling()

  if (cancelled) {
    console.log('\n❌ Publicacao cancelada pelo usuario')
    process.exit(0)
  }

  // Remove botao de cancelar
  if (previewResult) {
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: previewResult.message_id
      })
    } catch (e) {}
  }

  // 5. Postar
  console.log('\n5. Publicando posts...')
  await notify('🚀 Iniciando publicacao...')

  let successCount = 0
  for (let i = 0; i < posts.length; i++) {
    const { topic, post } = posts[i]
    console.log(`\n📤 Postando [${i+1}/${posts.length}] ${topic}...`)

    const result = await postWithRetry(post)

    if (result.success) {
      successCount++
      console.log(`   ✅ Publicado!`)
      await notify(`✅ <b>[${i+1}/${posts.length}] ${topic.toUpperCase()}</b> publicado!`)
    } else {
      console.log(`   ❌ Erro: ${result.error}`)
      await notify(`❌ <b>[${i+1}/${posts.length}] ${topic.toUpperCase()}</b> falhou`)
    }

    // Delay entre posts
    if (i < posts.length - 1) {
      console.log('   ⏳ Aguardando 60s...')
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS_MS))
    }
  }

  // 6. Resumo
  console.log(`\n✅ Finalizado: ${successCount}/${posts.length} posts publicados`)
  await notify(`✅ <b>${successCount}/${posts.length}</b> posts publicados!`)

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  notify(`❌ Erro: ${err.message}`)
  process.exit(1)
})
