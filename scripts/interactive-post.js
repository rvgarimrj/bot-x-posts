import 'dotenv/config'
import { generatePost } from '../src/claude.js'
import { sendPostsForApproval, waitForChoice } from '../src/telegram.js'
import { createTwitterClient, postTweet } from '../src/twitter.js'
import { curateContent, getFallbackContent } from '../src/curate.js'

async function main() {
  console.log('🎯 Bot-X-Posts - Modo Interativo')
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

  // 2. Gerar posts
  console.log('\n2. Gerando posts com dados curados...')
  const allPosts = []

  for (const [topic, data] of Object.entries(content)) {
    const fullContext = `
Noticia/Tendencia: ${data.context}
Dados: ${data.data.join(', ')}
Fonte: ${data.source}
    `.trim()

    for (const angle of data.angles) {
      console.log(`   Gerando: ${topic}...`)
      try {
        const post = await generatePost(topic, fullContext, angle)
        allPosts.push({ topic, angle, post, chars: post.length, source: data.source })
      } catch (err) {
        console.log(`   ⚠️ Erro ao gerar ${topic}: ${err.message}`)
      }
    }
  }

  if (allPosts.length === 0) {
    console.log('❌ Nenhum post gerado')
    process.exit(1)
  }

  console.log(`   ✅ ${allPosts.length} posts gerados`)

  // 3. Enviar para Telegram
  console.log('\n3. Enviando opcoes para Telegram...')
  await sendPostsForApproval(allPosts)
  console.log('   ✅ Opcoes enviadas')

  // 4. Aguardar escolha
  console.log('\n4. Aguardando escolha no Telegram (timeout: 10min)...')

  const twitterClient = createTwitterClient()

  const result = await waitForChoice(allPosts, async (text) => {
    console.log('\n📤 Publicando no X...')
    const tweetResult = await postTweet(twitterClient, text)
    console.log(`   ✅ ${tweetResult.url}`)
    return tweetResult
  })

  if (result.success) {
    console.log('\n✅ Processo concluido com sucesso!')
    console.log(`   URL: ${result.url}`)
  } else {
    console.log(`\n⚠️ Processo encerrado: ${result.reason}`)
  }

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
