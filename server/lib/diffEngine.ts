import { db } from '../db/index.js'
import { diffs, projects } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { parseModelOutput } from './outputParser.js'
import { computeDiff } from './diffComputer.js'
import { checkSafetyRules, type ProjectSafetyRules } from './safetyRules.js'
import { broadcastTaskUpdate } from './realtime.js'

/**
 * Orchestrates: parse → diff → safety → persist → broadcast.
 * NEVER writes files to disk — that is the CLI's job.
 */
export async function runDiffEngine(
  taskId: string,
  modelResultId: string,
  content: string,
  projectId: string
): Promise<{ diffCount: number; blockedCount: number; flaggedCount: number }> {
  // Load project safety settings
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error(`Project ${projectId} not found`)
  }

  const projectRules: ProjectSafetyRules = {
    allowFileDeletion: project.allowFileDeletion,
    allowFrameworkChanges: project.allowFrameworkChanges,
    allowTestFileDeletion: project.allowTestFileDeletion,
    customBlockedPaths: (project.safetyRules as { customBlockedPaths?: string[] })?.customBlockedPaths ?? [],
  }

  // Step 1: Parse model output
  const operations = parseModelOutput(content)

  let diffCount = 0
  let blockedCount = 0
  let flaggedCount = 0

  // Step 2-3: For each operation, compute diff + check safety + persist
  for (const op of operations) {
    const diffResult = computeDiff(op.beforeContent, op.afterContent, op.operation)

    if (diffResult.isBinaryFile) continue

    const violations = checkSafetyRules(op, projectRules)
    const hasBlock = violations.some((v) => v.severity === 'block')
    const hasWarn = violations.some((v) => v.severity === 'warn')

    await db.insert(diffs).values({
      taskId,
      modelResultId,
      projectId,
      teamId: project.teamId,
      filePath: op.filePath,
      operation: op.operation,
      beforeContent: op.beforeContent,
      afterContent: op.afterContent,
      hunks: diffResult.hunks,
      linesAdded: diffResult.linesAdded,
      linesRemoved: diffResult.linesRemoved,
      flagged: hasWarn || hasBlock,
      blocked: hasBlock,
      safetyViolations: violations,
    })

    diffCount++
    if (hasBlock) blockedCount++
    if (hasWarn && !hasBlock) flaggedCount++
  }

  // Step 4: Broadcast diff summary
  broadcastTaskUpdate(taskId, {
    event: 'diffs_ready',
    diffCount,
    blockedCount,
    flaggedCount,
  })

  return { diffCount, blockedCount, flaggedCount }
}
