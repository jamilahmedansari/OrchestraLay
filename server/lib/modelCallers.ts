import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ModelId, Provider } from './modelRegistry.js'
import { MODEL_REGISTRY } from './modelRegistry.js'

export interface ModelCallInput {
  model: ModelId
  prompt: string
  taskType: string
  abortSignal: AbortSignal
}

export interface ModelCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  costCents: number
  latencyMs: number
  provider: Provider
  modelName: ModelId
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
})

function calculateCostCents(
  model: ModelId,
  promptTokens: number,
  completionTokens: number
): number {
  const spec = MODEL_REGISTRY[model]
  const inputCost = (promptTokens / 1_000_000) * spec.inputCostCentsPer1M
  const outputCost = (completionTokens / 1_000_000) * spec.outputCostCentsPer1M
  return Math.ceil(inputCost + outputCost)
}

async function callAnthropic(input: ModelCallInput): Promise<ModelCallResult> {
  const modelMap: Record<string, string> = {
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-haiku': 'claude-3-haiku-20240307',
  }

  const start = Date.now()
  const response = await anthropic.messages.create(
    {
      model: modelMap[input.model] ?? input.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: input.prompt }],
    },
    { signal: input.abortSignal }
  )
  const latencyMs = Date.now() - start

  const content = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const promptTokens = response.usage.input_tokens
  const completionTokens = response.usage.output_tokens

  return {
    content,
    promptTokens,
    completionTokens,
    costCents: calculateCostCents(input.model, promptTokens, completionTokens),
    latencyMs,
    provider: 'anthropic',
    modelName: input.model,
  }
}

async function callOpenAI(input: ModelCallInput): Promise<ModelCallResult> {
  const start = Date.now()
  const response = await openai.chat.completions.create(
    {
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: 4096,
    },
    { signal: input.abortSignal }
  )
  const latencyMs = Date.now() - start

  const content = response.choices[0]?.message?.content ?? ''
  const promptTokens = response.usage?.prompt_tokens ?? 0
  const completionTokens = response.usage?.completion_tokens ?? 0

  return {
    content,
    promptTokens,
    completionTokens,
    costCents: calculateCostCents(input.model, promptTokens, completionTokens),
    latencyMs,
    provider: 'openai',
    modelName: input.model,
  }
}

async function callPerplexity(input: ModelCallInput): Promise<ModelCallResult> {
  const start = Date.now()
  const response = await perplexity.chat.completions.create(
    {
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: 4096,
    },
    { signal: input.abortSignal }
  )
  const latencyMs = Date.now() - start

  const content = response.choices[0]?.message?.content ?? ''
  const promptTokens = response.usage?.prompt_tokens ?? 0
  const completionTokens = response.usage?.completion_tokens ?? 0

  return {
    content,
    promptTokens,
    completionTokens,
    costCents: calculateCostCents(input.model, promptTokens, completionTokens),
    latencyMs,
    provider: 'perplexity',
    modelName: input.model,
  }
}

const PROVIDER_CALLERS: Record<Provider, (input: ModelCallInput) => Promise<ModelCallResult>> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  perplexity: callPerplexity,
}

export async function callModel(input: ModelCallInput): Promise<ModelCallResult> {
  const spec = MODEL_REGISTRY[input.model]
  const caller = PROVIDER_CALLERS[spec.provider]
  return caller(input)
}
