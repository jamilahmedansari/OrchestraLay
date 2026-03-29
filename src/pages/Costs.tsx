import { useEffect, useState } from 'react'
import { trpc } from '../lib/trpc'

type ModelRow = {
  modelId: string
  totalCostCents: string | null
  totalInputTokens: string | null
  totalOutputTokens: string | null
  callCount: string | null
  avgDurationMs: string | null
}

type DayRow = {
  day: string
  totalCostCents: string | null
  taskCount: string | null
}

type CostData = {
  byModel: ModelRow[]
  dailySpend: DayRow[]
  monthToDateCents: number
  monthlyBudgetCents: number
}

const MODEL_DOT: Record<string, string> = {
  'claude-3-5-sonnet': '#2a9d8f',
  'claude-3-haiku':    '#52b788',
  'gpt-4o':            '#457b9d',
  'gpt-4o-mini':       '#a8c5da',
  'perplexity-sonar-large': '#e9c46a',
  'perplexity-sonar-small': '#f4a261',
}

function fmt(v: string | number | null | undefined): string {
  const n = Number(v ?? 0)
  return `$${(n / 100).toFixed(4)}`
}

function fmtTokens(v: string | number | null): string {
  const n = Number(v ?? 0)
  if (!n) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function fmtMs(v: string | number | null): string {
  const n = Number(v ?? 0)
  if (!n) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

export function Costs() {
  const [data, setData]   = useState<CostData | null>(null)
  const [days, setDays]   = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await trpc.dashboard.getCosts.query({ days })
      setData(res as CostData)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load costs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [days])

  const totalCalls  = data?.byModel.reduce((s, m) => s + Number(m.callCount ?? 0), 0) ?? 0
  const periodCost  = data?.byModel.reduce((s, m) => s + Number(m.totalCostCents ?? 0), 0) ?? 0
  const budgetPct   = data && data.monthlyBudgetCents > 0
    ? Math.min(100, Math.round((data.monthToDateCents / data.monthlyBudgetCents) * 100))
    : 0
  const maxDaily    = Math.max(...(data?.dailySpend.map(d => Number(d.totalCostCents ?? 0)) ?? [1]), 1)

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Costs</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
              background: days === d ? '#172a3a' : '#eee',
              color:      days === d ? '#fff'    : '#555',
            }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fff0ed', color: '#e76f51', marginBottom: 16, fontSize: '0.82rem' }}>
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="metric-grid" style={{ marginBottom: 24 }}>
        <article className="metric-card">
          <span>Month-to-Date</span>
          <strong>{fmt(data?.monthToDateCents)}</strong>
        </article>
        <article className="metric-card">
          <span>Period Cost ({days}d)</span>
          <strong>{fmt(periodCost)}</strong>
        </article>
        <article className="metric-card">
          <span>Model Calls ({days}d)</span>
          <strong>{loading ? '…' : String(totalCalls)}</strong>
        </article>
        <article className="metric-card">
          <span>Monthly Budget</span>
          <strong>{data?.monthlyBudgetCents ? fmt(data.monthlyBudgetCents) : 'None'}</strong>
        </article>
      </div>

      {/* Budget bar */}
      {data && data.monthlyBudgetCents > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#555', marginBottom: 6 }}>
            <span>Budget used — {budgetPct}%</span>
            <span>{fmt(data.monthToDateCents)} / {fmt(data.monthlyBudgetCents)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: '#eee' }}>
            <div style={{ height: '100%', width: `${budgetPct}%`, borderRadius: 999, transition: 'width 0.4s', background: budgetPct > 80 ? '#e76f51' : '#2a9d8f' }} />
          </div>
        </div>
      )}

      {/* Daily bar chart */}
      {data && data.dailySpend.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600 }}>Daily Spend — last {days} days</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
            {data.dailySpend.map(d => {
              const v = Number(d.totalCostCents ?? 0)
              const pct = (v / maxDaily) * 100
              return (
                <div
                  key={d.day}
                  title={`${d.day}: ${fmt(v)} (${d.taskCount ?? 0} tasks)`}
                  style={{ flex: 1, height: `${Math.max(4, pct)}%`, background: '#2a9d8f', borderRadius: '3px 3px 0 0', transition: 'height 0.3s', cursor: 'help' }}
                />
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#aaa', marginTop: 4 }}>
            <span>{data.dailySpend[0]?.day?.slice(5)}</span>
            <span>{data.dailySpend[data.dailySpend.length - 1]?.day?.slice(5)}</span>
          </div>
        </div>
      )}

      {/* Per-model table */}
      <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 600 }}>Cost by Model</h3>
      {!data || data.byModel.length === 0 ? (
        <p style={{ color: '#888', fontSize: '0.875rem' }}>{loading ? 'Loading…' : 'No model calls in this period.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(23,42,58,0.1)', textAlign: 'left' }}>
                {['Model', 'Calls', 'Input', 'Output', 'Avg Latency', 'Total Cost'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', fontWeight: 600, whiteSpace: 'nowrap', textAlign: h === 'Total Cost' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byModel.map(m => (
                <tr key={m.modelId} style={{ borderBottom: '1px solid rgba(23,42,58,0.05)' }}>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: MODEL_DOT[m.modelId] ?? '#ccc', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{m.modelId}</span>
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>{Number(m.callCount ?? 0)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmtTokens(m.totalInputTokens)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmtTokens(m.totalOutputTokens)}</td>
                  <td style={{ padding: '7px 10px' }}>{fmtMs(m.avgDurationMs)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(m.totalCostCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid rgba(23,42,58,0.12)' }}>
                <td colSpan={5} style={{ padding: '8px 10px', fontWeight: 700 }}>Total ({days}d)</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                  {fmt(periodCost)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
