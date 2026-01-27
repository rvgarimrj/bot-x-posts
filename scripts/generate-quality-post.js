import 'dotenv/config'
import { generatePost } from '../src/claude.js'

// DADOS REAIS DE HOJE - 27/01/2026
const NEWS_DATA = {
  crypto: {
    context: `
- Bitcoin em $88k, perto da minima do ano
- Ouro bateu $5,100 pela primeira vez na historia (alta de 1.3% no dia)
- Prata disparou para $118 (alta de 7%)
- ETFs de Bitcoin: $1.3 bilhao em SAIDAS na ultima semana
- Polymarket: 76% de chance de shutdown do governo em 31/jan
- Rick Rieder (BlackRock) e favorito para Fed chair - ele e pro-crypto e ve BTC como "novo ouro"
- Patrick Witt (conselheiro crypto da Casa Branca): stablecoins sao o "gateway drug" para financas globais
- Fed decide taxa amanha - expectativa e manutencao
    `,
    angles: [
      'Contraste: BTC sangrando enquanto ouro/prata batem recordes. O "ouro digital" falhou no teste de stress?',
      'Rick Rieder pro-crypto como Fed chair seria game changer - mas mercado nao esta precificando isso',
      'Saidas de $1.3bi dos ETFs mostram que institucionais ainda nao confiam em BTC como safe haven'
    ]
  },
  investing: {
    context: `
- Consumer Confidence Index despencou de 94.2 para 84.5 (queda massiva)
- Expectations Index em 65.1 - publico americano espera recessao
- UnitedHealth -19% depois de Trump manter Medicare flat
- GM +4%: earnings acima do esperado, dividendo +20%, buyback de $6bi
- Boeing: vendas +57% mas acao -3% (mercado nao gostou do mix)
- Nvidia investiu $2bi na CoreWeave para 5GW de AI factories ate 2030
- 4 das Magnificent 7 reportam earnings essa semana
    `,
    angles: [
      'Consumer Confidence em queda livre e self-fulfilling prophecy - quando todo mundo espera recessao, comportamento muda',
      'GM vs Boeing: um bateu earnings e subiu, outro bateu earnings e caiu. Wall Street nao liga pra numeros, liga pra narrativa',
      'Nvidia jogando $2bi na CoreWeave mostra que a briga de AI infrastructure esta so comecando'
    ]
  },
  vibeCoding: {
    context: `
- Claude Code usa 5.5x menos tokens que Cursor para mesma tarefa
- Claude Code tem subagents: multiplos agentes trabalhando em paralelo
- Sistema de checkpoints: auto-save antes de cada mudanca, /rewind para voltar
- Dev criou TrapC (extensao memory-safe de C) usando Claude
- Porem: DeepSeek encontrou bug no codigo que Claude gerou e nao detectou
- Debate: "Claude Code wrappers serao o Cursor de 2026"
- Claude Code funciona melhor em codebases grandes (75% sucesso em 50k+ LOC)
    `,
    angles: [
      'A ironia: dev usa IA pra criar linguagem "memory-safe" e a IA gera bugs. Confianca cega em AI e o novo "funciona na minha maquina"',
      '5.5x menos tokens = 5.5x menos custo. A guerra nao e inteligencia, e eficiencia de capital',
      'Claude Code brilha em codebases grandes (75% em 50k+ LOC). Pra projetos pequenos, tanto faz. Pra legado, e game changer'
    ]
  }
}

async function generateQualityPosts() {
  console.log('='.repeat(70))
  console.log('GERANDO POSTS COM DADOS REAIS - 27/01/2026')
  console.log('='.repeat(70))

  const allPosts = []

  for (const [topic, data] of Object.entries(NEWS_DATA)) {
    console.log(`\n## ${topic.toUpperCase()}\n`)

    for (let i = 0; i < data.angles.length; i++) {
      const angle = data.angles[i]
      console.log(`Gerando post ${i + 1}/3 para ${topic}...`)

      const post = await generatePost(topic, data.context, angle)

      console.log(`\nAngulo: ${angle}`)
      console.log(`Post (${post.length} chars):`)
      console.log(`"${post}"`)
      console.log('-'.repeat(70))

      allPosts.push({ topic, angle, post, chars: post.length })
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('RESUMO - TODOS OS POSTS GERADOS')
  console.log('='.repeat(70))

  allPosts.forEach((p, i) => {
    console.log(`\n[${i + 1}] ${p.topic.toUpperCase()} (${p.chars} chars)`)
    console.log(`    "${p.post}"`)
  })
}

generateQualityPosts().catch(console.error)
