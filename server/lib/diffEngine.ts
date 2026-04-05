// diffEngine.ts — parse → diff → safety check → persist to DB

import { createTwoFilesPatch, parsePatch } from 'diff'
import { db } from '../db/index.js'
import { diffs } from '../db/schema.js'
import { parseFileChanges, type FileChange } from './outputParser.js'

export type SafetyFlag = {
  rule: string
  description: string
  severity: 'warn' | 'block'
}

const SAFETY_RULES: Array<{
  name: string
  description: string
  severity: 'warn' | 'block'
  check: (change: FileChange) => boolean
}> = [
  {
    name: 'no_file_deletion',
    description: 'File deletion detected — requires explicit approval',
    severity: 'block',
    check: (c) => c.operation === 'delete',
  },
  {
    name: 'no_env_write',
    description: 'Writing to .env or secrets file',
    severity: 'block',
    check: (c) => /\.(env|secret|key|pem|p12|pfx)$/.test(c.path),
  },
  {
    name: 'no_gitignore_removal',
    description: 'Modifying .gitignore — could expose secrets',
    severity: 'warn',
    check: (c) => c.path.endsWith('.gitignore'),
  },
  {
    name: 'no_lock_file_change',
    description: 'Modifying package-lock.json or yarn.lock directly',
    severity: 'warn',
    check: (c) => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(c.path),
  },
  {
    name: 'no_ci_change',
    description: 'Modifying CI/CD pipeline files',
    severity: 'warn',
    check: (c) => /\.github\/workflows|\.gitlab-ci/.test(c.path),
  },
  {
    name: 'no_docker_change',
    description: 'Modifying Dockerfile or docker-compose',
    severity: 'warn',
    check: (c) => /Dockerfile|docker-compose/.test(c.path),
  },
  {
    name: 'no_db_schema_drop',
    description: 'Possible DROP TABLE or destructive SQL detected',
    severity: 'block',
    check: (c) =>
      c.content.toLowerCase().includes('drop table') ||
      c.content.toLowerCase().includes('truncate table'),
  },
  {
    name: 'no_eval_exec',
    description: 'eval() or exec() usage detected in code change',
    severity: 'warn',
    check: (c) => /\beval\s*\(|\bexec\s*\(/.test(c.content),
  },
]

function computeDiff(path: string, original: string, modified: string): string {
  return createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    original,
    modified,
    undefined,
    undefined,
    { context: 5 },
  )
}

function runSafetyChecks(change: FileChange): SafetyFlag[] {
  const flags: SafetyFlag[] = []
  for (const rule of SAFETY_RULES) {
    if (rule.check(change)) {
      flags.push({ rule: rule.name, description: rule.description, severity: rule.severity })
    }
  }
  return flags
}

function parseHunks(unified: string): Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; content: string }> {
  const patches = parsePatch(unified)
  const first = patches[0]
  if (!first?.hunks) return []
  return first.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    content: h.lines.join('\n'),
  }))
}

function countLines(unified: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of unified.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

export async function processDiffs(
  taskId: string,
  projectId: string,
  modelResultId: string,
  changes: FileChange[],
  teamId: string,
  originalContents: Record<string, string> = {},
): Promise<{ diffCount: number; blockedCount: number; flaggedCount: number }> {
  let diffCount = 0
  let blockedCount = 0
  let flaggedCount = 0

  for (const change of changes) {
    const original = originalContents[change.path] ?? ''
    const unified = change.operation === 'delete'
      ? computeDiff(change.path, original, '')
      : computeDiff(change.path, original, change.content)

    const hunks = parseHunks(unified)
    const { added, removed } = countLines(unified)
    const flags = runSafetyChecks(change)
    const hasBlocks = flags.some((f) => f.severity === 'block')
    // 'blocked' is tracked via the boolean column, not the status enum
    const status = 'pending' as const

    await db.insert(diffs).values({
      taskId,
      projectId,
      teamId,
      modelResultId,
      filePath: change.path,
      operation: change.operation,
      beforeContent: original || null,
      afterContent: change.operation === 'delete' ? null : change.content,
      hunks: hunks as any,
      linesAdded: added,
      linesRemoved: removed,
      safetyViolations: flags as any,
      flagged: flags.length > 0,
      blocked: hasBlocks,
      status,
    })

    diffCount++
    if (hasBlocks) blockedCount++
    if (flags.length > 0) flaggedCount++
  }

  return { diffCount, blockedCount, flaggedCount }
}

/** Wrapper matching orchestrateTask call convention: parses raw content, runs diffs, returns summary */
export async function runDiffEngine(
  taskId: string,
  modelResultId: string,
  rawContent: string,
  projectId: string,
  teamId?: string,
): Promise<{ diffCount: number; blockedCount: number; flaggedCount: number }> {
  const changes = parseFileChanges(rawContent)
  if (changes.length === 0) {
    return { diffCount: 0, blockedCount: 0, flaggedCount: 0 }
  }
  return processDiffs(taskId, projectId, modelResultId, changes, teamId ?? projectId)
}
