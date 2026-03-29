import { useEffect, useState } from 'react'
import { trpc } from '../lib/trpc'

type Task = {
  id: string
  status: string
  taskType: string
  modelId: string | null
  totalCostCents: number
  errorMessage: string | null
  createdAt: Date
}

type StatusRow = { status: string; count: number }

const STATUS_COLOR: Record<string, string> = {
  completed: '#2a9d8f',
  failed:    '#e76f51',
  executing: '#e9c46a',
  routing:   '#a8c5da',
  submitted: '#a8c5da',
  cancelled: '#aaa',
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: color, color: '#fff', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function fmt(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(4)}`
}

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Overview() {
  const [data, setData] = useState<{ recentTasks: Task[]; statusBreakdown: StatusRow[]; budget: { budget: number; spent: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await trpc.dashboard.getOverview.query()
      setData(res as typeof data)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const tasks     = data?.recentTasks ?? []
  const breakdown = data?.statusBreakdown ?? []
  const budget    = data?.budget ?? { budget: 0, spent: 0 }

  const today       = new Date().toDateString()
  const todayTasks  = tasks.filter(t => new Date(t.createdAt).toDateString() === today)
  const todayCost   = todayTasks.reduce((s, t) => s + (t.totalCostCents ?? 0), 0)
  const failedToday = todayTasks.filter(t => t.status === 'failed').length
  const executing   = breakdown.find(b => b.status === 'executing')?.count ?? 0
  const budgetPct   = budget.budget > 0 ? Math.min(100, Math.round((budget.spent / budget.budget) * 100)) : 0

  const metrics = [
    { label: 'Tasks Today',    value: String(todayTasks.length) },
    { label: 'Cost Today',     value: fmt(todayCost) },
    { label: 'Executing',      value: String(executing) },
    { label: 'Failed Today',   value: String(failedToday) },
  ]

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Overview</h2>
        {loading && <span style={{ fontSize: '0.78rem', color: '#999' }}>refreshing…</span>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fff0ed', color: '#e76f51', marginBottom: 16, fontSize: '0.82rem' }}>
          {error}
        </div>
      )}

      {/* Metrics */}
      <div className="metric-grid" style={{ marginBottom: 24 }}>
        {metrics.map(m => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
          </article>
        ))}
      </div>

      {/* Budget bar */}
      {budget.budget > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#555', marginBottom: 6 }}>
            <span>Monthly budget — {budgetPct}% used</span>
            <span>{fmt(budget.spent)} / {fmt(budget.budget)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: '#eee' }}>
            <div style={{ height: '100%', width: `${budgetPct}%`, borderRadius: 999, transition: 'width 0.4s', background: budgetPct > 80 ? '#e76f51' : '#2a9d8f' }} />
          </div>
        </div>
      )}

      {/* Status breakdown pills */}
      {breakdown.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {breakdown.map(b => (
            <Badge key={b.status} label={`${b.status} · ${b.count}`} color={STATUS_COLOR[b.status] ?? '#aaa'} />
          ))}
        </div>
      )}

      {/* Recent tasks table */}
      <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 600 }}>Recent Tasks</h3>

      {tasks.length === 0 && !loading ? (
        <p style={{ color: '#888', fontSize: '0.875rem' }}>No tasks yet — submit one via the CLI.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(23,42,58,0.1)', textAlign: 'left' }}>
                {['Time', 'Type', 'Status', 'Model', 'Cost'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(23,42,58,0.05)' }}>
                  <td style={{ padding: '7px 10px', color: '#666', whiteSpace: 'nowrap' }}>{fmtTime(t.createdAt)}</td>
                  <td style={{ padding: '7px 10px' }}>{t.taskType.replace('_', ' ')}</td>
                  <td style={{ padding: '7px 10px' }}><Badge label={t.status} color={STATUS_COLOR[t.status] ?? '#aaa'} /></td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: '0.75rem', color: '#2a9d8f' }}>{t.modelId ?? '—'}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace', textAlign: 'right' }}>{fmt(t.totalCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
