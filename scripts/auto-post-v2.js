/**
 * Auto Post V2 - Multi-Source Bilingual Posting
 *
 * Flow:
 * 1. Curate from multi-sources (curate-v3)
 * 2. Generate 8 posts (4 topics × 2 languages)
 * 3. Preview on Telegram (2 min to cancel)
 * 4. Post sequentially (60s between posts)
 */

import 'dotenv/config'
import { generatePost } from '../src/claude-v2.js'
import { curateContentV3, formatForPrompt, getFallbackContentV3 } from '../src/curate-v3.js'
import { postTweet } from '../src/puppeteer-post.js'
import TelegramBot from 'node-telegram-bot-api'

// ==================== CONFIGURATION ====================

const WAIT_BEFORE_POST_MS = 2 * 60 * 1000  // 2 minutes for review
const DELAY_BETWEEN_POSTS_MS = 60 * 1000   // 60 seconds between posts
const MAX_RETRIES = 2

// Topics and languages
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']
const LANGUAGES = ['en', 'pt-BR']

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
const chatId = process.env.TELEGRAM_CHAT_ID

let cancelled = false

// ==================== HELPERS ====================

async function notify(message, options = {}) {
  try {
    return await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    })
  } catch (e) {
    console.log('⚠️ Erro ao enviar notificação:', e.message)
    return null
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getTopicEmoji(topic) {
  const emojis = {
    crypto: '₿',
    investing: '📊',
    ai: '🤖',
    vibeCoding: '💻'
  }
  return emojis[topic] || '📝'
}

function getLanguageFlag(language) {
  return language === 'en' ? '🇺🇸' : '🇧🇷'
}

// ==================== POST WITH RETRY ====================

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

  return { success: false, error: 'Falhou após todas tentativas' }
}

// ==================== MAIN ====================

async function main() {
  const hour = new Date().getHours()
  console.log('🎯 Bot-X-Posts V2 - Multi-Source Bilingual')
  console.log('='.repeat(60))
  console.log(`⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  console.log(`📋 Topics: ${TOPICS.join(', ')}`)
  console.log(`🌍 Languages: ${LANGUAGES.join(', ')}`)
  console.log(`📈 Total: ${TOPICS.length * LANGUAGES.length} posts`)

  // ==================== 1. CURATION ====================

  console.log('\n1. Curando conteúdo (v3 - multi-source)...')
  let content
  try {
    content = await curateContentV3(TOPICS)
  } catch (err) {
    console.log('   ⚠️ Erro na curadoria v3:', err.message)
    console.log('   ⚠️ Usando fallback')
    content = getFallbackContentV3()
  }

  // Show curation summary
  console.log('\n   📊 Resumo da curadoria:')
  for (const topic of TOPICS) {
    const data = content[topic]
    if (data) {
      const sentiment = data.sentiment || 'neutral'
      const score = data.sentimentScore || 0
      const sources = data.sources?.map(s => s.name).join(', ') || 'fallback'
      console.log(`      ${topic}: ${sentiment} (${score > 0 ? '+' : ''}${score}) via ${sources}`)
    }
  }

  // ==================== 2. GENERATE POSTS ====================

  console.log('\n2. Gerando posts (4 topics × 2 languages)...')
  const posts = []

  for (const topic of TOPICS) {
    const data = content[topic]
    if (!data) continue

    for (const language of LANGUAGES) {
      // Format context for this language
      const fullContext = formatForPrompt(content, topic, language)

      // Choose best angle
      let angle = language === 'en' ? 'Analysis based on data' : 'Análise baseada nos dados'
      if (data.suggestedAngles && data.suggestedAngles.length > 0) {
        const a = data.suggestedAngles[0]
        angle = typeof a === 'string' ? a : `[${a.type}] ${a.hook} → ${a.insight}`
      }

      const langLabel = language === 'en' ? 'EN' : 'PT'
      console.log(`   Gerando: ${topic} (${langLabel})...`)

      try {
        const result = await generatePost(topic, fullContext, angle, language)
        // Handle both object {text, _metadata} and plain string
        const postText = typeof result === 'string' ? result : result.text
        const metadata = result._metadata || {}
        posts.push({
          topic,
          language,
          post: postText,
          sentiment: data.sentiment,
          chars: postText.length,
          hook: metadata.hook,
          style: metadata.style
        })
      } catch (err) {
        console.log(`   ⚠️ Erro em ${topic} (${langLabel}): ${err.message}`)
      }
    }
  }

  if (posts.length === 0) {
    console.log('❌ Nenhum post gerado')
    await notify('❌ Nenhum post foi gerado.')
    process.exit(1)
  }

  console.log(`   ✅ ${posts.length} posts gerados`)

  // ==================== 3. TELEGRAM PREVIEW ====================

  console.log('\n3. Enviando preview para Telegram...')

  let previewMsg = `🎯 <b>Posts das ${hour}h</b> (V2 Multi-Source)\n\n`
  previewMsg += `⏰ Serão publicados em 2 minutos\n`
  previewMsg += `<i>Clique em Cancelar para não publicar</i>\n\n`

  // Group by topic for cleaner display
  for (const topic of TOPICS) {
    const topicPosts = posts.filter(p => p.topic === topic)
    if (topicPosts.length === 0) continue

    const emoji = getTopicEmoji(topic)
    const sentiment = topicPosts[0].sentiment || 'neutral'
    const sentimentEmoji = sentiment === 'bullish' ? '🟢' : sentiment === 'bearish' ? '🔴' : '⚪'

    previewMsg += `${emoji} <b>${topic.toUpperCase()}</b> ${sentimentEmoji}\n`

    for (const p of topicPosts) {
      const flag = getLanguageFlag(p.language)
      previewMsg += `${flag} "${escapeHtml(p.post.substring(0, 150))}${p.post.length > 150 ? '...' : ''}"\n`
    }
    previewMsg += `\n`
  }

  // Send with cancel button
  const previewResult = await notify(previewMsg, {
    reply_markup: {
      inline_keyboard: [[
        { text: '❌ Cancelar Publicação', callback_data: 'cancel_post' }
      ]]
    }
  })

  console.log('   ✅ Preview enviado')

  // ==================== 4. WAIT FOR CANCEL ====================

  console.log(`\n4. Aguardando 2 minutos para revisão...`)

  // Temporary polling to capture cancellation
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
        await pollingBot.answerCallbackQuery(query.id, { text: '❌ Publicação cancelada!' })
        await pollingBot.sendMessage(chatId, '❌ <b>Publicação cancelada pelo usuário.</b>', { parse_mode: 'HTML' })
      } catch (e) {
        console.log('⚠️ Erro ao responder cancelamento:', e.message)
      }
    }
  })

  pollingBot.on('polling_error', () => {}) // Ignore polling errors

  // Wait 2 minutes or cancellation
  const startTime = Date.now()
  while (Date.now() - startTime < WAIT_BEFORE_POST_MS && !cancelled) {
    await new Promise(r => setTimeout(r, 1000))
  }

  pollingBot.stopPolling()

  if (cancelled) {
    console.log('\n❌ Publicação cancelada pelo usuário')
    process.exit(0)
  }

  // Remove cancel button
  if (previewResult) {
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: previewResult.message_id
      })
    } catch (e) {}
  }

  // ==================== 5. POST ====================

  console.log('\n5. Publicando posts...')
  await notify('🚀 Iniciando publicação...')

  let successCount = 0
  for (let i = 0; i < posts.length; i++) {
    const { topic, language, post } = posts[i]
    const emoji = getTopicEmoji(topic)
    const flag = getLanguageFlag(language)
    const label = `${topic} ${language === 'en' ? 'EN' : 'PT'}`

    console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${label}...`)

    const result = await postWithRetry(post)

    if (result.success) {
      successCount++
      console.log(`   ✅ Publicado!`)
      await notify(`✅ <b>[${i + 1}/${posts.length}]</b> ${emoji}${flag} ${topic.toUpperCase()} publicado!`)
    } else {
      console.log(`   ❌ Erro: ${result.error}`)
      await notify(`❌ <b>[${i + 1}/${posts.length}]</b> ${emoji}${flag} ${topic.toUpperCase()} falhou`)
    }

    // Delay between posts
    if (i < posts.length - 1) {
      console.log('   ⏳ Aguardando 60s...')
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS_MS))
    }
  }

  // ==================== 6. SUMMARY ====================

  console.log(`\n✅ Finalizado: ${successCount}/${posts.length} posts publicados`)
  await notify(`✅ <b>${successCount}/${posts.length}</b> posts publicados!`)

  process.exit(0)
}

// ==================== RUN ====================

main().catch(err => {
  console.error('❌ Erro:', err.message)
  notify(`❌ Erro: ${err.message}`)
  process.exit(1)
})
