import 'dotenv/config'
import { TwitterApi } from 'twitter-api-v2'

console.log('=== DEBUG AUTH ===')
console.log('')
console.log('Variaveis de ambiente:')
console.log('X_API_KEY:', process.env.X_API_KEY ? `${process.env.X_API_KEY.slice(0, 8)}...` : 'NAO DEFINIDA')
console.log('X_API_KEY_SECRET:', process.env.X_API_KEY_SECRET ? `${process.env.X_API_KEY_SECRET.slice(0, 8)}...` : 'NAO DEFINIDA')
console.log('X_ACCESS_TOKEN:', process.env.X_ACCESS_TOKEN ? `${process.env.X_ACCESS_TOKEN.slice(0, 15)}...` : 'NAO DEFINIDA')
console.log('X_ACCESS_TOKEN_SECRET:', process.env.X_ACCESS_TOKEN_SECRET ? `${process.env.X_ACCESS_TOKEN_SECRET.slice(0, 8)}...` : 'NAO DEFINIDA')
console.log('')

// Teste 1: v1 verifyCredentials
console.log('Teste 1: v1.verifyCredentials()')
try {
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })
  const me = await client.v1.verifyCredentials()
  console.log('SUCESSO:', me.screen_name)
} catch (e) {
  console.log('ERRO:', e.message)
}

// Teste 2: v2 me
console.log('')
console.log('Teste 2: v2.me()')
try {
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })
  const me = await client.v2.me()
  console.log('SUCESSO:', me.data.username)
} catch (e) {
  console.log('ERRO:', e.message)
}

// Teste 3: Bearer Token (app-only auth)
console.log('')
console.log('Teste 3: Bearer Token (app-only)')
try {
  const client = new TwitterApi(process.env.X_BEARER_TOKEN)
  const user = await client.v2.userByUsername('garimdreaming')
  console.log('SUCESSO:', user.data.username, '-', user.data.name)
} catch (e) {
  console.log('ERRO:', e.message)
}
