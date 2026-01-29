import 'dotenv/config'
import { generatePost } from '../src/claude.js'
import { curateContent, getFallbackContent } from '../src/curate.js'
import { postTweet } from '../src/puppeteer-post.js'
import TelegramBot from 'node-telegram-bot-api'

const WAIT_BEFORE_POST_MS = 2 * 60 * 1000  // 2 minutos para revisar
const DELAY_BETWEEN_POSTS_MS = 60 * 1000   // 60 segundos entre posts

// Topicos via argumento ou default
const args = process.argv.slice(2)
const TOPICS = args.length > 0 ? args : ['crypto', 'investing', 'vibeCoding']

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })
const chatId = process.env.TELEGRAM_CHAT_ID

async function notify(message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true })
  } catch (e) {
    console.log('⚠️ Erro ao enviar notificacao:', e.message)
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function main() {
  const hour = new Date().getHours()
  console.log('🎯 Bot-X-Posts - Modo Automatico')
  console.log('='.repeat(50))
  console.log(`⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  console.log(`📋 Topicos: ${TOPICS.join(', ')} (${TOPICS.length} posts)`)

  // 1. Curadoria
  console.log('\n1. Curando conteudo...')
  let content
  try {
    content = await curateContent()
  } catch (err) {
    console.log('   ⚠️ Usando fallback')
    content = getFallbackContent()
  }

  // 2. Gerar posts
  console.log('\n2. Gerando posts...')
  const posts = []

  for (const topic of TOPICS) {
    const data = content[topic]
    if (!data) continue

    const fullContext = `Noticia: ${data.context}\nDados: ${data.data.join(', ')}`
    const angle = data.angles[0] || 'Analise'

    console.log(`   Gerando: ${topic}...`)
    try {
      const post = await generatePost(topic, fullContext, angle, null)
      posts.push({ topic, post })
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

  // 3. Notificar no Telegram
  console.log('\n3. Enviando preview para Telegram...')

  let previewMsg = `🎯 <b>Posts das ${hour}h</b>\n\n`
  previewMsg += `⏰ Serao publicados em 2 minutos\n\n`

  for (let i = 0; i < posts.length; i++) {
    const { topic, post } = posts[i]
    const emoji = topic === 'crypto' ? '₿' : topic === 'investing' ? '📊' : '💻'
    previewMsg += `${emoji} <b>[${i+1}] ${topic.toUpperCase()}</b>\n"${escapeHtml(post)}"\n\n`
  }

  await notify(previewMsg)
  console.log('   ✅ Preview enviado')

  // 4. Aguardar 2 minutos
  console.log(`\n4. Aguardando 2 minutos para revisao...`)
  await notify('⏳ Publicando em 2 minutos...')
  await new Promise(r => setTimeout(r, WAIT_BEFORE_POST_MS))

  // 5. Postar
  console.log('\n5. Publicando posts...')
  await notify('🚀 Iniciando publicacao...')

  let successCount = 0
  for (let i = 0; i < posts.length; i++) {
    const { topic, post } = posts[i]
    console.log(`\n📤 Postando [${i+1}/${posts.length}] ${topic}...`)

    const result = await postTweet(post, true)

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
