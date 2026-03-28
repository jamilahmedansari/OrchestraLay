#!/usr/bin/env node

import { Command } from 'commander'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppRouter } from '../server/routers/index.js'

const API_KEY = process.env.ORCHESTRALAY_API_KEY
const API_URL = process.env.ORCHESTRALAY_API_URL ?? 'http://localhost:3001'

function getClient() {
  if (!API_KEY) {
    console.error('Error: ORCHESTRALAY_API_KEY environment variable is required')
    process.exit(1)
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${API_URL}/trpc`,
        transformer: superjson,
        headers: { Authorization: `Bearer ${API_KEY}` },
      }),
    ],
  })
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`
}

const program = new Command()
  .name('orchestralay')
  .description('OrchestraLay CLI — submit tasks, check status, apply diffs')
  .version('0.1.0')

// ─── submit ──────────────────────────────────────────────────────────
program
  .command('submit')
  .description('Submit a task and wait for completion')
  .requiredOption('--prompt <text>', 'Task prompt')
  .requiredOption('--type <type>', 'Task type: code_generation, debugging, refactoring, analysis, review')
  .option('--model <modelId>', 'Preferred model')
  .option('--budget <cents>', 'Budget in cents', parseInt)
  .option('--timeout <seconds>', 'Timeout in seconds', parseInt)
  .action(async (opts) => {
    const client = getClient()

    console.error('Submitting task...')

    const { taskId, realtimeChannel } = await client.tasks.submit.mutate({
      prompt: opts.prompt,
      taskType: opts.type,
      preferredModels: opts.model ? [opts.model] : undefined,
      budgetCents: opts.budget,
      timeoutSeconds: opts.timeout,
    })

    console.error(`Task created: ${taskId}`)
    console.error(`Realtime channel: ${realtimeChannel}`)
    console.error('Polling for status...')

    // Poll every 2 seconds
    let finalStatus = 'submitted'
    while (true) {
      const status = await client.tasks.getStatus.query({ taskId })
      finalStatus = status.status

      if (finalStatus === 'routing' || finalStatus === 'executing') {
        const model = status.selectedModel ?? 'selecting...'
        process.stderr.write(`\r  Status: ${finalStatus} | Model: ${model}    `)
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }

      console.error('')
      break
    }

    const result = await client.tasks.getStatus.query({ taskId })

    if (result.status === 'completed') {
      console.error(`Completed!`)
      console.error(`  Model:  ${result.selectedModel}`)
      console.error(`  Cost:   ${result.actualCostCents != null ? formatCents(result.actualCostCents) : 'unknown'}`)
      console.error(`  Diffs:  ${result.pendingDiffs} pending`)
    } else if (result.status === 'failed') {
      console.error(`Failed: ${result.errorMessage ?? 'Unknown error'}`)
      process.exit(1)
    } else {
      console.error(`Final status: ${result.status}`)
    }

    console.log(JSON.stringify({ taskId, status: result.status }, null, 2))
  })

// ─── status ──────────────────────────────────────────────────────────
program
  .command('status')
  .description('Check task status')
  .requiredOption('--task-id <id>', 'Task ID')
  .action(async (opts) => {
    const client = getClient()
    const result = await client.tasks.getStatus.query({ taskId: opts.taskId })

    console.error(`Task: ${result.id}`)
    console.error(`  Status:  ${result.status}`)
    console.error(`  Type:    ${result.taskType}`)
    console.error(`  Model:   ${result.selectedModel ?? '—'}`)
    console.error(`  Cost:    ${result.actualCostCents != null ? formatCents(result.actualCostCents) : '—'}`)
    console.error(`  Diffs:   ${result.pendingDiffs} pending`)

    if (result.metadata && (result.metadata as Record<string, unknown>).reasoning) {
      const reasoning = (result.metadata as Record<string, unknown>).reasoning as string[]
      console.error(`  Routing:`)
      for (const r of reasoning) {
        console.error(`    ${r}`)
      }
    }

    console.log(JSON.stringify(result, null, 2))
  })

// ─── apply ───────────────────────────────────────────────────────────
program
  .command('apply')
  .description('Apply approved diffs to disk')
  .requiredOption('--task-id <id>', 'Task ID')
  .option('--dry-run', 'Print changes without writing')
  .option('--revert', 'Revert previously applied changes')
  .action(async (opts) => {
    const client = getClient()

    if (opts.revert) {
      const diffsResult = await client.diffs.getForTask.query({ taskId: opts.taskId })
      const appliedDiffs = diffsResult.filter((d: { applied: boolean }) => d.applied)

      if (appliedDiffs.length === 0) {
        console.error('No applied diffs to revert')
        return
      }

      for (const diff of appliedDiffs) {
        const content = await client.diffs.revert.mutate({ diffId: diff.id })
        if (content.beforeContent != null) {
          if (opts.dryRun) {
            console.error(`[dry-run] Would revert: ${content.filePath}`)
          } else {
            const dir = path.dirname(content.filePath)
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(content.filePath, content.beforeContent, 'utf-8')
            console.error(`Reverted: ${content.filePath}`)
          }
        } else {
          if (!opts.dryRun) {
            await fs.unlink(content.filePath).catch(() => {})
            console.error(`Deleted (revert create): ${content.filePath}`)
          }
        }
      }

      console.error(`Reverted ${appliedDiffs.length} diff(s)`)
      return
    }

    // Normal apply flow
    const diffsResult = await client.diffs.getForTask.query({ taskId: opts.taskId })
    const approved = diffsResult.filter(
      (d: { status: string; applied: boolean }) => d.status === 'approved' && !d.applied
    )

    if (approved.length === 0) {
      console.error('No approved, unapplied diffs to apply')
      return
    }

    const appliedIds: string[] = []

    for (const diff of approved) {
      const content = await client.diffs.getContent.query({ diffId: diff.id })

      if (opts.dryRun) {
        console.error(`[dry-run] ${content.operation}: ${content.filePath} (+${content.linesAdded} -${content.linesRemoved})`)
        continue
      }

      if (content.operation === 'delete') {
        await fs.unlink(content.filePath).catch(() => {})
        console.error(`Deleted: ${content.filePath}`)
      } else if (content.afterContent != null) {
        const dir = path.dirname(content.filePath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(content.filePath, content.afterContent, 'utf-8')
        console.error(`${content.operation === 'create' ? 'Created' : 'Modified'}: ${content.filePath}`)
      }

      appliedIds.push(diff.id)
    }

    if (!opts.dryRun && appliedIds.length > 0) {
      await client.diffs.markApplied.mutate({ diffIds: appliedIds })
      console.error(`Applied ${appliedIds.length} diff(s)`)
    }
  })

program.parse()
