import { useEffect, useState } from 'react'
import { trpc } from '../lib/trpc'

type SafetyViolation = { rule: string; severity: 'warn' | 'block'; description?: string }

type DiffRow = {
  diff: {
    id: string
    filePath: string
    operation: string
    unifiedDiff: string | null
    safetyViolations: SafetyViolation[]
    status: string
    flagged: boolean
    blocked: boolean
    linesAdded: number
    linesRemoved: number
  }
  taskId: string
  taskType: string
}

const OP_COLOR: Record<string, string> = { create: '#2a9d8f', modify: '#457b9d', delete: '#e76f51' }

function OpBadge({ op }: { op: string }) {
  return (
    <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: OP_COLOR[op] ?? '#aaa', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
      {op}
    </span>
  )
}

function SafetyPill({ v }: { v: SafetyViolation }) {
  return (
    <span title={v.description} style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, background: v.severity === 'block' ? '#e76f51' : '#e9c46a', color: v.severity === 'block' ? '#fff' : '#333', flexShrink: 0 }}>
      {v.severity === 'block' ? '🚫' : '⚠️'} {v.rule}
    </span>
  )
}

function DiffViewer({ unified }: { unified: string }) {
  return (
    <pre style={{ margin: 0, fontSize: '0.72rem', lineHeight: 1.55, overflowX: 'auto', maxHeight: 320, padding: '12px 14px', background: '#0d1117', borderRadius: 10, color: '#c9d1d9' }}>
      {unified.split('\n').map((line, i) => {
        let color = '#c9d1d9'
        if      (line.startsWith('+') && !line.startsWith('+++')) color = '#7ee787'
        else if (line.startsWith('-') && !line.startsWith('---')) color = '#f85149'
        else if (line.startsWith('@@'))                            color = '#79c0ff'
        else if (line.startsWith('---') || line.startsWith('+++')) color = '#8b949e'
        return <span key={i} style={{ display: 'block', color }}>{line || ' '}</span>
      })}
    </pre>
  )
}

export function DiffReview() {
  const [rows, setRows]      = useState<DiffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]    = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [acting, setActing]  = useState<Set<string>>(new Set())

  async function load() {
    try {
      const res = await trpc.diffs.listPending.query({ limit: 100 })
      setRows(res as DiffRow[])
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load diffs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function startActing(id: string) { setActing(prev => new Set(prev).add(id)) }
  function stopActing(id: string)  { setActing(prev => { const n = new Set(prev); n.delete(id); return n }) }

  async function approve(diffId: string) {
    startActing(diffId)
    try { await trpc.diffs.approve.mutate({ diffId }); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Approve failed') }
    finally { stopActing(diffId) }
  }

  async function reject(diffId: string) {
    startActing(diffId)
    try { await trpc.diffs.reject.mutate({ diffId }); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Reject failed') }
    finally { stopActing(diffId) }
  }

  async function approveAll(taskId: string, diffIds: string[]) {
    startActing(taskId)
    try {
      await Promise.all(diffIds.map(diffId => trpc.diffs.approve.mutate({ diffId })))
      await load()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Approve all failed') }
    finally { stopActing(taskId) }
  }

  // Group by taskId
  const grouped: Record<string, DiffRow[]> = {}
  for (const r of rows) {
    if (!grouped[r.taskId]) grouped[r.taskId] = []
    grouped[r.taskId].push(r)
  }

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Diff Review</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: '#888' }}>{rows.length} pending</span>
          <button onClick={load} style={{ padding: '5px 14px', borderRadius: 999, border: 'none', background: '#eee', cursor: 'pointer', fontSize: '0.78rem' }}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fff0ed', color: '#e76f51', marginBottom: 16, fontSize: '0.82rem' }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#888', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
          ✅ No pending diffs — all caught up.
        </div>
      )}

      {Object.entries(grouped).map(([taskId, taskDiffs]) => {
        const hasBlocked     = taskDiffs.some(d => d.diff.status === 'blocked' || d.diff.blocked)
        const approvableIds  = taskDiffs.filter(d => !d.diff.blocked && d.diff.status === 'pending').map(d => d.diff.id)
        const taskType       = taskDiffs[0]?.taskType ?? ''

        return (
          <div key={taskId} style={{ marginBottom: 20, border: '1px solid rgba(23,42,58,0.1)', borderRadius: 16, overflow: 'hidden' }}>

            {/* Task header */}
            <div style={{ padding: '10px 16px', background: 'rgba(23,42,58,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#999' }}>{taskId.slice(0, 8)}…</span>
                <span style={{ fontSize: '0.8rem', color: '#2a9d8f', fontWeight: 600 }}>{taskType.replace('_', ' ')}</span>
                <span style={{ fontSize: '0.78rem', color: '#888' }}>{taskDiffs.length} file{taskDiffs.length !== 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={() => approveAll(taskId, approvableIds)}
                disabled={approvableIds.length === 0 || acting.has(taskId)}
                style={{
                  padding: '5px 14px', borderRadius: 999, border: 'none',
                  cursor: approvableIds.length === 0 ? 'not-allowed' : 'pointer',
                  background: approvableIds.length === 0 ? '#eee' : '#2a9d8f',
                  color: approvableIds.length === 0 ? '#aaa' : '#fff',
                  fontSize: '0.78rem', fontWeight: 600,
                }}
                title={hasBlocked ? 'Some diffs are blocked by safety rules' : undefined}
              >
                {acting.has(taskId) ? 'Approving…' : `Approve All (${approvableIds.length})`}
              </button>
            </div>

            {/* Diffs */}
            {taskDiffs.map(r => {
              const d          = r.diff
              const isBlocked  = d.blocked || d.status === 'blocked'
              const isExpanded = expanded.has(d.id)
              const isActing   = acting.has(d.id)
              const violations = (d.safetyViolations ?? []) as SafetyViolation[]

              return (
                <div key={d.id} style={{ borderTop: '1px solid rgba(23,42,58,0.07)' }}>
                  <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <OpBadge op={d.operation} />

                    <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.filePath}
                    </span>

                    <span style={{ fontSize: '0.7rem', color: '#2a9d8f', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      +{d.linesAdded} −{d.linesRemoved}
                    </span>

                    {violations.map(v => <SafetyPill key={v.rule} v={v} />)}

                    <button onClick={() => toggleExpand(d.id)}
                      style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(23,42,58,0.15)', background: '#fff', cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {isExpanded ? 'Hide' : 'Diff'}
                    </button>

                    <button
                      onClick={() => approve(d.id)}
                      disabled={isBlocked || isActing}
                      style={{ padding: '3px 12px', borderRadius: 999, border: 'none', cursor: isBlocked ? 'not-allowed' : 'pointer', background: isBlocked ? '#eee' : '#2a9d8f', color: isBlocked ? '#aaa' : '#fff', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {isActing ? '…' : 'Approve'}
                    </button>

                    <button
                      onClick={() => reject(d.id)}
                      disabled={isActing}
                      style={{ padding: '3px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', background: '#f8e8e6', color: '#e76f51', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Reject
                    </button>
                  </div>

                  {isBlocked && (
                    <div style={{ margin: '0 14px 10px', padding: '7px 12px', borderRadius: 8, background: '#fff0ed', color: '#e76f51', fontSize: '0.78rem' }}>
                      🚫 Blocked — update project safety rules to allow this change.
                    </div>
                  )}

                  {isExpanded && d.unifiedDiff && (
                    <div style={{ padding: '0 14px 14px' }}>
                      <DiffViewer unified={d.unifiedDiff} />
                    </div>
                  )}

                  {isExpanded && !d.unifiedDiff && (
                    <div style={{ padding: '0 14px 14px', color: '#888', fontSize: '0.78rem' }}>
                      No unified diff available for this change.
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
