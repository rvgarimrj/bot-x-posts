import 'dotenv/config'
import { generatePost } from '../src/claude.js'
import { sendPostsForReview, waitForApproval, sendNotification } from '../src/telegram-v2.js'
import { createTwitterClient, postTweet } from '../src/twitter.js'
import { curateContent, getFallbackContent } from '../src/curate.js'
import { getEngagementContext } from '../src/learn.js'

const MAX_REGENERATIONS = 3

async function generateAllPosts(content, learningContext) {
  const allPosts = []

  for (const [topic, data] of Object.entries(content)) {
    const fullContext = `
Noticia/Tendencia: ${data.context}
Dados: ${data.data.join(', ')}
Fonte: ${data.source}
    `.trim()

    // Usa o primeiro angulo (melhor) ou escolhe aleatoriamente
    const angle = data.angles[0] || 'Analise do mercado'

    console.log(`   Gerando: ${topic}...`)
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

  const twitterClient = createTwitterClient()
  let regenerationCount = 0

  // Loop de regeneração
  while (regenerationCount < MAX_REGENERATIONS) {
    // 3. Gerar posts
    console.log(`\n3. Gerando posts com dados curados... (tentativa ${regenerationCount + 1})`)
    const allPosts = await generateAllPosts(content, learningContext)

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

    // 5. Aguardar aprovação
    console.log('\n5. Aguardando aprovação (timeout: 20min)...')

    const result = await waitForApproval(allPosts, async (text) => {
      return postTweet(twitterClient, text)
    }, null)

    if (result.action === 'regenerate') {
      regenerationCount++
      console.log(`\n🔄 Regenerando posts... (${regenerationCount}/${MAX_REGENERATIONS})`)
      continue
    }

    // Aprovado ou auto-post
    console.log('\n✅ Processo concluído!')
    console.log(`   Ação: ${result.action}`)
    console.log(`   Resultados:`, result.results)

    process.exit(0)
  }

  // Excedeu máximo de regenerações
  console.log('\n⚠️ Máximo de regenerações atingido. Publicando posts atuais...')
  await sendNotification('⚠️ Máximo de regenerações atingido. Publicando automaticamente.')

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
