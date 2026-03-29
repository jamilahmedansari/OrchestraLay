import { useEffect } from 'react'
import { trpc } from '../lib/trpc'
import { supabase } from '../lib/supabase'

const statusColors: Record<string, string> = {
  submitted: 'bg-gray-100 text-gray-700',
  routing: 'bg-blue-100 text-blue-700',
  executing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function timeAgo(date: Date | string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function Overview() {
  const overview = trpc.dashboard.getOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  })

  const { metrics, recentTasks } = overview.data ?? {
    metrics: { tasksToday: 0, costTodayCents: 0, pendingDiffs: 0, failedToday: 0 },
    recentTasks: [],
  }

  // Realtime subscription for live updates
  useEffect(() => {
    const teamId = localStorage.getItem('team_id')
    if (!teamId) return

    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `team_id=eq.${teamId}`,
      }, () => {
        overview.refetch()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div>
      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Tasks Today" value={metrics.tasksToday} />
        <MetricCard
          label="Cost Today"
          value={`${(metrics.costTodayCents / 100).toFixed(2)}`}
          prefix="$"
        />
        <MetricCard label="Pending Diffs" value={metrics.pendingDiffs} />
        <MetricCard label="Failed Today" value={metrics.failedToday} variant="danger" />
      </div>

      {/* Task Feed Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Live Task Feed</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Prompt</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Model</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Cost</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentTasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    {task.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate">{task.prompt}</td>
                  <td className="px-4 py-2 text-xs">
                    {task.selectedModel ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        statusColors[task.status] ?? 'bg-gray-100'
                      }`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {task.actualCostCents != null
                      ? `$${(task.actualCostCents / 100).toFixed(4)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500">
                    {timeAgo(task.createdAt)}
                  </td>
                </tr>
              ))}
              {recentTasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No tasks yet. Submit one via CLI or API.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  prefix,
  variant,
}: {
  label: string
  value: number | string
  prefix?: string
  variant?: 'danger'
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p
        className={`text-2xl font-bold mt-1 ${
          variant === 'danger' && Number(value) > 0 ? 'text-red-600' : 'text-gray-900'
        }`}
      >
        {prefix}
        {value}
      </p>
    </div>
  )
}
