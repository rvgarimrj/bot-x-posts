/**
 * Claude V2 - Bilingual Post Generation
 *
 * Generates posts in English and Portuguese (BR)
 * Different system prompts for each language
 *
 * Now integrates with Learning Engine for weighted selection
 * Includes LANGUAGE_EXPERIMENTS for A/B testing different writing styles
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

// ==================== LANGUAGE EXPERIMENTS (A/B TESTING) ====================

// Experiments for testing different writing approaches
// Each experiment has different constraints and instructions
// Learning engine will track which experiments perform best
const LANGUAGE_EXPERIMENTS = {
  'en': [
    {
      name: 'ultra_short',
      instruction: 'Maximum 100 chars. Punchy. No fluff. Every word must earn its place.',
      maxChars: 100,
      examples: ['btc ripping. you in or watching?', 'cursor > copilot. fight me.', 'shipped 3 PRs today. AI did half.']
    },
    {
      name: 'question_first',
      instruction: 'Start with a question that hooks. Then answer briefly. Question must be genuinely interesting.',
      maxChars: 200,
      examples: ['why do devs still debug manually? cursor does it in 5min', 'whats the point of HODL if youre not DCAing?']
    },
    {
      name: 'numbers_lead',
      instruction: 'Lead with a specific number or stat. Makes it concrete and credible. No vague claims.',
      maxChars: 200,
      examples: ['72% of my PRs this week were AI-assisted. not exaggerating', '$83k btc and fear index at 20. numbers dont lie']
    },
    {
      name: 'contrarian_shock',
      instruction: 'Start with something that sounds wrong but is true. Challenges assumptions. Makes people stop scrolling.',
      maxChars: 200,
      examples: ['copilot made me worse at coding. heres why thats good', 'bear markets are when millionaires are made. everyone forgets']
    },
    {
      name: 'meme_speak',
      instruction: 'Use meme language naturally. "fr fr", "no cap", "lowkey", "its giving". Dont force it.',
      maxChars: 180,
      examples: ['no cap claude code is lowkey goated rn', 'btc fr fr testing support again. we been here before']
    }
  ],
  'pt-BR': [
    {
      name: 'ultra_curto',
      instruction: 'Maximo 100 chars. Direto. Sem enrolacao. Cada palavra tem que valer.',
      maxChars: 100,
      examples: ['btc subindo. tu ta dentro ou olhando?', 'cursor > copilot. briga comigo.', 'entreguei 3 PRs hj. AI fez metade.']
    },
    {
      name: 'pergunta_primeiro',
      instruction: 'Comeca com pergunta que prende. Depois responde rapido. Pergunta tem que ser interessante de verdade.',
      maxChars: 200,
      examples: ['pq dev ainda debuga manual? cursor faz em 5min', 'qual sentido de HODL se nao ta DCAando?']
    },
    {
      name: 'numero_na_frente',
      instruction: 'Comeca com numero especifico. Concretiza e da credibilidade. Nada de afirmacao vaga.',
      maxChars: 200,
      examples: ['72% dos meus PRs essa semana foram com AI. sem exagero', 'btc em $83k e fear index em 20. numeros nao mentem']
    },
    {
      name: 'contra_senso',
      instruction: 'Comeca com algo que parece errado mas e verdade. Desafia suposicoes. Faz parar o scroll.',
      maxChars: 200,
      examples: ['copilot me fez codar pior. e isso e bom', 'bear market e quando milionario e feito. todo mundo esquece']
    },
    {
      name: 'girias',
      instruction: 'Usa girias naturalmente. "mano", "real", "bora", "sinistro", "da hora". Nao forca.',
      maxChars: 180,
      examples: ['mano claude code ta sinistro real', 'btc testando suporte dnv. bora ver se segura']
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

/**
 * Select language experiment using learning engine weights (or random if not available)
 * @param {string} language - Language code (en or pt-BR)
 * @returns {Object|null} Selected experiment or null if experiments disabled
 */
function selectLanguageExperiment(language) {
  const experiments = LANGUAGE_EXPERIMENTS[language] || LANGUAGE_EXPERIMENTS['en']

  // 30% chance to run an experiment (allows comparison with baseline)
  // This ensures we still generate "normal" posts for comparison
  if (Math.random() > 0.30) {
    return null
  }

  const experimentNames = experiments.map(e => e.name)

  if (learningEngine) {
    try {
      const selectedName = learningEngine.weightedSelect(experimentNames, 'experiments')
      return experiments.find(e => e.name === selectedName) || experiments[0]
    } catch (err) {
      // Experiments category may not exist in learnings yet, fall back to random
      return experiments[Math.floor(Math.random() * experiments.length)]
    }
  }

  return experiments[Math.floor(Math.random() * experiments.length)]
}

/**
 * Get all experiment names for a language (useful for learning engine initialization)
 * @param {string} language - Language code
 * @returns {string[]} Array of experiment names
 */
export function getExperimentNames(language = 'en') {
  const experiments = LANGUAGE_EXPERIMENTS[language] || LANGUAGE_EXPERIMENTS['en']
  return experiments.map(e => e.name)
}

/**
 * Get all experiments (useful for documentation/debugging)
 */
export function getAllExperiments() {
  return LANGUAGE_EXPERIMENTS
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

  // Select EXPERIMENT (optional - may return null)
  const selectedExperiment = selectLanguageExperiment(language)

  // Log selection info
  let logMsg = `      [style: ${selectedStyle.name} + hook: ${selectedHook.name}`
  if (selectedExperiment) {
    logMsg += ` + experiment: ${selectedExperiment.name}`
  }
  logMsg += ']'
  console.log(logMsg)

  // Build experiment instructions if applicable
  let experimentInstructions = ''
  let maxCharsOverride = null

  if (selectedExperiment) {
    const expExamples = selectedExperiment.examples
      ? `\nEXPERIMENT EXAMPLES: ${selectedExperiment.examples.join(' | ')}`
      : ''

    experimentInstructions = language === 'en'
      ? `\n\n=== LANGUAGE EXPERIMENT: ${selectedExperiment.name.toUpperCase()} ===
${selectedExperiment.instruction}${expExamples}
IMPORTANT: This experiment takes PRIORITY over normal length guidelines.`
      : `\n\n=== EXPERIMENTO DE LINGUAGEM: ${selectedExperiment.name.toUpperCase()} ===
${selectedExperiment.instruction}${expExamples}
IMPORTANTE: Este experimento tem PRIORIDADE sobre as guidelines de tamanho normal.`

    maxCharsOverride = selectedExperiment.maxChars
  }

  // Determine character limits
  const charLimit = maxCharsOverride || (language === 'en' ? '120-250' : '120-250')
  const charInstruction = typeof charLimit === 'number'
    ? `- MAXIMUM ${charLimit} chars (experiment constraint)`
    : `- ${charLimit} chars`

  const userPrompt = language === 'en'
    ? `TOPIC: ${topic}

DATA:
${newsContext}

ANGLE: ${angle}

=== YOUR ASSIGNMENT ===
TONE/STYLE: ${selectedStyle.instruction}
HOOK FRAMEWORK: ${selectedHook.instruction}
HOOK EXAMPLES: ${selectedHook.examples.join(' | ')}${experimentInstructions}

Write ONE post combining this TONE with this HOOK structure.

CRITICAL:
- Use the hook framework to structure your opening
- Apply the tone throughout
- Sound like texting a friend, not writing an essay
- ONE point only
- NEVER use banned words
- 0-2 hashtags
${charInstruction}

Just the post text.`
    : `TOPICO: ${topic}

DADOS:
${newsContext}

ANGULO: ${angle}

=== SUA TAREFA ===
TOM/ESTILO: ${selectedStyle.instruction}
FRAMEWORK DE HOOK: ${selectedHook.instruction}
EXEMPLOS DE HOOK: ${selectedHook.examples.join(' | ')}${experimentInstructions}

Escreva UM post combinando esse TOM com essa estrutura de HOOK.

CRITICO:
- Use o framework de hook pra estruturar a abertura
- Aplique o tom ao longo do post
- Som de mensagem pra amigo, nao redacao
- UM ponto so
- NUNCA use palavras proibidas
- 0-2 hashtags
${charInstruction}

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

  // Additional validation for experiment char limits
  if (selectedExperiment && selectedExperiment.maxChars && post.length > selectedExperiment.maxChars + 20 && retries > 0) {
    console.log(`   Post excede limite do experimento (${post.length} > ${selectedExperiment.maxChars}), regenerando...`)
    return generatePost(topic, newsContext, angle, language, retries - 1)
  }

  // Return object with post text and metadata for learning engine
  return {
    text: post,
    _metadata: {
      hook: selectedHook.name,
      style: selectedStyle.name,
      experiment: selectedExperiment ? selectedExperiment.name : null,
      experimentMaxChars: selectedExperiment ? selectedExperiment.maxChars : null,
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
          style: metadata.style,
          experiment: metadata.experiment || null
        })
      } catch (err) {
        console.log(`   Erro em ${topic} (${language}): ${err.message}`)
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
      style: metadata.style,
      experiment: metadata.experiment || null
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
    topExperiments: learnings.weights.experiments
      ? Object.entries(learnings.weights.experiments)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([name, weight]) => ({ name, weight }))
      : [],
    lastUpdated: learnings.lastUpdated
  }
}

// ==================== THREAD GENERATION ====================

/**
 * Thread frameworks - structures that work for multi-tweet stories
 */
const THREAD_FRAMEWORKS = {
  'en': [
    {
      name: 'story',
      instruction: 'Tell a story with a clear arc: setup, tension, resolution. Each tweet should make them want the next.',
      structure: ['Hook/Setup (grab attention)', 'Context/Problem', 'Key insight/Turning point', 'Lesson/Takeaway', 'CTA/Question']
    },
    {
      name: 'listicle',
      instruction: 'Numbered list of insights. Each point should stand alone but build on the theme.',
      structure: ['Hook: "X things I learned about Y"', 'Point 1 (most surprising)', 'Point 2', 'Point 3', 'Point 4 + CTA']
    },
    {
      name: 'breakdown',
      instruction: 'Break down a complex topic into digestible pieces. Educational but not boring.',
      structure: ['Hook: Why this matters NOW', 'The basics (quick)', 'The insight most miss', 'How to apply it', 'Summary + resources']
    },
    {
      name: 'contrarian',
      instruction: 'Challenge conventional wisdom. Start controversial, back it up, land the point.',
      structure: ['Controversial take', 'Why most people believe the opposite', 'Evidence/experience', 'The real truth', 'What to do about it']
    }
  ],
  'pt-BR': [
    {
      name: 'story',
      instruction: 'Conta uma história com arco claro: setup, tensão, resolução. Cada tweet faz querer o próximo.',
      structure: ['Gancho/Setup (prende atenção)', 'Contexto/Problema', 'Insight chave/Ponto de virada', 'Lição/Conclusão', 'CTA/Pergunta']
    },
    {
      name: 'listicle',
      instruction: 'Lista numerada de insights. Cada ponto funciona sozinho mas constrói o tema.',
      structure: ['Gancho: "X coisas que aprendi sobre Y"', 'Ponto 1 (mais surpreendente)', 'Ponto 2', 'Ponto 3', 'Ponto 4 + CTA']
    },
    {
      name: 'breakdown',
      instruction: 'Quebra um tema complexo em pedaços digeríveis. Educativo mas não chato.',
      structure: ['Gancho: Por que isso importa AGORA', 'O básico (rápido)', 'O insight que maioria perde', 'Como aplicar', 'Resumo + recursos']
    },
    {
      name: 'contrarian',
      instruction: 'Desafia a sabedoria convencional. Começa controverso, embasa, fecha o ponto.',
      structure: ['Take controverso', 'Por que maioria acredita o oposto', 'Evidência/experiência', 'A verdade real', 'O que fazer sobre isso']
    }
  ]
}

/**
 * Generate a thread (multiple connected tweets)
 * @param {string} topic - Topic (crypto, investing, ai, vibeCoding)
 * @param {string} newsContext - Formatted data context
 * @param {string} language - Language code (en or pt-BR)
 * @param {number} tweetCount - Number of tweets in thread (4-6 recommended)
 * @returns {Promise<Object>} Generated thread with metadata
 */
export async function generateThread(topic, newsContext, language = 'pt-BR', tweetCount = 5) {
  // Build system prompt based on language and topic
  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT_BR
  const topicContext = TOPIC_CONTEXT[topic]?.[language] || ''

  // Thread-specific system additions
  const threadSystemAddition = language === 'en'
    ? `\n\n=== THREAD RULES ===
- You're writing a THREAD (multiple connected tweets)
- Each tweet MAX 250 chars (shorter is better)
- First tweet is the HOOK - must stop the scroll
- Each tweet should make them want the next
- Use "🧵" in first tweet to signal thread
- Number tweets: 1/, 2/, 3/, etc.
- Last tweet should have CTA or question
- NO hashtags except in last tweet
- Thread should tell a STORY or provide VALUE`
    : `\n\n=== REGRAS DE THREAD ===
- Você está escrevendo uma THREAD (múltiplos tweets conectados)
- Cada tweet MAX 250 chars (menor é melhor)
- Primeiro tweet é o GANCHO - tem que parar o scroll
- Cada tweet deve fazer querer o próximo
- Use "🧵" no primeiro tweet pra sinalizar thread
- Numere os tweets: 1/, 2/, 3/, etc.
- Último tweet deve ter CTA ou pergunta
- SEM hashtags exceto no último tweet
- Thread deve contar uma HISTÓRIA ou entregar VALOR`

  const fullSystemPrompt = basePrompt + topicContext + threadSystemAddition

  // Select framework
  const frameworks = THREAD_FRAMEWORKS[language] || THREAD_FRAMEWORKS['en']
  const selectedFramework = frameworks[Math.floor(Math.random() * frameworks.length)]

  console.log(`      [thread framework: ${selectedFramework.name}]`)

  const userPrompt = language === 'en'
    ? `TOPIC: ${topic}

DATA:
${newsContext}

=== YOUR ASSIGNMENT ===
Write a ${tweetCount}-tweet THREAD using this framework:
FRAMEWORK: ${selectedFramework.name}
INSTRUCTION: ${selectedFramework.instruction}
STRUCTURE: ${selectedFramework.structure.join(' → ')}

CRITICAL:
- First tweet MUST have 🧵 emoji
- Number each tweet (1/, 2/, etc.)
- Each tweet MAX 250 chars
- Make it a STORY, not just facts
- Sound human, not AI
- Last tweet: hashtags + CTA

Output format (one tweet per line, separated by ---):
1/ First tweet here 🧵

---

2/ Second tweet here

---

3/ Third tweet here

---

etc.`
    : `TÓPICO: ${topic}

DADOS:
${newsContext}

=== SUA TAREFA ===
Escreva uma THREAD de ${tweetCount} tweets usando este framework:
FRAMEWORK: ${selectedFramework.name}
INSTRUÇÃO: ${selectedFramework.instruction}
ESTRUTURA: ${selectedFramework.structure.join(' → ')}

CRÍTICO:
- Primeiro tweet TEM QUE ter emoji 🧵
- Numere cada tweet (1/, 2/, etc.)
- Cada tweet MAX 250 chars
- Faça ser uma HISTÓRIA, não só fatos
- Som humano, não IA
- Último tweet: hashtags + CTA

Formato de saída (um tweet por linha, separados por ---):
1/ Primeiro tweet aqui 🧵

---

2/ Segundo tweet aqui

---

3/ Terceiro tweet aqui

---

etc.`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1500,
    system: fullSystemPrompt,
    messages: [{
      role: 'user',
      content: userPrompt
    }]
  })

  const rawOutput = message.content[0].text.trim()

  // Parse the thread into individual tweets
  const tweets = rawOutput
    .split('---')
    .map(t => t.trim())
    .filter(t => t.length > 0 && t.length <= 280)

  // Validate we got enough tweets
  if (tweets.length < 3) {
    console.log(`   ⚠️ Thread muito curta (${tweets.length} tweets), regenerando...`)
    return generateThread(topic, newsContext, language, tweetCount)
  }

  return {
    tweets,
    _metadata: {
      framework: selectedFramework.name,
      topic,
      language,
      tweetCount: tweets.length,
      totalChars: tweets.reduce((sum, t) => sum + t.length, 0),
      generatedAt: new Date().toISOString()
    }
  }
}

/**
 * Generate a thread for the best performing topic
 * Analyzes curated content and picks the most engaging topic
 * @param {Object} curated - Curated data from curateContentV3
 * @param {string} language - Language code
 * @returns {Promise<Object>} Generated thread with topic info
 */
export async function generateBestThread(curated, language = 'en') {
  // Pick topic with most interesting data
  const topics = Object.keys(curated).filter(t => curated[t])

  // Score topics by data richness (narrative strength, data freshness)
  let bestTopic = topics[0]
  let bestScore = 0

  for (const topic of topics) {
    const data = curated[topic]
    let score = 0

    // Has narrative = +3
    if (data.narrative) score += 3

    // Strong sentiment = +2
    if (data.sentiment === 'bullish' || data.sentiment === 'bearish') score += 2

    // Has suggested angles = +1 per angle
    if (data.suggestedAngles) score += data.suggestedAngles.length

    // Has real data (not fallback) = +2
    if (data.sources && data.sources.length > 0) score += 2

    if (score > bestScore) {
      bestScore = score
      bestTopic = topic
    }
  }

  console.log(`   📊 Best topic for thread: ${bestTopic} (score: ${bestScore})`)

  // Format context for thread generation
  const { formatForPrompt } = await import('./curate-v3.js')
  const context = formatForPrompt(curated, bestTopic, language)

  const thread = await generateThread(bestTopic, context, language, 5)

  return {
    ...thread,
    topic: bestTopic
  }
}

export default {
  generatePost,
  generateAllPosts,
  generateMultiplePosts,
  generateThread,
  generateBestThread,
  getLearningStats,
  getExperimentNames,
  getAllExperiments
}
