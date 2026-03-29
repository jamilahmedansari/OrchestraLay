import { getQueue } from '../lib/queue.js'

const ORCHESTRATE_TASK_JOB = 'orchestrate-task'

let workerStarted = false

export async function startOrchestrationWorker(): Promise<void> {
  if (workerStarted) {
    return
  }

  const queue = await getQueue()
  await queue.createQueue(ORCHESTRATE_TASK_JOB).catch(() => {})
  workerStarted = true
}

export { ORCHESTRATE_TASK_JOB }