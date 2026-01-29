import 'dotenv/config'
import { generatePost } from '../src/claude.js'
import { sendPostsForReview, waitForApproval, sendNotification, sendPostConfirmation } from '../src/telegram-v2.js'
import { curateContent, getFallbackContent } from '../src/curate.js'
import { getEngagementContext } from '../src/learn.js'
import { postTweet, postMultipleTweets, checkChromeConnection } from '../src/puppeteer-post.js'

const MAX_REGENERATIONS = 3

// Topicos recebidos via argumento ou default
const args = process.argv.slice(2)
const TOPICS = args.length > 0 ? args : ['crypto', 'investing', 'vibeCoding']

async function generateAllPosts(content, learningContext, topics) {
  const allPosts = []

  // Conta quantas vezes cada topico aparece
  const topicCounts = {}
  for (const topic of topics) {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1
  }

  for (const topic of topics) {
    const data = content[topic]
    if (!data) {
      console.log(`   ⚠️ Topico ${topic} nao encontrado na curadoria`)
      continue
    }

    const fullContext = `
Noticia/Tendencia: ${data.context}
Dados: ${data.data.join(', ')}
Fonte: ${data.source}
    `.trim()

    // Se topico aparece mais de uma vez, usa angulos diferentes
    const existingCount = allPosts.filter(p => p.topic === topic).length
    const angleIndex = existingCount % data.angles.length
    const angle = data.angles[angleIndex] || 'Analise do mercado'

    console.log(`   Gerando: ${topic} (angulo ${angleIndex + 1})...`)
    try {
      const post = await generatePost(topic, fullContext, angle, learningContext)
      allPosts.push({ topic, angle, post, chars: post.length, source: data.source })
    } catch (err) {
      console.log(`   ⚠️ Erro ao gerar ${topic}: ${err.message}`)
    }
  }

  return allPosts
}

async function main() {
  console.log('🎯 Bot-X-Posts - Modo Interativo v2')
  console.log('='.repeat(50))
  console.log(`⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  console.log(`📋 Topicos: ${TOPICS.join(', ')} (${TOPICS.length} posts)`)

  // 1. Curadoria de conteudo
  console.log('\n1. Curando conteudo das fontes...')
  let content
  try {
    content = await curateContent()
  } catch (err) {
    console.log('   ⚠️ Erro na curadoria, usando fallback:', err.message)
    content = getFallbackContent()
  }

  // 2. Analisar engajamento
  console.log('\n2. Analisando engajamento de posts anteriores...')
  let learningContext = null
  try {
    learningContext = await getEngagementContext()
    if (learningContext) {
      console.log('   ✅ Insights de engajamento carregados')
    }
  } catch (err) {
    console.log('   ⚠️ Nao foi possivel analisar engajamento:', err.message)
  }

  let regenerationCount = 0

  // Loop de regeneração
  while (regenerationCount < MAX_REGENERATIONS) {
    // 3. Gerar posts para os topicos especificados
    console.log(`\n3. Gerando ${TOPICS.length} posts com dados curados... (tentativa ${regenerationCount + 1})`)
    const allPosts = await generateAllPosts(content, learningContext, TOPICS)

    if (allPosts.length === 0) {
      console.log('❌ Nenhum post gerado')
      await sendNotification('❌ Erro: Nenhum post foi gerado.')
      process.exit(1)
    }

    console.log(`   ✅ ${allPosts.length} posts gerados`)

    // 4. Enviar para Telegram
    console.log('\n4. Enviando posts para revisão...')
    await sendPostsForReview(allPosts)
    console.log('   ✅ Posts enviados')

    // 5. Aguardar aprovacao
    console.log('\n5. Aguardando acao (timeout: 10min)...')

    const result = await waitForApproval(allPosts, null, null)

    // REGENERAR
    if (result.action === 'regenerate') {
      regenerationCount++
      console.log(`\n🔄 Regenerando posts... (${regenerationCount}/${MAX_REGENERATIONS})`)
      continue
    }

    // CANCELAR
    if (result.action === 'cancel') {
      console.log('\n❌ Cancelado pelo usuario')
      process.exit(0)
    }

    // POSTAR TODOS (ou timeout)
    if (result.action === 'post_all' || result.action === 'timeout_post_all') {
      console.log(`\n🚀 Postando ${allPosts.length} posts via Puppeteer...`)

      // Verifica Chrome
      const chromeStatus = await checkChromeConnection()
      if (!chromeStatus.connected) {
        console.log('❌ Chrome nao conectado na porta 9222')
        await sendNotification('❌ Chrome nao conectado. Abra com --remote-debugging-port=9222')
        process.exit(1)
      }

      // Posta todos
      const results = await postMultipleTweets(allPosts, async (index, total, success) => {
        await sendPostConfirmation(index, total, allPosts[index].topic, success)
      })

      const successCount = results.filter(r => r.success).length
      console.log(`\n✅ ${successCount}/${allPosts.length} posts publicados!`)
      await sendNotification(`✅ <b>${successCount}/${allPosts.length}</b> posts publicados!`)

      process.exit(0)
    }

    // POSTAR INDIVIDUAL
    if (result.action === 'post_single') {
      console.log(`\n🚀 Postando post ${result.postIndex + 1} via Puppeteer...`)

      const chromeStatus = await checkChromeConnection()
      if (!chromeStatus.connected) {
        console.log('❌ Chrome nao conectado na porta 9222')
        await sendNotification('❌ Chrome nao conectado. Abra com --remote-debugging-port=9222')
        process.exit(1)
      }

      const postResult = await postTweet(result.post.post, true)
      await sendPostConfirmation(result.postIndex, allPosts.length, result.post.topic, postResult.success)

      if (postResult.success) {
        console.log('✅ Post publicado!')
      } else {
        console.log('❌ Falhou:', postResult.error)
      }

      process.exit(0)
    }

    // Outros casos (copy, etc) - apenas finaliza
    console.log('\n✅ Processo concluido!')
    console.log(`   Acao: ${result.action}`)
    process.exit(0)
  }

  // Excedeu maximo de regeneracoes - envia para copiar
  console.log('\n⚠️ Maximo de regeneracoes atingido. Enviando para copiar...')
  await sendNotification('⚠️ Maximo de regeneracoes atingido. Enviando posts para copiar manualmente.')

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
