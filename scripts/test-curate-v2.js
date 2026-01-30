import 'dotenv/config'
import { curateContentV2 } from '../src/curate-v2.js'

console.log('🧪 Testando curadoria v2...\n')

try {
  const content = await curateContentV2()

  console.log('\n=== RESULTADO ===\n')

  console.log('🪙 CRYPTO:')
  console.log('   BTC:', content.crypto?.realTimeData?.btcPrice, '(', content.crypto?.realTimeData?.btcChange, '%)')
  console.log('   Fear & Greed:', content.crypto?.realTimeData?.fearGreed?.value, content.crypto?.realTimeData?.fearGreed?.label)
  console.log('   Sentimento X:', content.crypto?.sentiment, '(', content.crypto?.sentimentScore, ')')
  console.log('   Narrativa:', content.crypto?.narrative)
  console.log('   Top tweets:', content.crypto?.topTweets?.length || 0)

  console.log('\n📊 INVESTING:')
  console.log('   Sentimento X:', content.investing?.sentiment, '(', content.investing?.sentimentScore, ')')
  console.log('   Narrativa:', content.investing?.narrative)
  console.log('   Top tweets:', content.investing?.topTweets?.length || 0)

  console.log('\n💻 VIBE CODING:')
  console.log('   Sentimento X:', content.vibeCoding?.sentiment, '(', content.vibeCoding?.sentimentScore, ')')
  console.log('   Narrativa:', content.vibeCoding?.narrative)
  console.log('   Top tweets:', content.vibeCoding?.topTweets?.length || 0)

  console.log('\n✅ Curadoria v2 funcionando!')
} catch (err) {
  console.error('❌ Erro:', err.message)
  process.exit(1)
}
