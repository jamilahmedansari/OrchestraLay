#!/usr/bin/env node

/**
 * OrchestraLay CLI
 *
 * Commands:
 *   submit  --prompt <text> --type <task_type> [--model <id>] [--budget <cents>]
 *   status  --task-id <uuid>
 *   apply   --task-id <uuid> [--dry-run] [--revert]
 *
 * Environment:
 *   ORCHESTRALAY_API_KEY   olay_... key (required)
 *   ORCHESTRALAY_API_URL   default http://localhost:3001
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AppRouter } from '../server/routers/index.js'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL  = process.env.ORCHESTRALAY_API_URL ?? 'http://localhost:3001'
const API_KEY  = process.env.ORCHESTRALAY_API_KEY ?? ''
const POLL_MS  = 2000

if (!API_KEY) {
  stderr('Error: ORCHESTRALAY_API_KEY is not set.')
  stderr('  export ORCHESTRALAY_API_KEY=olay_...')
  process.exit(1)
}

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      transformer: superjson,
      headers: { Authorization: `Bearer ${API_KEY}` },
    }),
  ],
})

// ─── Output helpers ───────────────────────────────────────────────────────────

function stderr(...args: unknown[]) { process.stderr.write(args.join(' ') + '\n') }
function stdout(obj: unknown)        { process.stdout.write(JSON.stringify(obj, null, 2) + '\n') }
function clearLine()                 { process.stderr.write('\r\x1b[K') }

function formatCost(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(4)}`
}

// ─── Arg parser ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {}
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      i++
    }
  }
  return flags
}

function strFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

function boolFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true
}

// ─── TASK TYPES ───────────────────────────────────────────────────────────────

const TASK_TYPES = ['code_generation', 'debugging', 'refactoring', 'analysis', 'review'] as const
type TaskType = typeof TASK_TYPES[number]

function assertTaskType(s: string): TaskType {
  if (!TASK_TYPES.includes(s as TaskType)) {
    stderr(`Error: --type must be one of: ${TASK_TYPES.join(', ')}`)
    process.exit(1)
  }
  return s as TaskType
}

// ─── submit ───────────────────────────────────────────────────────────────────

async function cmdSubmit(flags: Record<string, string | boolean>) {
  const prompt     = strFlag(flags, 'prompt')
  const typeRaw    = strFlag(flags, 'type')
  const model      = strFlag(flags, 'model')
  const budgetStr  = strFlag(flags, 'budget')

  if (!prompt)  { stderr('Error: --prompt is required'); process.exit(1) }
  if (!typeRaw) { stderr('Error: --type is required');   process.exit(1) }

  const taskType      = assertTaskType(typeRaw)
  const budgetCents   = budgetStr ? parseInt(budgetStr, 10) : undefined

  stderr(`Submitting ${taskType} task…`)

  let taskId: string
  try {
    const res = await client.tasks.submit.mutate({
      prompt,
      taskType,
      preferredModel: model,
      budgetCapCents: budgetCents,
    })
    taskId = res.taskId
    stderr(`✓ Submitted — task ID: ${taskId}`)
  } catch (e: unknown) {
    stderr('Error submitting:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // Poll until terminal state
  const terminal = new Set(['completed', 'failed', 'cancelled'])
  let tick = 0
  const spinner = ['-', '\\', '|', '/']

  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS))
    try {
      const task = await client.tasks.get.query({ taskId })
      const s    = spinner[tick % 4]
      tick++
      const modelStr = task.modelId ? ` [${task.modelId}]` : ''
      clearLine()
      process.stderr.write(`${s} ${task.status}${modelStr}`)

      if (terminal.has(task.status)) {
        clearLine()
        if (task.status === 'completed') {
          stderr(`✅  completed   model=${task.modelId ?? '—'}   cost=${formatCost(task.totalCostCents)}`)
          stdout({ taskId, status: 'completed', modelId: task.modelId, costCents: task.totalCostCents })
          process.exit(0)
        } else {
          stderr(`❌  ${task.status}   ${task.errorMessage ?? ''}`)
          stdout({ taskId, status: task.status, error: task.errorMessage })
          process.exit(1)
        }
      }
    } catch (e: unknown) {
      clearLine()
      stderr('Poll error:', e instanceof Error ? e.message : String(e))
    }
  }
}

// ─── status ───────────────────────────────────────────────────────────────────

async function cmdStatus(flags: Record<string, string | boolean>) {
  const taskId = strFlag(flags, 'task-id')
  if (!taskId) { stderr('Error: --task-id is required'); process.exit(1) }

  try {
    const task = await client.tasks.get.query({ taskId })

    stderr(`Task ID    : ${task.id}`)
    stderr(`Status     : ${task.status}`)
    stderr(`Type       : ${task.taskType}`)
    stderr(`Model      : ${task.modelId ?? '—'}`)
    stderr(`Cost       : ${formatCost(task.totalCostCents)}`)
    stderr(`Created    : ${new Date(task.createdAt).toLocaleString()}`)
    if (task.completedAt) stderr(`Completed  : ${new Date(task.completedAt).toLocaleString()}`)
    if (task.errorMessage) stderr(`Error      : ${task.errorMessage}`)

    const reasoning = (task.routingReasoning as string[] | null)
    if (reasoning && reasoning.length > 0) {
      stderr('\nRouting decisions:')
      for (const line of reasoning) stderr(`  · ${line}`)
    }

    stdout(task)
  } catch (e: unknown) {
    stderr('Error:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

// ─── apply ────────────────────────────────────────────────────────────────────

async function cmdApply(flags: Record<string, string | boolean>) {
  const taskId = strFlag(flags, 'task-id')
  const dryRun = boolFlag(flags, 'dry-run')
  const revert = boolFlag(flags, 'revert')

  if (!taskId) { stderr('Error: --task-id is required'); process.exit(1) }

  type DiffRow = {
    id: string
    filePath: string
    operation: string
    status: string
    unifiedDiff: string | null
    beforeContent: string | null
    afterContent: string | null
  }

  let allDiffs: DiffRow[]
  try {
    allDiffs = await client.diffs.forTask.query({ taskId }) as DiffRow[]
  } catch (e: unknown) {
    stderr('Error fetching diffs:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // ── REVERT ──────────────────────────────────────────────────
  if (revert) {
    const applied = allDiffs.filter(d => d.status === 'applied')
    if (applied.length === 0) { stderr('No applied diffs to revert.'); process.exit(0) }
    stderr(`${dryRun ? '[dry-run] ' : ''}Reverting ${applied.length} diff(s)…`)

    for (const d of applied) {
      if (dryRun) { stderr(`  [dry-run] ↩  ${d.filePath}`); continue }
      try {
        if (d.operation === 'create') {
          // File was created — delete it on revert
          await fs.unlink(path.resolve(d.filePath)).catch(() => {/* already gone */})
          stderr(`  ↩  deleted ${d.filePath}`)
        } else if (d.beforeContent) {
          // Restore original content
          await fs.mkdir(path.dirname(path.resolve(d.filePath)), { recursive: true })
          await fs.writeFile(path.resolve(d.filePath), d.beforeContent, 'utf-8')
          stderr(`  ↩  restored ${d.filePath}`)
        } else {
          stderr(`  ⚠️  no before_content for ${d.filePath} — skipping (use git to restore)`)
          continue
        }
        await client.diffs.markReverted.mutate({ diffId: d.id })
      } catch (e: unknown) {
        stderr(`  ❌  ${d.filePath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (!dryRun) stderr(`✅  Reverted ${applied.length} diff(s)`)
    stdout({ taskId, reverted: applied.length, dryRun })
    process.exit(0)
  }

  // ── APPLY ───────────────────────────────────────────────────
  const approved = allDiffs.filter(d => d.status === 'approved')
  const pending  = allDiffs.filter(d => d.status === 'pending')
  const blocked  = allDiffs.filter(d => d.status === 'blocked')

  if (blocked.length)  stderr(`⚠️   ${blocked.length} diff(s) blocked by safety rules — skipped`)
  if (pending.length)  stderr(`ℹ️   ${pending.length} diff(s) still pending approval — approve in dashboard first`)
  if (!approved.length){ stderr('No approved diffs to apply.'); process.exit(0) }

  stderr(`${dryRun ? '[dry-run] ' : ''}Applying ${approved.length} diff(s)…`)

  const appliedIds: string[] = []

  for (const d of approved) {
    if (dryRun) {
      stderr(`  [dry-run] ${d.operation.toUpperCase().padEnd(6)} ${d.filePath}`)
      continue
    }
    try {
      if (d.operation === 'delete') {
        await fs.unlink(path.resolve(d.filePath))
        stderr(`  🗑   deleted  ${d.filePath}`)
      } else {
        // Prefer afterContent from DB; fall back to reconstructing from unified diff
        let content = d.afterContent ?? ''
        if (!content && d.unifiedDiff) {
          content = d.unifiedDiff
            .split('\n')
            .filter(l => l.startsWith('+') && !l.startsWith('+++'))
            .map(l => l.slice(1))
            .join('\n')
        }
        await fs.mkdir(path.dirname(path.resolve(d.filePath)), { recursive: true })
        await fs.writeFile(path.resolve(d.filePath), content, 'utf-8')
        stderr(`  ✏️   ${d.operation === 'create' ? 'created ' : 'modified'} ${d.filePath}`)
      }
      appliedIds.push(d.id)
    } catch (e: unknown) {
      stderr(`  ❌  ${d.filePath}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Mark applied in DB
  if (!dryRun && appliedIds.length > 0) {
    for (const diffId of appliedIds) {
      await client.diffs.markApplied.mutate({ diffId }).catch(() => {/* non-fatal */})
    }
    stderr(`✅  Applied ${appliedIds.length} diff(s)`)
  }

  stdout({ taskId, applied: appliedIds.length, skipped: approved.length - appliedIds.length, dryRun })
  process.exit(0)
}

// ─── Usage ────────────────────────────────────────────────────────────────────

const USAGE = `
orchestralay <command> [options]

Commands:
  submit    Submit a task and poll until complete
  status    Check task status
  apply     Write approved diffs to disk (or revert them)

submit options:
  --prompt <text>     Task description (required)
  --type <type>       code_generation | debugging | refactoring | analysis | review  (required)
  --model <id>        Preferred model  e.g. claude-3-5-sonnet  (optional)
  --budget <cents>    Max cost cap in cents  e.g. 50 = $0.50  (optional)

status options:
  --task-id <uuid>    Task ID returned by submit (required)

apply options:
  --task-id <uuid>    Task ID (required)
  --dry-run           Preview without writing files
  --revert            Undo previously applied diffs

Environment:
  ORCHESTRALAY_API_KEY    Your API key — olay_...  (required)
  ORCHESTRALAY_API_URL    Server URL  (default: http://localhost:3001)

Examples:
  orchestralay submit --prompt "Add retry logic to fetchUser" --type refactoring
  orchestralay status --task-id 018e...
  orchestralay apply  --task-id 018e...
  orchestralay apply  --task-id 018e... --dry-run
  orchestralay apply  --task-id 018e... --revert
`.trim()

// ─── Router ───────────────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv
const flags = parseArgs(rest)

if (!command || command === '--help' || command === '-h') {
  stderr(USAGE); process.exit(0)
}

switch (command) {
  case 'submit': cmdSubmit(flags).catch(e => { stderr(String(e)); process.exit(1) }); break
  case 'status': cmdStatus(flags).catch(e => { stderr(String(e)); process.exit(1) }); break
  case 'apply':  cmdApply(flags).catch(e  => { stderr(String(e)); process.exit(1) }); break
  default:
    stderr(`Unknown command: ${command}\n`)
    stderr(USAGE)
    process.exit(1)
}
