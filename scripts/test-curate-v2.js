import 'dotenv/config'
import { curateContentV2 } from '../src/curate-v2.js'

console.log('🧪 Testando curadoria v2 (com hashtags, autores e mentions)...\n')

try {
  const content = await curateContentV2()

  console.log('\n=== RESULTADO ===\n')

  // Global trends
  if (content.globalTrends?.length > 0) {
    console.log('🌍 TRENDS GLOBAIS:')
    content.globalTrends.slice(0, 5).forEach(t => {
      console.log(`   ${t.name} (${t.tweetVolume || 'N/A'} tweets)`)
    })
    console.log()
  }

  console.log('🪙 CRYPTO:')
  console.log('   BTC:', content.crypto?.realTimeData?.btcPrice, '(', content.crypto?.realTimeData?.btcChange, '%)')
  console.log('   Fear & Greed:', content.crypto?.realTimeData?.fearGreed?.value, content.crypto?.realTimeData?.fearGreed?.label)
  console.log('   Sentimento:', content.crypto?.sentiment, '(', content.crypto?.sentimentScore, ')')
  console.log('   Narrativa:', content.crypto?.narrative)
  if (content.crypto?.trendingHashtags?.length > 0) {
    console.log('   Hashtags:', content.crypto.trendingHashtags.map(h => h.tag).join(' '))
  }
  if (content.crypto?.topAuthors?.length > 0) {
    console.log('   Top Autores:', content.crypto.topAuthors.map(a => `${a.author} (${a.followers})`).join(', '))
  }
  if (content.crypto?.topMentions?.length > 0) {
    console.log('   Mentions:', content.crypto.topMentions.map(m => m.mention).join(', '))
  }
  console.log('   Top tweets:', content.crypto?.topTweets?.length || 0)

  console.log('\n📊 INVESTING:')
  console.log('   Sentimento:', content.investing?.sentiment, '(', content.investing?.sentimentScore, ')')
  console.log('   Narrativa:', content.investing?.narrative)
  if (content.investing?.trendingHashtags?.length > 0) {
    console.log('   Hashtags:', content.investing.trendingHashtags.map(h => h.tag).join(' '))
  }
  if (content.investing?.topAuthors?.length > 0) {
    console.log('   Top Autores:', content.investing.topAuthors.map(a => `${a.author} (${a.followers})`).join(', '))
  }
  console.log('   Top tweets:', content.investing?.topTweets?.length || 0)

  console.log('\n💻 VIBE CODING:')
  console.log('   Sentimento:', content.vibeCoding?.sentiment, '(', content.vibeCoding?.sentimentScore, ')')
  console.log('   Narrativa:', content.vibeCoding?.narrative)
  if (content.vibeCoding?.trendingHashtags?.length > 0) {
    console.log('   Hashtags:', content.vibeCoding.trendingHashtags.map(h => h.tag).join(' '))
  }
  if (content.vibeCoding?.topAuthors?.length > 0) {
    console.log('   Top Autores:', content.vibeCoding.topAuthors.map(a => `${a.author} (${a.followers})`).join(', '))
  }
  console.log('   Top tweets:', content.vibeCoding?.topTweets?.length || 0)

  console.log('\n✅ Curadoria v2 funcionando!')
} catch (err) {
  console.error('❌ Erro:', err.message)
  console.error(err.stack)
  process.exit(1)
}
