import 'dotenv/config'
import { createTwitterClient, postTweet, verifyCredentials } from '../src/twitter.js'
import { sendNotification } from '../src/telegram.js'
import { generatePost } from '../src/claude.js'

async function main() {
  console.log('='.repeat(60))
  console.log('BOT-X-POSTS - Post de Exemplo')
  console.log('='.repeat(60))

  // 1. Verificar credenciais do Twitter
  console.log('\n1. Verificando credenciais do X...')
  const client = createTwitterClient()
  const me = await verifyCredentials(client)
  console.log(`   Conectado como: @${me.username} (${me.name})`)

  // 2. Definir topico e contexto (depois isso vira curadoria automatica)
  const topic = 'Vibe Coding'
  const context = `
    Vibe Coding e a nova forma de programar onde voce descreve o que quer
    e a IA (Claude, GPT, etc) escreve o codigo. Ferramentas como Claude Code,
    Cursor e Windsurf estao revolucionando como devs trabalham.
    O movimento cresceu muito em 2025/2026 e agora ate empresas grandes
    estao adotando. A pergunta e: devs vao perder emprego ou ganhar superpoderes?
  `

  // 3. Gerar post com Claude
  console.log('\n2. Gerando post com Claude...')
  const postText = await generatePost(topic, context)
  console.log(`   Post gerado (${postText.length} chars):`)
  console.log(`   "${postText}"`)

  // 4. Publicar no X
  console.log('\n3. Publicando no X...')
  const result = await postTweet(client, postText)
  console.log(`   Tweet ID: ${result.id}`)
  console.log(`   URL: ${result.url}`)

  // 5. Notificar no Telegram
  console.log('\n4. Enviando notificacao no Telegram...')
  const notification = `
<b>Novo Post no X!</b>

<i>"${postText}"</i>

<a href="${result.url}">Ver no X</a>
  `.trim()

  await sendNotification(notification)
  console.log('   Notificacao enviada!')

  console.log('\n' + '='.repeat(60))
  console.log('SUCESSO! Post publicado e notificacao enviada.')
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('ERRO:', err.message)
  process.exit(1)
})
