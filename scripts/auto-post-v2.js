/**
 * Auto Post V2 - Multi-Source Bilingual Posting
 *
 * Flow:
 * 1. Curate from multi-sources (curate-v3)
 * 2. Generate 4 posts (4 topics × 1 language per cycle) or thread-only
 * 3. Preview on Telegram (2 min to cancel)
 * 4. Post sequentially (60s between posts)
 *
 * Schedule: 5 post cycles (8h EN, 12h PT, 16h EN, 20h PT, 22h EN) + 2 thread-only (10h, 18h)
 * = 20 posts + 2 threads/day (~30 tweets/day)
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { generatePost, generateBestThread, generateVideoCaption, generateQuoteComment } from '../src/claude-v2.js'
import { curateContentV3, formatForPrompt, getFallbackContentV3 } from '../src/curate-v3.js'
import { postTweet, postThread, postTweetWithVideo, postTweetWithImage, postQuoteTweet } from '../src/puppeteer-post.js'
import { generateImage, generateImagePrompt, cleanupTempImages } from '../src/image-generator.js'
import { fetchRedditMedia } from '../src/sources/reddit-media.js'
import { downloadMedia, checkMediaSafety, downloadThumbnail, cleanupTempMedia } from '../src/media-downloader.js'
import { searchViralTweets } from '../src/sources/x-viral-search.js'
import TelegramBot from 'node-telegram-bot-api'

// ==================== CONFIGURATION ====================

const WAIT_BEFORE_POST_MS = 2 * 60 * 1000  // 2 minutes for review
const DELAY_BETWEEN_POSTS_MS = 60 * 1000   // 60 seconds between posts
const DELAY_AFTER_THREAD_MS = 90 * 1000    // 90 seconds after thread
const MAX_RETRIES = 2

// Topics and languages
const TOPICS = ['crypto', 'investing', 'ai', 'vibeCoding']
const LANGUAGES = ['en', 'pt-BR']

// Language schedule: EN-heavy (3 EN + 2 PT-BR = 12 EN + 8 PT per day)
const EN_HOURS = [8, 16, 22]   // English post cycles
const PTBR_HOURS = [12, 20]    // Portuguese post cycles

// Thread configuration (thread-only cycles, no regular posts)
const THREAD_HOURS = [10, 18]  // Post threads at 10h and 18h only
const THREAD_LANGUAGE = 'en'   // Threads in English reach more people
const THREAD_WITH_IMAGE = true // Generate image for first tweet of thread

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
const chatId = process.env.TELEGRAM_CHAT_ID

let cancelled = false

// ==================== POST LOGGING ====================

const POSTS_LOG_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'posts-log.json')

function loadPostsLog() {
  try {
    if (fs.existsSync(POSTS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(POSTS_LOG_FILE, 'utf-8'))
    }
  } catch (err) {
    console.log(`   Warning: Could not load posts log: ${err.message}`)
  }
  return { posts: [] }
}

function savePostsLog(log) {
  try {
    const dir = path.dirname(POSTS_LOG_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(POSTS_LOG_FILE, JSON.stringify(log, null, 2))
  } catch (err) {
    console.log(`   Warning: Could not save posts log: ${err.message}`)
  }
}

function logPostedTweet(postData) {
  const log = loadPostsLog()
  log.posts.push({
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: postData.post,
    createdAt: new Date().toISOString(),
    hook: postData.hook || 'unknown',
    style: postData.style || 'unknown',
    topic: postData.topic || 'unknown',
    language: postData.language || 'unknown',
    experiment: postData.experiment || null,
    hour: new Date().getHours(),
    metrics: { likes: 0, retweets: 0, replies: 0, impressions: 0, quotes: 0, bookmarks: 0 },
    engagement: 0,
    engagementRate: 0,
    analyzedAt: null,
    source: 'auto-post-v2'
  })

  // Keep only last 500 posts to avoid huge file
  if (log.posts.length > 500) {
    log.posts = log.posts.slice(-500)
  }

  savePostsLog(log)
}

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

    // Don't retry if post was possibly sent (avoid duplicates on X)
    if (result.possiblyPosted || result.duplicate) {
      console.log('   ⚠️ Post pode ter sido enviado - pulando retry para evitar duplicata')
      return { success: true, warning: 'possibly_posted' }
    }

    // Don't retry if session expired (login required)
    if (result.error && result.error.includes('Nao esta logado')) {
      console.log('   🔒 Sessão expirada - sem retry (precisa login manual)')
      return { success: false, error: result.error, sessionExpired: true }
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
  if (THREAD_HOURS.includes(hour)) {
    console.log(`🧵 Thread-only cycle (${hour}h)`)
  } else {
    const lang = EN_HOURS.includes(hour) ? 'en' : 'pt-BR'
    console.log(`🌍 Language: ${lang === 'en' ? 'English' : 'Português'}`)
    console.log(`📈 Total: ${TOPICS.length} posts`)
  }

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

  const isThreadOnly = THREAD_HOURS.includes(hour)
  const cycleLanguage = EN_HOURS.includes(hour) ? 'en' : 'pt-BR'
  const posts = []

  if (isThreadOnly) {
    console.log(`\n2. Horário de thread (${hour}h) - pulando posts regulares`)
  } else {
    const langLabel = cycleLanguage === 'en' ? 'EN' : 'PT-BR'
    console.log(`\n2. Gerando 4 posts (${langLabel}) - 4 topics × 1 language...`)

    for (const topic of TOPICS) {
      const data = content[topic]
      if (!data) continue

      // Format context for this language
      const fullContext = formatForPrompt(content, topic, cycleLanguage)

      // Choose best angle
      let angle = cycleLanguage === 'en' ? 'Analysis based on data' : 'Análise baseada nos dados'
      if (data.suggestedAngles && data.suggestedAngles.length > 0) {
        const a = data.suggestedAngles[0]
        angle = typeof a === 'string' ? a : `[${a.type}] ${a.hook} → ${a.insight}`
      }

      console.log(`   Gerando: ${topic} (${langLabel})...`)

      try {
        const result = await generatePost(topic, fullContext, angle, cycleLanguage)
        // Handle both object {text, _metadata} and plain string
        const postText = typeof result === 'string' ? result : result.text
        const metadata = result._metadata || {}
        posts.push({
          topic,
          language: cycleLanguage,
          post: postText,
          sentiment: data.sentiment,
          chars: postText.length,
          hook: metadata.hook,
          style: metadata.style,
          experiment: metadata.experiment || null
        })
      } catch (err) {
        console.log(`   ⚠️ Erro em ${topic} (${langLabel}): ${err.message}`)
      }
    }

    if (posts.length === 0 && !isThreadOnly) {
      console.log('❌ Nenhum post gerado')
      await notify('❌ Nenhum post foi gerado.')
      process.exit(1)
    }

    console.log(`   ✅ ${posts.length} posts gerados`)
  }

  // ==================== 2.5 GENERATE THREAD (only at specific hours) ====================

  let thread = null
  let threadImage = null

  if (isThreadOnly) {
    console.log(`\n2.5. Gerando thread (horário ${hour}h é horário de thread)...`)

    try {
      thread = await generateBestThread(content, THREAD_LANGUAGE)
      console.log(`   ✅ Thread gerada: ${thread.tweets.length} tweets sobre ${thread.topic}`)
      console.log(`   📊 Framework: ${thread._metadata.framework}`)

      // Generate image for first tweet
      if (THREAD_WITH_IMAGE && thread.tweets.length > 0) {
        console.log('\n2.6. Gerando imagem para thread...')
        const imagePrompt = generateImagePrompt(thread.tweets[0], thread.topic, 'cyber')
        console.log(`   Prompt: "${imagePrompt.substring(0, 60)}..."`)

        const imageResult = await generateImage(imagePrompt)
        if (imageResult.success) {
          threadImage = imageResult.path
          console.log(`   ✅ Imagem gerada: ${threadImage}`)
        } else {
          console.log(`   ⚠️ Imagem falhou: ${imageResult.error}`)
          // Continue without image
        }
      }
    } catch (err) {
      console.log(`   ⚠️ Erro ao gerar thread: ${err.message}`)
      thread = null
    }
  } else {
    console.log(`\n2.5. Pulando thread (horário ${hour}h não é horário de thread - threads às ${THREAD_HOURS.join('h e ')}h)`)
  }

  // Cleanup old temp images/media
  cleanupTempImages()
  cleanupTempMedia()

  // ==================== 2.7 FETCH MEDIA CONTENT ====================

  let mediaMeme = null    // Reddit meme (video/image/gif)
  let quoteTarget = null  // Viral tweet to quote

  // Only fetch media for EN cycles (media content is in English)
  if (isThreadOnly) {
    console.log('\n2.7. Pulando midia (horário de thread)')
  } else if (cycleLanguage !== 'en') {
    console.log('\n2.7. Pulando midia (ciclo PT-BR)')
  } else {
    console.log('\n2.7. Buscando conteudo de midia...')

  // 2.7a: Fetch Reddit media (1 meme)
  try {
    console.log('   2.7a. Buscando meme viral do Reddit...')
    // Pick a random topic for the meme (prefer topics with good meme subreddits)
    const memeTopics = ['ai', 'vibeCoding', 'crypto', 'general']
    const memeTopic = memeTopics[Math.floor(Math.random() * memeTopics.length)]

    const redditMedia = await fetchRedditMedia(memeTopic, { minScore: 500, limit: 5 })

    if (redditMedia.length > 0) {
      // Try each media post until one downloads and passes safety
      for (const media of redditMedia) {
        console.log(`   Tentando: "${media.title.substring(0, 60)}..." (${media.mediaType}, ${media.score} upvotes)`)

        // Safety check via thumbnail first (cheaper than downloading full media)
        if (media.thumbnailUrl) {
          const thumbResult = await downloadThumbnail(media.thumbnailUrl)
          if (thumbResult.success) {
            const safetyResult = await checkMediaSafety(thumbResult.path)
            if (!safetyResult.safe) {
              console.log(`   ⚠️ Unsafe content (${safetyResult.reason}), pulando...`)
              try { fs.unlinkSync(thumbResult.path) } catch {}
              continue
            }
            try { fs.unlinkSync(thumbResult.path) } catch {}
          }
        }

        // Download the actual media
        const dlResult = await downloadMedia(media.mediaUrl, media.mediaType)
        if (!dlResult.success) {
          console.log(`   ⚠️ Download falhou: ${dlResult.error}`)
          continue
        }

        // Generate caption with Claude
        const caption = await generateVideoCaption(
          { title: media.title, subreddit: media.subreddit, score: media.score, mediaType: media.mediaType },
          memeTopic,
          'en'
        )

        mediaMeme = {
          ...media,
          topic: memeTopic,
          localPath: dlResult.path,
          caption: caption.text,
          _metadata: caption._metadata
        }

        console.log(`   ✅ Meme selecionado: ${media.mediaType} de r/${media.subreddit} (${media.score} upvotes)`)
        console.log(`   Caption: "${caption.text.substring(0, 80)}..."`)
        break
      }

      if (!mediaMeme) {
        console.log('   ⚠️ Nenhum meme passou nos filtros de seguranca/download')
      }
    } else {
      console.log('   ⚠️ Nenhum meme encontrado no Reddit')
    }
  } catch (err) {
    console.log(`   ⚠️ Erro ao buscar meme: ${err.message}`)
  }

  // 2.7b: Search X for viral tweet to quote
  try {
    console.log('\n   2.7b. Buscando tweet viral para quote...')
    // Pick topic - prefer ai/vibeCoding for quote tweets (more interesting demos)
    const quoteTopic = Math.random() < 0.6 ? 'ai' : (Math.random() < 0.5 ? 'vibeCoding' : 'crypto')

    const viralTweets = await searchViralTweets(quoteTopic, { limit: 5, minLikes: 100 })

    if (viralTweets.length > 0) {
      // Pick the most liked tweet
      const target = viralTweets[0]

      // Generate quote comment
      const comment = await generateQuoteComment(
        { text: target.text, authorHandle: target.authorHandle, likes: target.likes },
        quoteTopic,
        'en'
      )

      quoteTarget = {
        ...target,
        commentary: comment.text,
        _metadata: comment._metadata
      }

      console.log(`   ✅ Quote target: @${target.authorHandle} (${target.likes} likes)`)
      console.log(`   Comment: "${comment.text.substring(0, 80)}..."`)
    } else {
      console.log('   ⚠️ Nenhum tweet viral encontrado')
    }
  } catch (err) {
    console.log(`   ⚠️ Erro ao buscar quote tweet: ${err.message}`)
  }

  // Replace EN text posts with media posts (if available)
  if (mediaMeme || quoteTarget) {
    console.log('\n   Substituindo posts de texto por media...')
    const enPosts = posts.filter(p => p.language === 'en')

    if (mediaMeme && enPosts.length >= 1) {
      // Replace first EN text post with meme
      const idx = posts.indexOf(enPosts[0])
      posts[idx] = {
        ...posts[idx],
        post: mediaMeme.caption,
        mediaType: 'meme',
        mediaPath: mediaMeme.localPath,
        mediaFileType: mediaMeme.mediaType, // 'video', 'image', 'gif'
        hook: mediaMeme._metadata?.hook,
        style: mediaMeme._metadata?.style,
        experiment: null,
        _mediaSource: `r/${mediaMeme.subreddit}`
      }
      console.log(`   ✅ Post ${idx + 1} substituido por meme (${mediaMeme.mediaType})`)
    }

    if (quoteTarget && enPosts.length >= 2) {
      // Replace second EN text post with quote tweet
      const idx = posts.indexOf(enPosts[1])
      posts[idx] = {
        ...posts[idx],
        post: quoteTarget.commentary,
        mediaType: 'quote',
        quoteTweetUrl: quoteTarget.tweetUrl,
        hook: quoteTarget._metadata?.hook,
        style: quoteTarget._metadata?.style,
        experiment: null,
        _quoteAuthor: quoteTarget.authorHandle
      }
      console.log(`   ✅ Post ${idx + 1} substituido por quote tweet (@${quoteTarget.authorHandle})`)
    }
  }
  } // end media fetch (EN cycles only)

  // If thread-only cycle and no thread generated, exit gracefully
  if (isThreadOnly && (!thread || !thread.tweets || thread.tweets.length < 2) && posts.length === 0) {
    console.log('⚠️ Thread-only cycle mas thread não gerada. Saindo.')
    await notify(`⚠️ Ciclo ${hour}h (thread-only): thread não gerada.`)
    process.exit(0)
  }

  // ==================== 3. TELEGRAM PREVIEW ====================

  console.log('\n3. Enviando preview para Telegram...')

  const cycleType = isThreadOnly ? 'Thread' : `${posts.length} posts ${cycleLanguage === 'en' ? 'EN' : 'PT-BR'}`
  let previewMsg = `🎯 <b>${hour}h - ${cycleType}</b>\n\n`
  previewMsg += `⏰ Publicação em 2 minutos\n`
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
      // Media indicators
      let mediaTag = ''
      if (p.mediaType === 'meme') {
        const typeEmoji = p.mediaFileType === 'video' ? '🎬' : p.mediaFileType === 'gif' ? '🎞️' : '📷'
        mediaTag = ` ${typeEmoji} via ${p._mediaSource}`
      } else if (p.mediaType === 'quote') {
        mediaTag = ` 💬 QT @${p._quoteAuthor}`
      }
      previewMsg += `${flag} "${escapeHtml(p.post.substring(0, 150))}${p.post.length > 150 ? '...' : ''}"${mediaTag}\n`
    }
    previewMsg += `\n`
  }

  // Add thread preview if generated
  if (thread && thread.tweets) {
    const threadEmoji = getTopicEmoji(thread.topic)
    const threadFlag = THREAD_LANGUAGE === 'en' ? '🇺🇸' : '🇧🇷'
    const imageIndicator = threadImage ? ' 🖼️' : ''

    previewMsg += `🧵 <b>THREAD</b> ${threadEmoji}${threadFlag}${imageIndicator} (${thread.tweets.length} tweets)\n`
    previewMsg += `<i>Framework: ${thread._metadata.framework}</i>\n`
    if (threadImage) {
      previewMsg += `<i>📷 Com imagem no 1º tweet</i>\n`
    }
    previewMsg += `\n`

    for (let i = 0; i < Math.min(thread.tweets.length, 3); i++) {
      const tweet = thread.tweets[i]
      previewMsg += `${i + 1}/ "${escapeHtml(tweet.substring(0, 100))}${tweet.length > 100 ? '...' : ''}"\n`
    }

    if (thread.tweets.length > 3) {
      previewMsg += `<i>... +${thread.tweets.length - 3} mais tweets</i>\n`
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

  console.log('\n5. Publicando conteúdo...')

  let successCount = 0
  let threadSuccess = false
  const errors = []

  // ========== 5.1 POST THREAD FIRST (higher engagement potential) ==========

  if (thread && thread.tweets && thread.tweets.length >= 2) {
    const threadEmoji = getTopicEmoji(thread.topic)
    const threadFlag = THREAD_LANGUAGE === 'en' ? '🇺🇸' : '🇧🇷'
    const imageIndicator = threadImage ? ' 🖼️' : ''

    console.log(`\n🧵 Postando THREAD${imageIndicator} (${thread.tweets.length} tweets sobre ${thread.topic})...`)

    try {
      // Pass image path for first tweet (optional)
      const threadResult = await postThread(thread.tweets, async (idx, total, status) => {
        if (status === 'composing') {
          console.log(`   📝 Preparando tweet ${idx + 1}/${total}...`)
        } else if (status === 'posted') {
          console.log(`   ✅ Thread publicada!`)
        }
      }, threadImage)  // Pass image for first tweet

      if (threadResult.success || threadResult.postedCount > 0) {
        threadSuccess = true
        const imgStr = threadImage ? ' com imagem' : ''
        console.log(`   ✅ Thread publicada${imgStr}: ${threadResult.postedCount}/${thread.tweets.length} tweets`)
        // Log each thread tweet
        for (const tweet of thread.tweets) {
          logPostedTweet({
            post: tweet,
            hook: thread._metadata?.framework || 'thread',
            style: 'thread',
            topic: thread.topic,
            language: THREAD_LANGUAGE,
            experiment: null
          })
        }
      } else {
        console.log(`   ❌ Thread falhou: ${threadResult.error}`)
        errors.push(`🧵 Thread: ${threadResult.error}`)
      }
    } catch (err) {
      console.log(`   ❌ Erro na thread: ${err.message}`)
      errors.push(`🧵 Thread: ${err.message}`)
    }

    // Longer delay after thread
    console.log(`   ⏳ Aguardando ${DELAY_AFTER_THREAD_MS / 1000}s após thread...`)
    await new Promise(r => setTimeout(r, DELAY_AFTER_THREAD_MS))
  }

  // ========== 5.2 POST INDIVIDUAL TWEETS ==========

  for (let i = 0; i < posts.length; i++) {
    const postData = posts[i]
    const { topic, language, post } = postData
    const emoji = getTopicEmoji(topic)
    const flag = getLanguageFlag(language)
    const label = `${topic} ${language === 'en' ? 'EN' : 'PT'}`

    let result = null

    // Determine post type and use appropriate method
    if (postData.mediaType === 'meme' && postData.mediaPath) {
      // Media meme post (video/image/gif from Reddit)
      const typeLabel = postData.mediaFileType === 'video' ? 'video' : postData.mediaFileType === 'gif' ? 'gif' : 'image'
      console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${label} (${typeLabel} meme)...`)

      if (postData.mediaFileType === 'video') {
        result = await postTweetWithVideo(post, postData.mediaPath, true)
      } else {
        // Image or GIF - use image upload
        result = await postTweetWithImage(post, postData.mediaPath, true)
      }

      if (!result.success) {
        // Retry once
        console.log(`   ⚠️ Media post falhou, tentando retry...`)
        await new Promise(r => setTimeout(r, 10000))
        if (postData.mediaFileType === 'video') {
          result = await postTweetWithVideo(post, postData.mediaPath, true)
        } else {
          result = await postTweetWithImage(post, postData.mediaPath, true)
        }
      }

      if (!result.success) {
        // Fallback: post as text only
        console.log(`   ⚠️ Media falhou, postando como texto...`)
        result = await postWithRetry(post)
      }

    } else if (postData.mediaType === 'quote' && postData.quoteTweetUrl) {
      // Quote tweet
      console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${label} (quote tweet @${postData._quoteAuthor})...`)

      result = await postQuoteTweet(post, postData.quoteTweetUrl, true)

      if (!result.success) {
        // Retry once
        console.log(`   ⚠️ Quote tweet falhou, tentando retry...`)
        await new Promise(r => setTimeout(r, 10000))
        result = await postQuoteTweet(post, postData.quoteTweetUrl, true)
      }

      if (!result.success) {
        // Fallback: post commentary as text only
        console.log(`   ⚠️ Quote falhou, postando como texto...`)
        result = await postWithRetry(post)
      }

    } else {
      // Normal text post
      console.log(`\n📤 Postando [${i + 1}/${posts.length}] ${label}...`)
      result = await postWithRetry(post)
    }

    if (result.success) {
      successCount++
      console.log(`   ✅ Publicado!`)
      logPostedTweet({
        ...postData,
        // Override type for logging
        hook: postData.hook || 'unknown',
        style: postData.style || 'unknown'
      })
    } else {
      console.log(`   ❌ Erro: ${result.error}`)
      errors.push(`${emoji}${flag} ${topic.toUpperCase()}: ${result.error}`)

      // Session expired - abort remaining posts immediately
      if (result.sessionExpired) {
        console.log('   🔒 Sessão expirada - abortando posts restantes')
        for (let j = i + 1; j < posts.length; j++) {
          errors.push(`⏭️ ${posts[j].topic.toUpperCase()}: Pulado (sessão expirada)`)
        }
        await notify('🔒 <b>SESSÃO EXPIRADA</b>\n\nO login no X expirou. Faça login manualmente no Chrome e recarregue x.com/home.\n\nPosts restantes foram cancelados.')
        break
      }
    }

    // Delay between posts
    if (i < posts.length - 1) {
      console.log('   ⏳ Aguardando 60s...')
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_POSTS_MS))
    }
  }

  // ==================== 6. SUMMARY ====================

  const threadStr = thread ? (threadSuccess ? ' + 🧵 thread' : ' (thread falhou)') : ''
  const mediaStr = mediaMeme ? ' + 🎬 meme' : ''
  const quoteStr = quoteTarget ? ' + 💬 quote' : ''
  console.log(`\n✅ Finalizado: ${successCount}/${posts.length} posts publicados${threadStr}${mediaStr}${quoteStr}`)

  // Cleanup downloaded media
  if (mediaMeme?.localPath) {
    try { fs.unlinkSync(mediaMeme.localPath) } catch {}
  }

  // Single summary notification
  let summaryMsg = `✅ <b>${successCount}/${posts.length}</b> posts publicados${threadStr}${mediaStr}${quoteStr}`
  if (errors.length > 0) {
    summaryMsg += `\n\n⚠️ <b>${errors.length} erro(s):</b>\n${errors.map(e => `• ${escapeHtml(e)}`).join('\n')}`
  }
  await notify(summaryMsg)

  process.exit(0)
}

// ==================== RUN ====================

main().catch(err => {
  console.error('❌ Erro:', err.message)
  notify(`❌ Erro: ${err.message}`)
  process.exit(1)
})
