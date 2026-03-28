import { getQueue } from '../lib/queue.js'
import { db } from '../db/index.js'
import { tasks, modelResults, costLogs } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { estimateTokens } from '../lib/tokenizer.js'
import { resolveModel, resolveFailover } from '../lib/modelRouter.js'
import { callModel } from '../lib/modelCallers.js'
import { recordSuccess, recordFailure } from '../lib/modelHealth.js'
import { runDiffEngine } from '../lib/diffEngine.js'
import { broadcastTaskUpdate } from '../lib/realtime.js'
import { emitEvent } from '../lib/eventEmitter.js'
import { writeAuditLog } from '../lib/audit.js'
import type { TaskType, ModelId } from '../lib/modelRegistry.js'

interface TaskPayload {
  taskId: string
  projectId: string
  teamId: string
  prompt: string
  taskType: TaskType
  preferredModels?: string[]
  budgetCents?: number
  timeoutSeconds?: number
}

function getBillingPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function updateTaskStatus(
  taskId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await db
    .update(tasks)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(tasks.id, taskId))

  broadcastTaskUpdate(taskId, { status, ...extra }).catch(() => {})
}

async function handleTask(payload: TaskPayload): Promise<void> {
  const {
    taskId,
    projectId,
    teamId,
    prompt,
    taskType,
    preferredModels,
    budgetCents,
    timeoutSeconds = 120,
  } = payload

  try {
    // 1. Routing
    await updateTaskStatus(taskId, 'routing')

    const promptTokens = estimateTokens(prompt)
    const decision = await resolveModel({
      taskType,
      promptTokens,
      budgetCents,
      preferredModels,
    })

    await updateTaskStatus(taskId, 'executing', {
      selectedModel: decision.selectedModel,
      estimatedCostCents: decision.estimatedCostCents,
      metadata: { reasoning: decision.reasoning },
    })

    // 2. Model call with failover
    let currentModel: ModelId | null = decision.selectedModel
    let result = null

    while (currentModel) {
      try {
        result = await callModel({
          model: currentModel,
          prompt,
          taskType,
          abortSignal: AbortSignal.timeout(timeoutSeconds * 1000),
        })

        recordSuccess(currentModel, result.latencyMs)

        // Log successful result
        const [modelResult] = await db
          .insert(modelResults)
          .values({
            taskId,
            modelName: result.modelName,
            provider: result.provider,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costCents: result.costCents,
            latencyMs: result.latencyMs,
            content: result.content,
            success: true,
          })
          .returning()

        // Log cost
        await db.insert(costLogs).values({
          teamId,
          taskId,
          modelName: result.modelName,
          provider: result.provider,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costCents: result.costCents,
          billingPeriod: getBillingPeriod(),
        })

        // Atomic spend increment — raw SQL per CLAUDE.md
        await db.execute(
          sql`UPDATE teams SET current_month_spend_cents = current_month_spend_cents + ${result.costCents} WHERE id = ${teamId}`
        )

        // 3. Diff engine
        await runDiffEngine(taskId, modelResult.id, result.content, projectId)

        // 4. Complete
        await updateTaskStatus(taskId, 'completed', {
          actualCostCents: result.costCents,
          completedAt: new Date(),
        })

        emitEvent('task.completed', {
          taskId,
          teamId,
          projectId,
          modelName: result.modelName,
          costCents: result.costCents,
        })

        writeAuditLog({
          teamId,
          action: 'task.completed',
          resource: 'task',
          resourceId: taskId,
          metadata: { modelName: result.modelName, costCents: result.costCents },
        })

        return
      } catch (err) {
        recordFailure(currentModel)

        // Log failed attempt
        await db.insert(modelResults).values({
          taskId,
          modelName: currentModel,
          provider: result?.provider ?? 'unknown',
          promptTokens: 0,
          completionTokens: 0,
          costCents: 0,
          latencyMs: 0,
          success: false,
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })

        broadcastTaskUpdate(taskId, {
          event: 'model_failed',
          failedModel: currentModel,
          message: 'Trying next model...',
        }).catch(() => {})

        currentModel = resolveFailover(
          currentModel,
          decision.fallbackChain,
          taskType,
          promptTokens,
          budgetCents
        )
      }
    }

    // All models failed
    const errorMessage = 'All models failed or unavailable'
    await updateTaskStatus(taskId, 'failed', { errorMessage })
    emitEvent('task.failed', { taskId, teamId, projectId, errorMessage })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await updateTaskStatus(taskId, 'failed', { errorMessage }).catch(() => {})
    emitEvent('task.failed', { taskId, teamId, projectId, errorMessage })
  }
}

export async function startOrchestrationWorker(): Promise<void> {
  const queue = await getQueue()

  await queue.work(
    'orchestrate-task',
    { teamSize: 5, teamConcurrency: 3 },
    async (job) => {
      await handleTask(job.data as TaskPayload)
    }
  )
}
