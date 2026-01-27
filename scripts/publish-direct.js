import 'dotenv/config'
import { createTwitterClient, postTweet } from '../src/twitter.js'
import { sendNotification } from '../src/telegram.js'

// O post [3] que voce escolheu (INVESTING - Consumer Confidence)
const POST_TEXT = `Consumer Confidence despencou de 94.2 pra 84.5 em um mês. O americano já tá gastando como se a recessão fosse amanhã. Plot twist: quando 300 milhões de pessoas cortam gasto ao mesmo tempo, elas criam a recessão que tanto temem.`

async function main() {
  console.log('Publicando post...')
  console.log(`Texto (${POST_TEXT.length} chars):`)
  console.log(`"${POST_TEXT}"`)
  console.log('')

  const client = createTwitterClient()
  const result = await postTweet(client, POST_TEXT)

  console.log('✅ Publicado!')
  console.log(`URL: ${result.url}`)

  await sendNotification(
    `✅ <b>Post publicado!</b>\n\n"${POST_TEXT}"\n\n<a href="${result.url}">Ver no X</a>`
  )

  console.log('Notificacao enviada no Telegram')
}

main().catch(console.error)
