import { type ModelId, MODEL_REGISTRY, calculateActualCost } from './modelRegistry.js'

export interface ModelCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  costCents: number
  latencyMs: number
  success: boolean
  errorMessage?: string
}

const SYSTEM_PROMPT = `You are an AI coding assistant. When making code changes, wrap them in <file_changes> XML tags with the following format:
<file_changes>
<file path="path/to/file" operation="create|modify|delete">
<before_content>
<!-- For modify: the original file content. Omit for create/delete. -->
</before_content>
<after_content>
<!-- For create/modify: the new file content. Omit for delete. -->
</after_content>
</file>
</file_changes>

Always provide complete file contents, not partial snippets.`

function requireApiKey(name: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'PERPLEXITY_API_KEY'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}

async function parseJson(response: Response): Promise<any> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Model API error ${response.status}: ${text}`)
  }

  return JSON.parse(text)
}

async function callAnthropic(
  modelId: ModelId,
  prompt: string,
  signal: AbortSignal
): Promise<ModelCallResult> {
  const start = Date.now()
  const apiModel = modelId === 'claude-3-5-sonnet' ? 'claude-3-5-sonnet-20241022' : 'claude-3-5-haiku-20241022'

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': requireApiKey('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    const json = await parseJson(response)
    const content = (json.content ?? [])
      .filter((block: { type?: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '')
      .join('')
    const promptTokens = json.usage?.input_tokens ?? 0
    const completionTokens = json.usage?.output_tokens ?? 0
    const costCents = calculateActualCost(modelId, promptTokens, completionTokens)

    return {
      content,
      promptTokens,
      completionTokens,
      costCents,
      latencyMs: Date.now() - start,
      success: true,
    }
  } catch (err) {
    return {
      content: '',
      promptTokens: 0,
      completionTokens: 0,
      costCents: 0,
      latencyMs: Date.now() - start,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function callOpenAI(
  modelId: ModelId,
  prompt: string,
  signal: AbortSignal
): Promise<ModelCallResult> {
  const start = Date.now()

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${requireApiKey('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      }),
      signal,
    })
    const json = await parseJson(response)
    const content = json.choices?.[0]?.message?.content ?? ''
    const promptTokens = json.usage?.prompt_tokens ?? 0
    const completionTokens = json.usage?.completion_tokens ?? 0
    const costCents = calculateActualCost(modelId, promptTokens, completionTokens)

    return {
      content,
      promptTokens,
      completionTokens,
      costCents,
      latencyMs: Date.now() - start,
      success: true,
    }
  } catch (err) {
    return {
      content: '',
      promptTokens: 0,
      completionTokens: 0,
      costCents: 0,
      latencyMs: Date.now() - start,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function callPerplexity(
  modelId: ModelId,
  prompt: string,
  signal: AbortSignal
): Promise<ModelCallResult> {
  const start = Date.now()
  const apiModel = modelId === 'perplexity-sonar-pro' ? 'sonar-pro' : 'sonar'

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${requireApiKey('PERPLEXITY_API_KEY')}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      }),
      signal,
    })
    const json = await parseJson(response)
    const content = json.choices?.[0]?.message?.content ?? ''
    const promptTokens = json.usage?.prompt_tokens ?? 0
    const completionTokens = json.usage?.completion_tokens ?? 0
    const costCents = calculateActualCost(modelId, promptTokens, completionTokens)

    return {
      content,
      promptTokens,
      completionTokens,
      costCents,
      latencyMs: Date.now() - start,
      success: true,
    }
  } catch (err) {
    return {
      content: '',
      promptTokens: 0,
      completionTokens: 0,
      costCents: 0,
      latencyMs: Date.now() - start,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Unified dispatcher ──────────────────────────────────────────────

export async function callModel(
  modelId: ModelId,
  prompt: string,
  timeoutSeconds: number
): Promise<ModelCallResult> {
  const signal = AbortSignal.timeout(timeoutSeconds * 1000)
  const spec = MODEL_REGISTRY[modelId]

  switch (spec.provider) {
    case 'anthropic':
      return callAnthropic(modelId, prompt, signal)
    case 'openai':
      return callOpenAI(modelId, prompt, signal)
    case 'perplexity':
      return callPerplexity(modelId, prompt, signal)
  }
}
