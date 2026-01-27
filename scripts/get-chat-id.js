import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env')
  process.exit(1)
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

console.log('Bot iniciado! Envie /start para o bot @garimdreaming_bot no Telegram')
console.log('Aguardando mensagem...\n')

bot.on('message', (msg) => {
  console.log('='.repeat(50))
  console.log('CHAT ID:', msg.chat.id)
  console.log('Username:', msg.from.username)
  console.log('Nome:', msg.from.first_name)
  console.log('='.repeat(50))
  console.log('\nAdicione esta linha ao seu .env:')
  console.log(`TELEGRAM_CHAT_ID="${msg.chat.id}"`)
  console.log('\nCtrl+C para sair')
})
