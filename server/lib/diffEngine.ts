import { db } from '../db/index.js'
import { diffs, projects } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { parseModelOutput } from './outputParser.js'
import { computeDiff } from './diffComputer.js'
import { checkSafetyRules } from './safetyRules.js'
import { broadcastTaskUpdate } from './realtime.js'

export interface DiffEngineResult {
  totalDiffs: number
  flaggedCount: number
  blockedCount: number
}

export async function runDiffEngine(
  taskId: string,
  modelResultId: string,
  content: string,
  projectId: string
): Promise<DiffEngineResult> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  })

  const safetyRules = project?.safetyRules ?? {}
  const operations = parseModelOutput(content)

  let flaggedCount = 0
  let blockedCount = 0

  for (const op of operations) {
    const diffResult = computeDiff(op.beforeContent, op.afterContent, op.operation)
    const violations = checkSafetyRules(op, safetyRules)

    const hasWarnings = violations.some((v) => v.severity === 'warn')
    const hasBlocks = violations.some((v) => v.severity === 'block')

    if (hasWarnings || hasBlocks) flaggedCount++
    if (hasBlocks) blockedCount++

    await db.insert(diffs).values({
      taskId,
      modelResultId,
      filePath: op.filePath,
      operation: op.operation,
      beforeContent: op.beforeContent,
      afterContent: op.afterContent,
      hunks: diffResult.hunks,
      linesAdded: diffResult.linesAdded,
      linesRemoved: diffResult.linesRemoved,
      status: 'pending',
      flagged: hasWarnings || hasBlocks,
      blocked: hasBlocks,
      safetyViolations: violations,
    })
  }

  broadcastTaskUpdate(taskId, {
    event: 'diffs_ready',
    totalDiffs: operations.length,
    flaggedCount,
    blockedCount,
  }).catch(() => {})

  return {
    totalDiffs: operations.length,
    flaggedCount,
    blockedCount,
  }
}
