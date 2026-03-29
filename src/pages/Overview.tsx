import { useEffect, useState } from 'react'
import { trpc } from '../lib/trpc'

type Task = {
  id: string
  status: string
  taskType: string
  modelId: string | null
  totalCostCents: number | null
  errorMessage: string | null
  createdAt: Date
}

type StatusBreakdown = { status: string; count: number }

const STATUS_COLOR: Record<string, string> = {
  completed: '#2a9d8f',
  failed: '#e76f51',
  executing: '#e9c46a',
  routing: '#a8c5da',
  submitted: '#a8c5da',
  cancelled: '#aaa',
}

function statusBadge(status: string) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: STATUS_COLOR[status] ?? '#ccc',
        color: '#fff',
      }}
    >
      {status}
    </span>
  )
}

function formatCost(cents: number | null) {
  if (cents === null) return '—'
  return `$${(cents / 100).toFixed(4)}`
}

function formatDate(d: Date) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Overview() {
  const [overview, setOverview] = useState<{
    recentTasks: Task[]
    statusBreakdown: StatusBreakdown[]
    budget: { budget: number; spent: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await trpc.dashboard.getOverview.query()
      setOverview(data as typeof overview)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const tasks = overview?.recentTasks ?? []
  const breakdown = overview?.statusBreakdown ?? []
  const budget = overview?.budget ?? { budget: 0, spent: 0 }

  const todayTasks = tasks.filter(
    (t) => new Date(t.createdAt).toDateString() === new Date().toDateString(),
  )
  const todayCost = todayTasks.reduce((sum, t) => sum + (t.totalCostCents ?? 0), 0)
  const pendingDiffs = breakdown.find((b) => b.status === 'executing')?.count ?? 0
  const failedToday = todayTasks.filter((t) => t.status === 'failed').length

  const metrics = [
    { label: 'Tasks Today', value: String(todayTasks.length) },
    { label: 'Cost Today', value: formatCost(todayCost) },
    { label: 'Executing', value: String(pendingDiffs) },
    { label: 'Failed Today', value: String(failedToday) },
  ]

  const budgetPct = budget.budget > 0 ? Math.min(100, Math.round((budget.spent / budget.budget) * 100)) : 0

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Overview</h2>
        {loading && <span style={{ fontSize: '0.8rem', color: '#999' }}>refreshing…</span>}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#fff0ed', color: '#e76f51', marginBottom: 20, fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Metric cards */}
      <div className="metric-grid" style={{ marginBottom: 24 }}>
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
          </article>
        ))}
      </div>

      {/* Budget bar */}
      {budget.budget > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
            <span>Monthly Budget</span>
            <span>{formatCost(budget.spent)} / {formatCost(budget.budget)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: '#eee', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetPct}%`, background: budgetPct > 80 ? '#e76f51' : '#2a9d8f', borderRadius: 999, transition: 'width 0.4s' }} />
          </div>
        </div>
      )}

      {/* Status breakdown */}
      {breakdown.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {breakdown.map((b) => (
            <span key={b.status} style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: 999, background: STATUS_COLOR[b.status] ?? '#ccc', color: '#fff' }}>
              {b.status} · {b.count}
            </span>
          ))}
        </div>
      )}

      {/* Recent tasks table */}
      <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 600 }}>Recent Tasks</h3>
      {tasks.length === 0 && !loading ? (
        <p style={{ color: '#888', fontSize: '0.875rem' }}>No tasks yet. Submit one via the CLI.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(23,42,58,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Time</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Model</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(23,42,58,0.05)' }}>
                  <td style={{ padding: '8px 12px', color: '#666' }}>{formatDate(t.createdAt)}</td>
                  <td style={{ padding: '8px 12px' }}>{t.taskType.replace('_', ' ')}</td>
                  <td style={{ padding: '8px 12px' }}>{statusBadge(t.status)}</td>
                  <td style={{ padding: '8px 12px', color: '#2a9d8f', fontFamily: 'monospace', fontSize: '0.8rem' }}>{t.modelId ?? '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCost(t.totalCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
