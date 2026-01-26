/**
 * AI Auto-Response Module for PocketPing Community Edition
 * Supports OpenAI, Anthropic, and Google Gemini
 */

export interface Message {
  content: string
  sender: 'visitor' | 'operator' | 'ai'
}

export interface AIProviderConfig {
  apiKey: string
  model?: string
  systemPrompt?: string
}

export const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5-20250929',
  google: 'gemini-2.5-flash',
} as const

// ─────────────────────────────────────────────────────────────────
// OpenAI Provider
// ─────────────────────────────────────────────────────────────────

async function generateOpenAI(messages: Message[], config: AIProviderConfig): Promise<string> {
  const model = config.model || DEFAULT_MODELS.openai

  const openaiMessages: Array<{ role: string; content: string }> = []

  if (config.systemPrompt) {
    openaiMessages.push({ role: 'system', content: config.systemPrompt })
  }

  for (const msg of messages) {
    const role = msg.sender === 'visitor' ? 'user' : 'assistant'
    const lastMsg = openaiMessages[openaiMessages.length - 1]

    if (lastMsg && lastMsg.role !== 'system' && lastMsg.role === role) {
      lastMsg.content += '\n' + msg.content
    } else {
      openaiMessages.push({ role, content: msg.content })
    }
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: 1000,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}

// ─────────────────────────────────────────────────────────────────
// Anthropic Provider
// ─────────────────────────────────────────────────────────────────

async function generateAnthropic(messages: Message[], config: AIProviderConfig): Promise<string> {
  const model = config.model || DEFAULT_MODELS.anthropic

  const anthropicMessages: Array<{ role: string; content: string }> = []

  for (const msg of messages) {
    const role = msg.sender === 'visitor' ? 'user' : 'assistant'
    const lastMsg = anthropicMessages[anthropicMessages.length - 1]

    if (lastMsg && lastMsg.role === role) {
      lastMsg.content += '\n' + msg.content
    } else {
      anthropicMessages.push({ role, content: msg.content })
    }
  }

  if (anthropicMessages.length > 0 && anthropicMessages[0].role === 'assistant') {
    anthropicMessages.shift()
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: config.systemPrompt || 'You are a helpful customer support assistant.',
      messages: anthropicMessages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as { content?: Array<{ text?: string }> }
  return data.content?.[0]?.text ?? ''
}

// ─────────────────────────────────────────────────────────────────
// Google Gemini Provider
// ─────────────────────────────────────────────────────────────────

async function generateGemini(messages: Message[], config: AIProviderConfig): Promise<string> {
  const model = config.model || DEFAULT_MODELS.google

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  for (const msg of messages) {
    const role = msg.sender === 'visitor' ? 'user' : 'model'
    const lastContent = contents[contents.length - 1]

    if (lastContent && lastContent.role === role) {
      lastContent.parts[0].text += '\n' + msg.content
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content }],
      })
    }
  }

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.shift()
  }

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: 1000,
      temperature: 0.7,
    },
  }

  if (config.systemPrompt) {
    requestBody.systemInstruction = {
      parts: [{ text: config.systemPrompt }],
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ─────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'google'

export async function generateAIResponse(
  provider: AIProvider,
  messages: Message[],
  config: AIProviderConfig
): Promise<string> {
  switch (provider) {
    case 'openai':
      return generateOpenAI(messages, config)
    case 'anthropic':
      return generateAnthropic(messages, config)
    case 'google':
      return generateGemini(messages, config)
    default:
      throw new Error(`Unknown AI provider: ${provider}`)
  }
}
