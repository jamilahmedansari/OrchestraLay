import { useState, useEffect, useCallback } from 'react'
import { trpc } from '../lib/trpc.js'
import { supabase } from '../lib/supabase.js'

interface OverviewData {
  tasksToday: number
  costTodayCents: number
  pendingDiffs: number
  failedToday: number
  recentTasks: Array<{
    id: string
    prompt: string
    taskType: string
    status: string
    selectedModel: string | null
    actualCostCents: number | null
    createdAt: string
  }>
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    submitted: 'bg-gray-700 text-gray-300',
    routing: 'bg-blue-900 text-blue-300',
    executing: 'bg-yellow-900 text-yellow-300',
    completed: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
    cancelled: 'bg-gray-800 text-gray-500',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  )
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const result = await trpc.dashboard.getOverview.query()
      setData(result as OverviewData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    const channel = supabase
      .channel('tasks-realtime')
      .on('broadcast', { event: 'task_update' }, () => {
        fetchData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  if (error) {
    return <div className="text-red-400">Error: {error}</div>
  }

  if (!data) {
    return <div className="text-gray-500">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Tasks today" value={data.tasksToday} />
        <MetricCard label="Cost today" value={formatCents(data.costTodayCents)} />
        <MetricCard label="Pending diffs" value={data.pendingDiffs} />
        <MetricCard label="Failed today" value={data.failedToday} />
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-300">Recent tasks</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-500">
              <th className="px-5 py-2 font-medium">ID</th>
              <th className="px-5 py-2 font-medium">Prompt</th>
              <th className="px-5 py-2 font-medium">Model</th>
              <th className="px-5 py-2 font-medium">Status</th>
              <th className="px-5 py-2 font-medium">Cost</th>
              <th className="px-5 py-2 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {data.recentTasks.map((task) => (
              <tr key={task.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-5 py-2 font-mono text-xs text-gray-400">
                  {task.id.slice(0, 8)}
                </td>
                <td className="max-w-xs truncate px-5 py-2 text-gray-300">
                  {task.prompt.slice(0, 60)}{task.prompt.length > 60 ? '...' : ''}
                </td>
                <td className="px-5 py-2 text-gray-400">{task.selectedModel ?? '—'}</td>
                <td className="px-5 py-2"><StatusBadge status={task.status} /></td>
                <td className="px-5 py-2 text-gray-400">
                  {task.actualCostCents != null ? formatCents(task.actualCostCents) : '—'}
                </td>
                <td className="px-5 py-2 text-gray-500">{timeAgo(task.createdAt)}</td>
              </tr>
            ))}
            {data.recentTasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-gray-600">
                  No tasks yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
