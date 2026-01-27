import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
const chatId = process.env.TELEGRAM_CHAT_ID

console.log('Enviando mensagem de teste...')
console.log('Chat ID:', chatId)
console.log('Token:', process.env.TELEGRAM_BOT_TOKEN?.slice(0, 20) + '...')

try {
  const result = await bot.sendMessage(chatId, '🔔 Teste de conexao - Bot-X-Posts funcionando!')
  console.log('Mensagem enviada! ID:', result.message_id)
} catch (err) {
  console.error('Erro:', err.message)
}
