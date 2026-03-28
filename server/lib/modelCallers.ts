import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { type ModelId, type TaskType, MODEL_REGISTRY, calculateActualCost } from './modelRegistry.js'

export interface ModelCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  costCents: number
  latencyMs: number
  success: boolean
  errorMessage?: string
}

// ─── Provider clients (lazy init) ────────────────────────────────────

let anthropicClient: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

let openaiClient: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

let perplexityClient: OpenAI | null = null
function getPerplexity(): OpenAI {
  if (!perplexityClient) {
    perplexityClient = new OpenAI({
      apiKey: process.env.PERPLEXITY_API_KEY,
      baseURL: 'https://api.perplexity.ai',
    })
  }
  return perplexityClient
}

// ─── Provider-specific callers ───────────────────────────────────────

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

async function callAnthropic(
  modelId: ModelId,
  prompt: string,
  signal: AbortSignal
): Promise<ModelCallResult> {
  const start = Date.now()
  const apiModel = modelId === 'claude-3-5-sonnet' ? 'claude-sonnet-4-20250514' : 'claude-3-5-haiku-20241022'

  try {
    const response = await getAnthropic().messages.create(
      {
        model: apiModel,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal }
    )

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const promptTokens = response.usage.input_tokens
    const completionTokens = response.usage.output_tokens
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
    const response = await getOpenAI().chat.completions.create(
      {
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      },
      { signal }
    )

    const content = response.choices[0]?.message?.content ?? ''
    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
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
    const response = await getPerplexity().chat.completions.create(
      {
        model: apiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      },
      { signal }
    )

    const content = response.choices[0]?.message?.content ?? ''
    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
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
