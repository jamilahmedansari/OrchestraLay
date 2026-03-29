// orchestrateTask.ts — pg-boss consumer, full task lifecycle
// teamSize: 5, teamConcurrency: 3

import { getQueue } from '../lib/queue.js'
import { db } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { tasks, modelResults } from '../db/schema.js'
import { resolveModel, resolveFailover } from '../lib/modelRouter.js'
import { callModel } from '../lib/modelCallers.js'
import { estimateTokens } from '../lib/tokenizer.js'
import { getModel, estimateCostCents } from '../lib/modelRegistry.js'
import { recordSuccess, recordFailure } from '../lib/modelHealth.js'
import { incrementConcurrency, decrementConcurrency } from '../lib/concurrencyTracker.js'
import { incrementSpend } from '../lib/budgetGuard.js'
import { parseFileChanges, hasFileChanges } from '../lib/outputParser.js'
import { processDiffs } from '../lib/diffEngine.js'
import { broadcastTaskUpdate } from '../lib/realtime.js'
import { emitTaskEvent } from '../lib/eventEmitter.js'
import { writeAuditLog } from '../lib/audit.js'
import type { TaskType } from '../lib/modelRegistry.js'

export const ORCHESTRATE_TASK_JOB = 'orchestrate-task'

export type OrchestrateTaskPayload = {
  taskId: string
  teamId: string
  projectId: string
  prompt: string
  taskType: TaskType
  preferredModel?: string | undefined
  budgetCapCents?: number | undefined
  actorId?: string | undefined
}

const SYSTEM_PROMPT = `You are an expert software engineer helping developers write, debug, and refactor code.

When making file changes, wrap them in XML like this:
<file_changes>
  <file_change path="src/example.ts" operation="modify">
    // your full file content here
  </file_change>
</file_changes>

Operations: create | modify | delete
Always include the full file content, not just the changed lines.
If no file changes are needed (e.g. analysis or review), respond in plain text.`

let workerStarted = false

async function updateTaskStatus(
  taskId: string,
  status: string,
  extra?: Partial<typeof tasks.$inferInsert>,
): Promise<void> {
  await db
    .update(tasks)
    .set({ status: status as typeof tasks.$inferInsert['status'], updatedAt: new Date(), ...extra })
    .where(eq(tasks.id, taskId))
}

async function executeWithModel(
  job: OrchestrateTaskPayload,
  modelId: string,
  attempt: number,
): Promise<{ content: string; inputTokens: number; outputTokens: number; costCents: number; durationMs: number; modelResultId: string }> {
  const modelSpec = getModel(modelId as Parameters<typeof getModel>[0])

  incrementConcurrency(modelSpec.id)
  const start = Date.now()

  try {
    const result = await callModel({
      modelId: modelSpec.id,
      provider: modelSpec.provider,
      prompt: job.prompt,
      systemPrompt: SYSTEM_PROMPT,
    })

    const costCents = estimateCostCents(modelSpec, result.inputTokens, result.outputTokens)
    recordSuccess(modelSpec.id)

    // Persist model result
    const [modelResult] = await db.insert(modelResults).values({
      taskId: job.taskId,
      modelId: modelSpec.id,
      attempt,
      status: 'success',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents,
      durationMs: result.durationMs,
      rawResponse: result.content,
    }).returning()

    return { ...result, costCents, modelResultId: modelResult!.id }
  } catch (err) {
    recordFailure(modelSpec.id)

    await db.insert(modelResults).values({
      taskId: job.taskId,
      modelId: modelSpec.id,
      attempt,
      status: 'failed',
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      durationMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    })

    throw err
  } finally {
    decrementConcurrency(modelSpec.id)
  }
}

export async function startOrchestrationWorker(): Promise<void> {
  if (workerStarted) return
  workerStarted = true

  const queue = await getQueue()
  await queue.createQueue(ORCHESTRATE_TASK_JOB).catch(() => {})

  await queue.work<OrchestrateTaskPayload>(
    ORCHESTRATE_TASK_JOB,
    async (jobs) => {
      const job = Array.isArray(jobs) ? jobs[0] : jobs
      if (!job) return

      const payload = job.data
      const { taskId, teamId, projectId, prompt, taskType, preferredModel, actorId } = payload

      console.log(`[worker] starting task ${taskId} (${taskType})`)

      try {
        // --- ROUTING ---
        await updateTaskStatus(taskId, 'routing')
        await broadcastTaskUpdate({ taskId, status: 'routing' })

        const estimatedTokens = estimateTokens(prompt)
        const routingInput: Parameters<typeof resolveModel>[0] = preferredModel
          ? {
              taskType,
              teamId,
              estimatedInputTokens: estimatedTokens,
              preferredModel: preferredModel as Parameters<typeof resolveModel>[0]['preferredModel'],
            }
          : {
              taskType,
              teamId,
              estimatedInputTokens: estimatedTokens,
            }
        const routingResult = await resolveModel(routingInput)

        const selectedModel = routingResult.model

        await updateTaskStatus(taskId, 'routing', {
          modelId: selectedModel.id,
          metadata: { routingReasoning: routingResult.reasoning } as Record<string, unknown>,
        })

        await writeAuditLog({
          teamId,
          ...(actorId ? { actorId } : {}),
          action: 'task.routing',
          resourceType: 'task',
          resourceId: taskId,
          metadata: { modelId: selectedModel.id, reasoning: routingResult.reasoning },
        })

        // --- EXECUTION ---
        await updateTaskStatus(taskId, 'executing')
        await broadcastTaskUpdate({ taskId, status: 'executing', modelId: selectedModel.id })
        await emitTaskEvent({ taskId, status: 'executing', teamId, projectId, modelId: selectedModel.id })

        let execResult: Awaited<ReturnType<typeof executeWithModel>>
        let usedModelId = selectedModel.id

        try {
          execResult = await executeWithModel(payload, selectedModel.id, 1)
        } catch (primaryErr) {
          console.warn(`[worker] ${selectedModel.id} failed, attempting failover`)

          const failover = await resolveFailover(selectedModel.id, {
            taskType,
            teamId,
            estimatedInputTokens: estimatedTokens,
          })

          if (!failover) {
            throw new Error(`All models failed. Primary error: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`)
          }

          usedModelId = failover.model.id
          await broadcastTaskUpdate({ taskId, status: 'executing', modelId: usedModelId })
          execResult = await executeWithModel(payload, usedModelId, 2)
        }

        // --- COST TRACKING ---
        await incrementSpend(teamId, execResult.costCents)

        // --- DIFF PROCESSING ---
        const { content, costCents, inputTokens, outputTokens, modelResultId } = execResult

        if (hasFileChanges(content)) {
          const changes = parseFileChanges(content)
          if (changes.length > 0) {
            await processDiffs(taskId, projectId, modelResultId, changes)
          }
        }

        // --- COMPLETION ---
        await updateTaskStatus(taskId, 'completed', {
          modelId: usedModelId as typeof tasks.$inferInsert['modelId'],
          outputSummary: content.slice(0, 2000),
          totalCostCents: costCents,
          completedAt: new Date(),
        })

        await broadcastTaskUpdate({ taskId, status: 'completed', modelId: usedModelId, costCents })
        await emitTaskEvent({ taskId, status: 'completed', teamId, projectId, modelId: usedModelId, costCents })
        await writeAuditLog({
          teamId,
          ...(actorId ? { actorId } : {}),
          action: 'task.completed',
          resourceType: 'task',
          resourceId: taskId,
          metadata: { modelId: usedModelId, costCents, inputTokens, outputTokens },
        })

        console.log(`[worker] task ${taskId} completed — model: ${usedModelId}, cost: ${costCents}¢`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[worker] task ${taskId} failed:`, errorMessage)

        await updateTaskStatus(taskId, 'failed', { errorMessage })
        await broadcastTaskUpdate({ taskId, status: 'failed', error: errorMessage })
        await emitTaskEvent({ taskId, status: 'failed', teamId, projectId, error: errorMessage })
        await writeAuditLog({
          teamId,
          ...(actorId ? { actorId } : {}),
          action: 'task.failed',
          resourceType: 'task',
          resourceId: taskId,
          metadata: { error: errorMessage },
        })

        throw err // re-throw so pg-boss marks the job as failed
      }
    },
  )

  console.log('[worker] orchestration worker started')
}
