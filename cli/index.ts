#!/usr/bin/env node
import { Command } from 'commander'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import fs from 'fs/promises'
import path from 'path'
import type { AppRouter } from '../server/routers/index.js'

const API_URL = process.env.ORCHESTRALAY_API_URL ?? 'http://localhost:3001/trpc'
const API_KEY = process.env.ORCHESTRALAY_API_KEY

function getClient() {
  if (!API_KEY) {
    console.error('Error: ORCHESTRALAY_API_KEY environment variable is required')
    process.exit(1)
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: API_URL,
        transformer: superjson,
        headers: { Authorization: `Bearer ${API_KEY}` },
      }),
    ],
  })
}

const program = new Command()
  .name('orchestralay')
  .description('OrchestraLay CLI — submit AI tasks, check status, apply diffs')
  .version('0.1.0')

// ── submit ────────────────────────────────────────────────────────

program
  .command('submit')
  .description('Submit a task and poll until completion')
  .requiredOption('--prompt <prompt>', 'The task prompt')
  .requiredOption('--type <type>', 'Task type: code_generation, debugging, refactoring, analysis, review')
  .option('--model <model>', 'Preferred model')
  .option('--budget <cents>', 'Max cost in cents', parseInt)
  .option('--timeout <seconds>', 'Timeout in seconds', parseInt)
  .action(async (opts) => {
    const client = getClient()

    console.log('Submitting task...')
    const result = await client.tasks.submit.mutate({
      prompt: opts.prompt,
      taskType: opts.type,
      preferredModels: opts.model ? [opts.model] : undefined,
      budgetCents: opts.budget,
      timeoutSeconds: opts.timeout,
    })

    console.log(`Task ID: ${result.taskId}`)
    console.log(`Realtime channel: ${result.realtimeChannel}`)
    console.log('Polling for completion...\n')

    // Poll every 2s
    while (true) {
      await new Promise((r) => setTimeout(r, 2000))

      const status = await client.tasks.getStatus.query({ taskId: result.taskId })

      process.stdout.write(`\r  Status: ${status.status}`)

      if (status.status === 'completed') {
        console.log('\n')
        console.log(`Model: ${status.selectedModel}`)
        console.log(`Cost: $${((status.actualCostCents ?? 0) / 100).toFixed(4)}`)
        console.log(`Diffs: ${status.diffCount}`)
        console.log(`\nRun: orchestralay apply --task-id ${result.taskId}`)
        break
      }

      if (status.status === 'failed' || status.status === 'cancelled') {
        console.log('\n')
        console.error(`Task ${status.status}`)
        if (status.metadata && typeof status.metadata === 'object' && 'error' in status.metadata) {
          console.error(`Error: ${(status.metadata as { error: string }).error}`)
        }
        process.exit(1)
      }
    }
  })

// ── status ────────────────────────────────────────────────────────

program
  .command('status')
  .description('Check task status')
  .requiredOption('--task-id <taskId>', 'Task ID')
  .action(async (opts) => {
    const client = getClient()
    const status = await client.tasks.getStatus.query({ taskId: opts.taskId })

    console.log(`Task:   ${status.id}`)
    console.log(`Status: ${status.status}`)
    console.log(`Type:   ${status.taskType}`)
    console.log(`Model:  ${status.selectedModel ?? 'pending'}`)
    console.log(`Cost:   $${((status.actualCostCents ?? 0) / 100).toFixed(4)}`)
    console.log(`Diffs:  ${status.diffCount}`)

    if (status.metadata && typeof status.metadata === 'object' && 'reasoning' in status.metadata) {
      console.log('\nRouting reasoning:')
      for (const r of (status.metadata as { reasoning: string[] }).reasoning) {
        console.log(`  ${r}`)
      }
    }
  })

// ── apply ─────────────────────────────────────────────────────────

program
  .command('apply')
  .description('Apply approved diffs to disk')
  .requiredOption('--task-id <taskId>', 'Task ID')
  .option('--dry-run', 'Print changes without writing')
  .option('--revert', 'Revert applied diffs')
  .action(async (opts) => {
    const client = getClient()

    if (opts.revert) {
      // Fetch applied diffs and revert
      const taskDiffs = await client.diffs.getForTask.query({ taskId: opts.taskId })
      const appliedDiffs = taskDiffs.filter((d) => d.status === 'applied')

      if (appliedDiffs.length === 0) {
        console.log('No applied diffs to revert.')
        return
      }

      for (const diff of appliedDiffs) {
        const content = await client.diffs.getContent.query({ diffId: diff.id })

        if (content.beforeContent !== null) {
          const filePath = path.resolve(content.filePath)
          if (opts.dryRun) {
            console.log(`[dry-run] Would restore: ${filePath}`)
          } else {
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, content.beforeContent, 'utf-8')
            console.log(`Restored: ${filePath}`)
          }
        } else if (content.operation === 'create') {
          const filePath = path.resolve(content.filePath)
          if (opts.dryRun) {
            console.log(`[dry-run] Would delete: ${filePath}`)
          } else {
            await fs.unlink(filePath).catch(() => {})
            console.log(`Deleted: ${filePath}`)
          }
        }

        await client.diffs.revert.mutate({ diffId: diff.id })
      }

      console.log(`\nReverted ${appliedDiffs.length} diffs.`)
      return
    }

    // Normal apply — fetch approved diffs
    const taskDiffs = await client.diffs.getForTask.query({ taskId: opts.taskId })
    const approvedDiffs = taskDiffs.filter((d) => d.status === 'approved')

    if (approvedDiffs.length === 0) {
      console.log('No approved diffs to apply. Approve them in the dashboard first.')
      return
    }

    const appliedIds: string[] = []

    for (const diff of approvedDiffs) {
      const content = await client.diffs.getContent.query({ diffId: diff.id })
      const filePath = path.resolve(content.filePath)

      if (content.operation === 'delete') {
        if (opts.dryRun) {
          console.log(`[dry-run] Would delete: ${filePath}`)
        } else {
          await fs.unlink(filePath).catch(() => {})
          console.log(`Deleted: ${filePath}`)
        }
      } else {
        if (opts.dryRun) {
          console.log(`[dry-run] Would write: ${filePath} (+${diff.linesAdded} -${diff.linesRemoved})`)
        } else {
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await fs.writeFile(filePath, content.afterContent ?? '', 'utf-8')
          console.log(`Written: ${filePath} (+${diff.linesAdded} -${diff.linesRemoved})`)
        }
      }

      if (!opts.dryRun) appliedIds.push(diff.id)
    }

    // Mark applied in DB
    if (appliedIds.length > 0) {
      await client.diffs.markApplied.mutate({ diffIds: appliedIds })
    }

    console.log(`\n${opts.dryRun ? '[dry-run] ' : ''}Applied ${approvedDiffs.length} diffs.`)
  })

program.parse()
