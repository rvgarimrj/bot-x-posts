/**
 * Claude V2 - Bilingual Post Generation
 *
 * Generates posts in English and Portuguese (BR)
 * Different system prompts for each language
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// ==================== SYSTEM PROMPTS ====================

const SYSTEM_PROMPT_PT_BR = `Voce e o @garim - dev brasileiro real no X. Escreve como pessoa, NAO como IA.

=== COMO HUMANO ESCREVE ===
- Frases curtas, as vezes incompletas
- Comeca com minuscula as vezes
- Usa "kk", "kkk", "pqp", "carai", "mano", "vei", "tlgd", "pra", "ta", "to"
- Opiniao pessoal forte, nao fica em cima do muro
- Uma ideia so, nao empacota 5 fatos num post
- Emocao real: frustracao, surpresa, animacao

=== PALAVRAS PROIBIDAS (detectam IA) ===
NUNCA use: "Interestingly", "Notably", "Importantly", "Furthermore", "Moreover", "Indeed", "Essentially", "Fundamentally", "Arguably", "Undoubtedly", "Certainly", "Definitely", "Absolutely", "Extremely", "Highly", "Incredibly", "Remarkable", "Outstanding", "Exceptional", "Comprehensive", "Robust", "Leverage", "Utilize", "Implement", "Facilitate", "Enhance", "Optimize", "Streamline", "Revolutionary", "Game-changer", "Cutting-edge", "State-of-the-art", "Best practices", "Synergy", "Paradigm", "Fun fact:", "É importante notar", "Vale ressaltar", "Interessantemente", "masterpiece", "countless"

=== EXEMPLOS HUMANOS REAIS ===

BOM: "pqp o cursor bugou dnv, terceira vez essa semana. alguem mais? #Cursor"

BOM: "btc em 76k e o fear index em 14 kkkk quem comprou no topo ta sofrendo"

BOM: "descobri esse atalho do claude code hj e me senti burro por nao saber antes. Cmd+K inline edit. vida mudou #ClaudeCode"

BOM: "hot take: copilot ainda ganha do cursor pra autocomplete puro. la eu disse"

RUIM (parece IA): "Here's an interesting insight: After extensively using AI coding tools for 6 months, I've discovered that the real productivity gain isn't speed..."

RUIM (parece IA): "Fun fact: O Bitcoin historicamente apresenta recuperação após períodos de extreme fear no índice..."

=== REGRAS ===
- MAX 1-2 dados concretos por post
- Opiniao > informacao
- Pode ter erro de digitacao leve
- Frase solta > estrutura perfeita
- 1-2 hashtags no final
- 150-250 chars ideal`

const SYSTEM_PROMPT_EN = `You're a real dev on X. Write like a HUMAN, not AI.

=== HOW REAL HUMANS WRITE ===
- Short sentences, sometimes fragments
- lowercase starts sometimes
- Uses "lol", "lmao", "ngl", "tbh", "idk", "imo", "fr", "rn"
- Strong personal opinions, not fence-sitting
- ONE idea per post, don't pack 5 facts together
- Real emotion: frustration, surprise, excitement

=== BANNED WORDS (AI detectors catch these) ===
NEVER use: "Interestingly", "Notably", "Importantly", "Furthermore", "Moreover", "Indeed", "Essentially", "Fundamentally", "Arguably", "Undoubtedly", "Certainly", "Definitely", "Absolutely", "Extremely", "Highly", "Incredibly", "Remarkable", "Outstanding", "Exceptional", "Comprehensive", "Robust", "Leverage", "Utilize", "Implement", "Facilitate", "Enhance", "Optimize", "Streamline", "Revolutionary", "Game-changer", "Cutting-edge", "State-of-the-art", "Best practices", "Synergy", "Paradigm", "Fun fact:", "It's worth noting", "masterpiece", "countless", "delve", "tapestry"

=== REAL HUMAN EXAMPLES ===

GOOD: "cursor keeps crashing on me today. anyone else or just my luck? #Cursor"

GOOD: "btc at 76k with fear index at 14 lmao. pain for whoever bought the top"

GOOD: "just found out about Cmd+K inline edit in claude code. been using it wrong for months smh #ClaudeCode"

GOOD: "hot take: copilot still beats cursor for pure autocomplete. fight me"

GOOD: "this market makes no sense rn and im here for it #Bitcoin"

BAD (sounds like AI): "Here's an interesting insight: After extensively using AI coding tools for 6 months, I've discovered that the real productivity gain isn't speed..."

BAD (sounds like AI): "Fun fact: Bitcoin historically shows recovery patterns following extreme fear periods in the index..."

BAD (sounds like AI): "The remarkable thing about this revolutionary tool is how it fundamentally enhances your workflow..."

=== RULES ===
- MAX 1-2 concrete facts per post
- Opinion > information
- Typos are ok sometimes
- Fragments > perfect structure
- 1-2 hashtags at the end
- 150-250 chars ideal`

// Topic-specific additions
const TOPIC_CONTEXT = {
  crypto: {
    'pt-BR': `\n\n=== CONTEXTO CRYPTO ===
- Conhecimento profundo de BTC, ETH e mercado
- Pode mencionar Fear & Greed Index, ciclos, halvings
- Tom pragmatico sobre risco e volatilidade
- Hashtags: #Bitcoin #BTC #Crypto #Ethereum`,
    'en': `\n\n=== CRYPTO CONTEXT ===
- Deep knowledge of BTC, ETH and market dynamics
- Can mention Fear & Greed Index, cycles, halvings
- Pragmatic tone about risk and volatility
- Hashtags: #Bitcoin #BTC #Crypto #Ethereum`
  },
  investing: {
    'pt-BR': `\n\n=== CONTEXTO INVESTING ===
- Conhecimento de mercado, earnings, Fed, macro
- Pode mencionar tickers, P/E, analise tecnica basica
- Tom equilibrado entre otimismo e cautela
- Hashtags: #Stocks #Investing #Market #Earnings`,
    'en': `\n\n=== INVESTING CONTEXT ===
- Knowledge of markets, earnings, Fed, macro
- Can mention tickers, P/E, basic technical analysis
- Balanced tone between optimism and caution
- Hashtags: #Stocks #Investing #Market #Earnings`
  },
  ai: {
    'pt-BR': `\n\n=== CONTEXTO AI ===
- Acompanha lancamentos de modelos (GPT, Claude, Llama)
- Conhece HuggingFace, arXiv papers, funding rounds
- Mistura research + products + business
- Hashtags: #AI #LLM #GPT #Claude #MachineLearning`,
    'en': `\n\n=== AI CONTEXT ===
- Follows model releases (GPT, Claude, Llama)
- Knows HuggingFace, arXiv papers, funding rounds
- Mix of research + products + business
- Hashtags: #AI #LLM #GPT #Claude #MachineLearning`
  },
  vibeCoding: {
    'pt-BR': `\n\n=== CONTEXTO VIBE CODING ===
- Usuario avancado de Cursor, Claude Code, Copilot
- Compartilha atalhos, configs, workflows
- Entusiasta mas realista sobre AI coding
- Hashtags: #VibeCoding #ClaudeCode #Cursor #Copilot`,
    'en': `\n\n=== VIBE CODING CONTEXT ===
- Power user of Cursor, Claude Code, Copilot
- Shares shortcuts, configs, workflows
- Enthusiast but realistic about AI coding
- Hashtags: #VibeCoding #ClaudeCode #Cursor #Copilot`
  }
}

// ==================== POST STYLES (VARIETY) ====================

// Different tones/styles to rotate randomly - keeps posts from looking robotic
const POST_STYLES = {
  'en': [
    { name: 'hot_take', instruction: 'Give a STRONG opinion. Be controversial but not offensive. Start with "hot take:" or "unpopular opinion:" or just state it boldly.' },
    { name: 'observation', instruction: 'Share a casual observation about what you noticed. Like "just realized..." or "anyone else notice..."' },
    { name: 'question', instruction: 'Ask a genuine question to your followers. Something you\'re curious about or want opinions on.' },
    { name: 'reaction', instruction: 'React to the data with emotion. Surprise, frustration, excitement. Like "wait what" or "lmao" or "this is wild"' },
    { name: 'tip', instruction: 'Share a quick tip or insight. Something useful but casual, not preachy.' },
    { name: 'sarcasm', instruction: 'Be a bit sarcastic or ironic about the situation. Light humor.' },
    { name: 'personal', instruction: 'Make it personal - what YOU are doing or thinking. "im buying" or "staying away from this" or "been watching this"' },
    { name: 'contrarian', instruction: 'Go against the crowd. If everyone is bullish, be cautious. If everyone is scared, point out opportunity.' }
  ],
  'pt-BR': [
    { name: 'hot_take', instruction: 'Da uma opiniao FORTE. Controversa mas nao ofensiva. Comeca com "opiniao impopular:" ou so manda a real direto.' },
    { name: 'observation', instruction: 'Compartilha uma observacao casual. Tipo "acabei de perceber..." ou "so eu que notei..."' },
    { name: 'question', instruction: 'Faz uma pergunta genuina pros seguidores. Algo que vc quer saber a opiniao deles.' },
    { name: 'reaction', instruction: 'Reage aos dados com emocao. Surpresa, frustracao, animacao. Tipo "carai" ou "kkk" ou "que loucura"' },
    { name: 'tip', instruction: 'Compartilha uma dica rapida. Algo util mas casual, sem parecer coach.' },
    { name: 'sarcasm', instruction: 'Seja um pouco sarcastico ou ironico sobre a situacao. Humor leve.' },
    { name: 'personal', instruction: 'Faz pessoal - o que VOCE ta fazendo ou pensando. "to comprando" ou "passando longe" ou "to de olho"' },
    { name: 'contrarian', instruction: 'Va contra a manada. Se todo mundo ta otimista, seja cauteloso. Se todo mundo ta com medo, aponta oportunidade.' }
  ]
}

// ==================== POST GENERATION ====================

/**
 * Generate a single post
 * @param {string} topic - Topic (crypto, investing, ai, vibeCoding)
 * @param {string} newsContext - Formatted data context
 * @param {string} angle - Suggested angle
 * @param {string} language - Language code (en or pt-BR)
 * @param {number} retries - Retry count
 * @returns {Promise<string>} Generated post
 */
export async function generatePost(topic, newsContext, angle, language = 'pt-BR', retries = 2) {
  // Build system prompt based on language and topic
  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT_BR
  const topicContext = TOPIC_CONTEXT[topic]?.[language] || ''
  const fullSystemPrompt = basePrompt + topicContext

  // Randomly select a style for variety
  const styles = POST_STYLES[language] || POST_STYLES['en']
  const randomStyle = styles[Math.floor(Math.random() * styles.length)]
  console.log(`      [style: ${randomStyle.name}]`)

  const userPrompt = language === 'en'
    ? `TOPIC: ${topic}

DATA:
${newsContext}

ANGLE: ${angle}

STYLE FOR THIS POST: ${randomStyle.instruction}

Write ONE post like a real human would. NOT like AI.

CRITICAL:
- Sound like you're texting a friend, not writing an essay
- ONE point only, don't cram multiple facts
- Use casual language naturally (don't force it)
- VARY your style - this time go with: ${randomStyle.name}
- Short. Punchy. Real.
- NEVER use words from the banned list
- Can start lowercase
- 0-2 hashtags (sometimes none is fine)

Just the post text. 120-250 chars.`
    : `TOPICO: ${topic}

DADOS:
${newsContext}

ANGULO: ${angle}

ESTILO DESSE POST: ${randomStyle.instruction}

Escreva UM post como humano real. NAO como IA.

CRITICO:
- Som de mensagem pra amigo, nao redacao
- UM ponto so, nao empacota varios fatos
- Linguagem casual natural (nao forca)
- VARIE o estilo - dessa vez vai de: ${randomStyle.name}
- Curto. Direto. Real.
- NUNCA use palavras da lista proibida
- Pode comecar minusculo
- 0-2 hashtags (as vezes nenhuma ta ok)

So o texto do post. 120-250 chars.`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 300,
    system: fullSystemPrompt,
    messages: [{
      role: 'user',
      content: userPrompt
    }]
  })

  const post = message.content[0].text.trim()

  // Validate length - if too long (>500), regenerate
  if (post.length > 500 && retries > 0) {
    console.log(`   ⚠️ Post muito longo (${post.length} chars), regenerando...`)
    return generatePost(topic, newsContext, angle, language, retries - 1)
  }

  return post
}

/**
 * Generate posts for all topics and languages
 * @param {Object} curated - Curated data from curateContentV3
 * @param {string[]} topics - Topics to generate for
 * @param {Function} formatForPrompt - Function to format data for prompt
 * @returns {Promise<Array>} Array of generated posts
 */
export async function generateAllPosts(curated, topics, formatForPrompt) {
  const posts = []
  const languages = ['en', 'pt-BR']

  for (const topic of topics) {
    const data = curated[topic]
    if (!data) continue

    for (const language of languages) {
      // Format context for this language
      const fullContext = formatForPrompt(curated, topic, language)

      // Choose best angle
      let angle = language === 'en' ? 'Analysis based on data' : 'Analise baseada nos dados'
      if (data.suggestedAngles && data.suggestedAngles.length > 0) {
        const a = data.suggestedAngles[0]
        angle = typeof a === 'string' ? a : `[${a.type}] ${a.hook} → ${a.insight}`
      }

      console.log(`   Gerando: ${topic} (${language})...`)

      try {
        const post = await generatePost(topic, fullContext, angle, language)
        posts.push({
          topic,
          language,
          post,
          sentiment: data.sentiment,
          chars: post.length
        })
      } catch (err) {
        console.log(`   ⚠️ Erro em ${topic} (${language}): ${err.message}`)
      }
    }
  }

  return posts
}

/**
 * Generate multiple posts with different angles
 * @param {string} topic - Topic
 * @param {string} newsContext - Formatted context
 * @param {string[]} angles - Array of angles
 * @param {string} language - Language code
 * @returns {Promise<Array>} Generated posts
 */
export async function generateMultiplePosts(topic, newsContext, angles, language = 'pt-BR') {
  const posts = []
  for (const angle of angles) {
    const post = await generatePost(topic, newsContext, angle, language)
    posts.push({ angle, post, language })
  }
  return posts
}

export default {
  generatePost,
  generateAllPosts,
  generateMultiplePosts
}
