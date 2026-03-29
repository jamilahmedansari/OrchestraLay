import { useEffect, useState } from 'react'
import { trpc } from '../lib/trpc'

type SafetyFlag = { rule: string; description: string; severity: 'warn' | 'block' }

type Diff = {
  diff: {
    id: string
    filePath: string
    operation: string
    unifiedDiff: string
    safetyFlags: SafetyFlag[]
    status: string
    reviewedAt: Date | null
    appliedAt: Date | null
  }
  taskId: string
  taskType: string
}

function OperationBadge({ op }: { op: string }) {
  const colors: Record<string, string> = { create: '#2a9d8f', modify: '#457b9d', delete: '#e76f51' }
  return (
    <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: colors[op] ?? '#aaa', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {op}
    </span>
  )
}

function SafetyBadge({ flag }: { flag: SafetyFlag }) {
  const bg = flag.severity === 'block' ? '#e76f51' : '#e9c46a'
  const color = flag.severity === 'block' ? '#fff' : '#333'
  return (
    <span title={flag.description} style={{ padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, background: bg, color, marginRight: 6 }}>
      {flag.severity === 'block' ? '🚫' : '⚠️'} {flag.rule}
    </span>
  )
}

function DiffHunk({ unified }: { unified: string }) {
  const lines = unified.split('\n')
  return (
    <pre style={{ margin: 0, fontSize: '0.75rem', lineHeight: 1.5, overflowX: 'auto', maxHeight: 300, padding: '12px', background: '#0d1117', borderRadius: 8, color: '#c9d1d9' }}>
      {lines.map((line, i) => {
        let color = '#c9d1d9'
        if (line.startsWith('+') && !line.startsWith('+++')) color = '#7ee787'
        else if (line.startsWith('-') && !line.startsWith('---')) color = '#f85149'
        else if (line.startsWith('@@')) color = '#79c0ff'
        else if (line.startsWith('---') || line.startsWith('+++')) color = '#8b949e'
        return <span key={i} style={{ display: 'block', color }}>{line}</span>
      })}
    </pre>
  )
}

export function DiffReview() {
  const [diffs, setDiffs] = useState<Diff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [acting, setActing] = useState<Set<string>>(new Set())

  async function load() {
    try {
      const result = await trpc.diffs.listPending.query({ limit: 50 })
      setDiffs(result as Diff[])
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load diffs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function approve(diffId: string) {
    setActing((prev) => new Set(prev).add(diffId))
    try {
      await trpc.diffs.approve.mutate({ diffId })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setActing((prev) => { const n = new Set(prev); n.delete(diffId); return n })
    }
  }

  async function reject(diffId: string) {
    setActing((prev) => new Set(prev).add(diffId))
    try {
      await trpc.diffs.reject.mutate({ diffId })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setActing((prev) => { const n = new Set(prev); n.delete(diffId); return n })
    }
  }

  async function approveAll(taskId: string) {
    setActing((prev) => new Set(prev).add(taskId))
    try {
      await trpc.diffs.approveAll.mutate({ taskId })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Approve all failed')
    } finally {
      setActing((prev) => { const n = new Set(prev); n.delete(taskId); return n })
    }
  }

  // Group diffs by taskId
  const grouped: Record<string, Diff[]> = {}
  for (const d of diffs) {
    if (!grouped[d.taskId]) grouped[d.taskId] = []
    grouped[d.taskId].push(d)
  }

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Diff Review</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.82rem', color: '#666' }}>{diffs.length} pending</span>
          <button onClick={load} style={{ padding: '6px 14px', borderRadius: 999, border: 'none', background: '#eee', cursor: 'pointer', fontSize: '0.8rem' }}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#fff0ed', color: '#e76f51', marginBottom: 20, fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#888', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && diffs.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>
          ✅ No pending diffs. All caught up.
        </div>
      )}

      {Object.entries(grouped).map(([taskId, taskDiffs]) => {
        const hasBlocked = taskDiffs.some((d) => d.diff.status === 'blocked')
        const taskType = taskDiffs[0]?.taskType ?? ''
        return (
          <div key={taskId} style={{ marginBottom: 24, border: '1px solid rgba(23,42,58,0.1)', borderRadius: 16, overflow: 'hidden' }}>
            {/* Task header */}
            <div style={{ padding: '12px 16px', background: 'rgba(23,42,58,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#666' }}>{taskId.slice(0, 8)}…</span>
                <span style={{ fontSize: '0.82rem', color: '#2a9d8f', fontWeight: 600 }}>{taskType.replace('_', ' ')}</span>
                <span style={{ fontSize: '0.8rem', color: '#666' }}>{taskDiffs.length} file{taskDiffs.length !== 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={() => approveAll(taskId)}
                disabled={hasBlocked || acting.has(taskId)}
                style={{
                  padding: '6px 16px', borderRadius: 999, border: 'none', cursor: hasBlocked ? 'not-allowed' : 'pointer',
                  background: hasBlocked ? '#eee' : '#2a9d8f', color: hasBlocked ? '#aaa' : '#fff', fontSize: '0.8rem', fontWeight: 600,
                }}
                title={hasBlocked ? 'Some diffs are blocked by safety rules' : 'Approve all diffs for this task'}
              >
                {acting.has(taskId) ? 'Approving…' : 'Approve All'}
              </button>
            </div>

            {/* Each diff */}
            {taskDiffs.map((d) => {
              const isBlocked = d.diff.status === 'blocked'
              const isExpanded = expanded.has(d.diff.id)
              const isActing = acting.has(d.diff.id)
              const flags = (d.diff.safetyFlags ?? []) as SafetyFlag[]

              return (
                <div key={d.diff.id} style={{ borderTop: '1px solid rgba(23,42,58,0.07)' }}>
                  {/* Diff row */}
                  <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <OperationBadge op={d.diff.operation} />
                    <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.diff.filePath}
                    </span>
                    {flags.map((f) => <SafetyBadge key={f.rule} flag={f} />)}
                    <button
                      onClick={() => toggleExpand(d.diff.id)}
                      style={{ padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(23,42,58,0.15)', background: '#fff', cursor: 'pointer', fontSize: '0.78rem' }}
                    >
                      {isExpanded ? 'Hide diff' : 'View diff'}
                    </button>
                    <button
                      onClick={() => approve(d.diff.id)}
                      disabled={isBlocked || isActing}
                      style={{
                        padding: '4px 14px', borderRadius: 999, border: 'none', cursor: isBlocked ? 'not-allowed' : 'pointer',
                        background: isBlocked ? '#eee' : '#2a9d8f', color: isBlocked ? '#aaa' : '#fff', fontSize: '0.78rem', fontWeight: 600,
                      }}
                    >
                      {isActing ? '…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => reject(d.diff.id)}
                      disabled={isActing}
                      style={{ padding: '4px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', background: '#f8e8e6', color: '#e76f51', fontSize: '0.78rem', fontWeight: 600 }}
                    >
                      Reject
                    </button>
                  </div>

                  {/* Blocked banner */}
                  {isBlocked && (
                    <div style={{ margin: '0 16px 10px', padding: '8px 14px', borderRadius: 10, background: '#fff0ed', color: '#e76f51', fontSize: '0.8rem' }}>
                      🚫 Blocked by safety rule — change project safety settings to approve.
                    </div>
                  )}

                  {/* Unified diff */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 16px' }}>
                      <DiffHunk unified={d.diff.unifiedDiff} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
