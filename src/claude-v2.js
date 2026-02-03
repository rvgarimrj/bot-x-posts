/**
 * Claude V2 - Bilingual Post Generation
 *
 * Generates posts in English and Portuguese (BR)
 * Different system prompts for each language
 *
 * Now integrates with Learning Engine for weighted selection
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// Learning engine import (optional - graceful fallback if not available)
let learningEngine = null
try {
  learningEngine = await import('./learning-engine.js')
} catch (err) {
  console.log('   Learning engine not available, using random selection')
}

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
NUNCA use: "Interestingly", "Notably", "Importantly", "Furthermore", "Moreover", "Indeed", "Essentially", "Fundamentally", "Arguably", "Undoubtedly", "Certainly", "Definitely", "Absolutely", "Extremely", "Highly", "Incredibly", "Remarkable", "Outstanding", "Exceptional", "Comprehensive", "Robust", "Leverage", "Utilize", "Implement", "Facilitate", "Enhance", "Optimize", "Streamline", "Revolutionary", "Game-changer", "Cutting-edge", "State-of-the-art", "Best practices", "Synergy", "Paradigm", "Fun fact:", "E importante notar", "Vale ressaltar", "Interessantemente", "masterpiece", "countless"

=== EXEMPLOS HUMANOS REAIS ===

BOM: "pqp o cursor bugou dnv, terceira vez essa semana. alguem mais? #Cursor"

BOM: "btc em 76k e o fear index em 14 kkkk quem comprou no topo ta sofrendo"

BOM: "descobri esse atalho do claude code hj e me senti burro por nao saber antes. Cmd+K inline edit. vida mudou #ClaudeCode"

BOM: "hot take: copilot ainda ganha do cursor pra autocomplete puro. la eu disse"

RUIM (parece IA): "Here's an interesting insight: After extensively using AI coding tools for 6 months, I've discovered that the real productivity gain isn't speed..."

RUIM (parece IA): "Fun fact: O Bitcoin historicamente apresenta recuperacao apos periodos de extreme fear no indice..."

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

// ==================== HOOK FRAMEWORKS (OPENING STRUCTURES) ====================

// Based on proven X-creator techniques for grabbing attention
// Combined with POST_STYLES for 8x8 = 64 possible combinations
const HOOK_FRAMEWORKS = {
  'en': [
    {
      name: 'extreme',
      instruction: 'Use an extreme statement. "The best/worst/most X I\'ve ever seen." Overdeliver on the promise.',
      examples: ['worst crash ive seen this year', 'best shortcut i learned this month', 'the most underrated AI tool rn']
    },
    {
      name: 'aida',
      instruction: 'AIDA: Attention (hook) -> Interest (what\'s in it for them) -> Desire (make them want it) -> Action (what to do).',
      examples: ['most devs waste hours on X. i did too. then i found Y. now Z', 'everyone sleeping on this feature. it saves me 30min daily. try it']
    },
    {
      name: 'pas',
      instruction: 'PAS: Problem (name it) -> Agitate (make them feel it) -> Solution (offer the fix).',
      examples: ['context switching kills your flow. been there. this fixed it', 'sick of losing to FOMO? this rule changed everything']
    },
    {
      name: 'bab',
      instruction: 'BAB: Before (where you were) -> After (where you are now) -> Bridge (how you got there). Show transformation.',
      examples: ['used to spend 3h debugging. now 20min. the trick?', 'portfolio was -40%. now green. what changed:']
    },
    {
      name: 'emotional',
      instruction: 'Lead with RAW emotion (frustration, surprise, excitement). Then mix in the lesson or insight.',
      examples: ['almost rage-quit yesterday. then realized...', 'got rekt today. pain. but heres what i shouldve done']
    },
    {
      name: 'results',
      instruction: 'Lead with RESULTS you achieved. Then tell them how. Builds authority.',
      examples: ['shipped 3 features today instead of 1. heres my setup', 'turned $500 into $2k this month. not luck - strategy']
    },
    {
      name: 'client',
      instruction: 'Use THIRD-PARTY proof. What a friend/colleague/junior discovered. Builds credibility without bragging.',
      examples: ['friend asked me to review his code. found this gem', 'junior on my team showed me a trick i didnt know']
    },
    {
      name: 'idea',
      instruction: 'ONE powerful line that stands alone. No explanation needed. Punchy, memorable, quotable.',
      examples: ['AI wont replace devs. devs using AI will replace devs not using it', 'the market rewards patience. every. single. time.']
    }
  ],
  'pt-BR': [
    {
      name: 'extreme',
      instruction: 'Use um extremo. "O melhor/pior/mais X que ja vi." Entregue mais do que prometeu.',
      examples: ['pior crash que vi esse ano', 'melhor atalho que aprendi esse mes', 'a ferramenta mais subestimada de AI agora']
    },
    {
      name: 'aida',
      instruction: 'AIDA: Atencao (gancho) -> Interesse (o que ganham) -> Desejo (fazer querer) -> Acao (o que fazer).',
      examples: ['maioria dos devs perde horas com X. eu tambem perdia. achei Y. agora Z', 'ngm conhece essa feature. economiza 30min por dia. testa']
    },
    {
      name: 'pas',
      instruction: 'PAS: Problema (nomeia) -> Agita (faz sentir) -> Solucao (oferece a saida).',
      examples: ['trocar de contexto mata seu flow. ja passei por isso. isso resolveu', 'cansado de perder trade por FOMO? essa regra mudou tudo']
    },
    {
      name: 'bab',
      instruction: 'BAB: Antes (onde estava) -> Depois (onde esta) -> Ponte (como chegou). Mostra transformacao.',
      examples: ['gastava 3h debugando. agora 20min. o truque?', 'carteira tava -40%. agora verde. o que mudou:']
    },
    {
      name: 'emotional',
      instruction: 'Comeca com EMOCAO crua (frustracao, surpresa, animacao). Depois mistura a licao.',
      examples: ['quase larguei tudo ontem. dai percebi...', 'tomei loss hoje. dor. mas o que eu devia ter feito']
    },
    {
      name: 'results',
      instruction: 'Comeca com RESULTADO que alcancou. Depois conta como. Constroi autoridade.',
      examples: ['entreguei 3 features hoje ao inves de 1. meu setup', 'transformei $500 em $2k esse mes. nao foi sorte - estrategia']
    },
    {
      name: 'client',
      instruction: 'Usa prova de TERCEIROS. O que amigo/colega/junior descobriu. Credibilidade sem parecer convencido.',
      examples: ['amigo pediu pra revisar codigo dele. achei essa perola', 'junior do time me mostrou um truque que eu nao sabia']
    },
    {
      name: 'idea',
      instruction: 'UMA frase poderosa que fica de pe sozinha. Sem explicacao. Direto, memoravel, quotable.',
      examples: ['AI nao vai substituir dev. dev usando AI vai substituir dev sem AI', 'mercado premia paciencia. toda. santa. vez.']
    }
  ]
}

// ==================== SELECTION FUNCTIONS ====================

/**
 * Select style using learning engine weights (or random if not available)
 */
function selectStyle(language) {
  const styles = POST_STYLES[language] || POST_STYLES['en']
  const styleNames = styles.map(s => s.name)

  if (learningEngine) {
    const selectedName = learningEngine.weightedSelect(styleNames, 'styles')
    return styles.find(s => s.name === selectedName) || styles[0]
  }

  return styles[Math.floor(Math.random() * styles.length)]
}

/**
 * Select hook using learning engine weights (or random if not available)
 */
function selectHook(language) {
  const hooks = HOOK_FRAMEWORKS[language] || HOOK_FRAMEWORKS['en']
  const hookNames = hooks.map(h => h.name)

  if (learningEngine) {
    const selectedName = learningEngine.weightedSelect(hookNames, 'hooks')
    return hooks.find(h => h.name === selectedName) || hooks[0]
  }

  return hooks[Math.floor(Math.random() * hooks.length)]
}

// ==================== POST GENERATION ====================

/**
 * Generate a single post
 * @param {string} topic - Topic (crypto, investing, ai, vibeCoding)
 * @param {string} newsContext - Formatted data context
 * @param {string} angle - Suggested angle
 * @param {string} language - Language code (en or pt-BR)
 * @param {number} retries - Retry count
 * @returns {Promise<Object>} Generated post with metadata
 */
export async function generatePost(topic, newsContext, angle, language = 'pt-BR', retries = 2) {
  // Build system prompt based on language and topic
  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT_BR
  const topicContext = TOPIC_CONTEXT[topic]?.[language] || ''
  const fullSystemPrompt = basePrompt + topicContext

  // Select STYLE using learning weights
  const selectedStyle = selectStyle(language)

  // Select HOOK using learning weights
  const selectedHook = selectHook(language)

  console.log(`      [style: ${selectedStyle.name} + hook: ${selectedHook.name}]`)

  const userPrompt = language === 'en'
    ? `TOPIC: ${topic}

DATA:
${newsContext}

ANGLE: ${angle}

=== YOUR ASSIGNMENT ===
TONE/STYLE: ${selectedStyle.instruction}
HOOK FRAMEWORK: ${selectedHook.instruction}
HOOK EXAMPLES: ${selectedHook.examples.join(' | ')}

Write ONE post combining this TONE with this HOOK structure.

CRITICAL:
- Use the hook framework to structure your opening
- Apply the tone throughout
- Sound like texting a friend, not writing an essay
- ONE point only
- NEVER use banned words
- 0-2 hashtags
- 120-250 chars

Just the post text.`
    : `TOPICO: ${topic}

DADOS:
${newsContext}

ANGULO: ${angle}

=== SUA TAREFA ===
TOM/ESTILO: ${selectedStyle.instruction}
FRAMEWORK DE HOOK: ${selectedHook.instruction}
EXEMPLOS DE HOOK: ${selectedHook.examples.join(' | ')}

Escreva UM post combinando esse TOM com essa estrutura de HOOK.

CRITICO:
- Use o framework de hook pra estruturar a abertura
- Aplique o tom ao longo do post
- Som de mensagem pra amigo, nao redacao
- UM ponto so
- NUNCA use palavras proibidas
- 0-2 hashtags
- 120-250 chars

So o texto do post.`

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
    console.log(`   Post muito longo (${post.length} chars), regenerando...`)
    return generatePost(topic, newsContext, angle, language, retries - 1)
  }

  // Return object with post text and metadata for learning engine
  return {
    text: post,
    _metadata: {
      hook: selectedHook.name,
      style: selectedStyle.name,
      topic,
      language,
      chars: post.length,
      generatedAt: new Date().toISOString()
    }
  }
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
        angle = typeof a === 'string' ? a : `[${a.type}] ${a.hook} -> ${a.insight}`
      }

      console.log(`   Gerando: ${topic} (${language})...`)

      try {
        const result = await generatePost(topic, fullContext, angle, language)
        // Handle both object {text, _metadata} and plain string (backward compat)
        const postText = typeof result === 'string' ? result : result.text
        const metadata = result._metadata || {}
        posts.push({
          topic,
          language,
          post: postText,
          sentiment: data.sentiment,
          chars: postText.length,
          hook: metadata.hook,
          style: metadata.style
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
    const result = await generatePost(topic, newsContext, angle, language)
    const postText = typeof result === 'string' ? result : result.text
    const metadata = result._metadata || {}
    posts.push({
      angle,
      post: postText,
      language,
      hook: metadata.hook,
      style: metadata.style
    })
  }
  return posts
}

/**
 * Get current learning stats (for debugging/monitoring)
 */
export function getLearningStats() {
  if (!learningEngine) {
    return { available: false }
  }

  const learnings = learningEngine.loadLearnings()
  return {
    available: true,
    totalPostsAnalyzed: learnings.totalPostsAnalyzed,
    topHooks: Object.entries(learnings.weights.hooks)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, weight]) => ({ name, weight })),
    topStyles: Object.entries(learnings.weights.styles)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, weight]) => ({ name, weight })),
    lastUpdated: learnings.lastUpdated
  }
}

export default {
  generatePost,
  generateAllPosts,
  generateMultiplePosts,
  getLearningStats
}
