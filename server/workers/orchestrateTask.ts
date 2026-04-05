import { db } from '../db/index.js'
import { tasks, modelResults, costLogs } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { getQueue } from '../lib/queue.js'
import { estimateTokens } from '../lib/tokenizer.js'
import { resolveModel, resolveFailover } from '../lib/modelRouter.js'
import { callModel } from '../lib/modelCallers.js'
import { MODEL_REGISTRY, type ModelId, type TaskType } from '../lib/modelRegistry.js'
import { recordSuccess, recordFailure } from '../lib/modelHealth.js'
import { runDiffEngine } from '../lib/diffEngine.js'
import { broadcastTaskUpdate } from '../lib/realtime.js'
import { emitEvent } from '../lib/eventEmitter.js'
import { writeAuditLog } from '../lib/audit.js'

const QUEUE_NAME = 'orchestrate-task'
const WORKER_BATCH_SIZE = 5
const WORKER_CONCURRENCY = 3
let workerStarted = false
let workerIds: string[] = []

interface TaskPayload {
  taskId: string
}

function billingPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function handleTask(job: { data: TaskPayload }): Promise<void> {
  const { taskId } = job.data

  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const projectId = task.projectId
    const teamId = task.teamId
    const prompt = task.prompt
    const taskType = task.taskType as TaskType
    const preferredModels = task.preferredModels ?? undefined
    const budgetCents = task.budgetCents ?? undefined
    const timeoutSeconds = task.timeoutSeconds ?? 120

    // ── Status: routing ──────────────────────────────────────
    await db.update(tasks).set({ status: 'routing', updatedAt: new Date() }).where(eq(tasks.id, taskId))
    broadcastTaskUpdate(taskId, { status: 'routing' })

    // ── Estimate tokens (Bug 2 fix: must call before resolveModel) ──
    const promptTokens = estimateTokens(prompt)

    // ── Route to best model ──────────────────────────────────
    const decision = await resolveModel({
      taskType,
      promptTokens,
      budgetCents,
      preferredModels,
    })

    await db.update(tasks).set({
      status: 'executing',
      selectedModel: decision.selectedModel,
      estimatedCostCents: decision.estimatedCostCents,
      metadata: {
        reasoning: decision.reasoning,
        fallbackChain: decision.fallbackChain,
        baselineModel: decision.baselineModel,
        baselineCostCents: decision.baselineCostCents,
        directSavingsCents: decision.baselineCostCents - decision.estimatedCostCents,
      },
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId))

    broadcastTaskUpdate(taskId, {
      status: 'executing',
      selectedModel: decision.selectedModel,
    })

    // ── Retry loop with failover ─────────────────────────────
    let currentModel: ModelId | null = decision.selectedModel
    let result = null

    while (currentModel) {
      const spec = MODEL_REGISTRY[currentModel]
      const timeout = Math.min(timeoutSeconds, spec.timeoutSeconds)

      result = await callModel(currentModel, prompt, timeout)

      if (result.success) {
        recordSuccess(currentModel, result.latencyMs)

        // Insert successful model result
        const [modelResult] = await db.insert(modelResults).values({
          taskId,
          modelName: currentModel,
          provider: spec.provider,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costCents: result.costCents,
          latencyMs: result.latencyMs,
          content: result.content,
          success: true,
        }).returning()

        // Insert cost log
        await db.insert(costLogs).values({
          teamId,
          projectId,
          taskId,
          modelName: currentModel,
          provider: spec.provider,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costCents: result.costCents,
          billingPeriod: billingPeriod(),
        })

        // Atomic team spend update — the one allowed raw SQL
        await db.execute(
          sql`UPDATE teams SET current_month_spend_cents = current_month_spend_cents + ${result.costCents} WHERE id = ${teamId}`
        )

        // Run diff engine
        const diffSummary = await runDiffEngine(
          taskId,
          modelResult.id,
          result.content,
          projectId,
          teamId
        )

        const directSavingsCents = decision.baselineCostCents - result.costCents

        // Mark task completed
        await db.update(tasks).set({
          status: 'completed',
          actualCostCents: result.costCents,
          metadata: {
            reasoning: decision.reasoning,
            fallbackChain: decision.fallbackChain,
            baselineModel: decision.baselineModel,
            baselineCostCents: decision.baselineCostCents,
            directSavingsCents,
            diffSummary,
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(tasks.id, taskId))

        broadcastTaskUpdate(taskId, {
          status: 'completed',
          costCents: result.costCents,
          baselineCostCents: decision.baselineCostCents,
          directSavingsCents,
          ...diffSummary,
        })

        emitEvent('task.completed', {
          taskId,
          teamId,
          projectId,
          model: currentModel,
          costCents: result.costCents,
          diffCount: diffSummary.diffCount,
        })

        writeAuditLog({
          teamId,
          action: 'task.completed',
          resource: 'task',
          resourceId: taskId,
          metadata: { model: currentModel, costCents: result.costCents },
        })

        return // success — exit
      }

      // Failure path
      recordFailure(currentModel)

      // Insert failed model result
      await db.insert(modelResults).values({
        taskId,
        modelName: currentModel,
        provider: spec.provider,
        promptTokens: 0,
        completionTokens: 0,
        costCents: 0,
        latencyMs: result.latencyMs,
        success: false,
        errorMessage: result.errorMessage,
      })

      broadcastTaskUpdate(taskId, {
        event: 'model_failed',
        failedModel: currentModel,
        error: result.errorMessage,
        message: 'Trying next model...',
      })

      // Try failover
      currentModel = resolveFailover(
        currentModel,
        decision.fallbackChain,
        taskType,
        promptTokens,
        budgetCents
      )

      if (currentModel) {
        broadcastTaskUpdate(taskId, {
          event: 'failover',
          nextModel: currentModel,
        })
      }
    }

    // All models exhausted
    await db.update(tasks).set({
      status: 'failed',
      metadata: {
        reasoning: decision.reasoning,
        fallbackChain: decision.fallbackChain,
        baselineModel: decision.baselineModel,
        baselineCostCents: decision.baselineCostCents,
        error: result?.errorMessage ?? 'All models failed',
      },
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId))

    broadcastTaskUpdate(taskId, {
      status: 'failed',
      error: 'All models exhausted',
    })

    emitEvent('task.failed', {
      taskId,
      teamId,
      projectId,
      error: 'All models exhausted',
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error(`Task ${taskId} failed:`, errorMessage)

    const [existingTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).catch(() => [])
    await db.update(tasks).set({
      status: 'failed',
      metadata: {
        reasoning: existingTask?.metadata?.reasoning,
        fallbackChain: existingTask?.metadata?.fallbackChain,
        baselineModel: existingTask?.metadata?.baselineModel,
        baselineCostCents: existingTask?.metadata?.baselineCostCents,
        error: errorMessage,
      },
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId)).catch(() => {})

    const teamId = existingTask?.teamId
    const projectId = existingTask?.projectId

    broadcastTaskUpdate(taskId, { status: 'failed', error: errorMessage })

    emitEvent('task.failed', { taskId, teamId, projectId, error: errorMessage })
  }
}

/** Start the pg-boss consumer. Call after getQueue(). Bug 3 fix. */
export async function startOrchestrationWorker(): Promise<void> {
  if (workerStarted) {
    return
  }

  const queue = await getQueue()
  await queue.createQueue(QUEUE_NAME).catch(() => {})
  workerIds = await Promise.all(
    Array.from({ length: WORKER_CONCURRENCY }, () =>
      queue.work(
        QUEUE_NAME,
        { batchSize: WORKER_BATCH_SIZE, pollingIntervalSeconds: 1 },
        async (jobs) => {
          await Promise.all(jobs.map((queuedJob) => handleTask({ data: queuedJob.data as TaskPayload })))
        },
      ),
    ),
  )
  workerStarted = true
}

export { QUEUE_NAME }
