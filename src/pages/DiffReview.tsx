import { useState, useEffect, useCallback } from 'react'
import { trpc } from '../lib/trpc.js'

interface PendingDiff {
  id: string
  taskId: string
  filePath: string
  operation: string
  linesAdded: number
  linesRemoved: number
  flagged: boolean
  blocked: boolean
  safetyViolations: Array<{ rule: string; severity: string; message: string }>
  createdAt: string
}

function OperationBadge({ op }: { op: string }) {
  const colors: Record<string, string> = {
    create: 'bg-green-900 text-green-300',
    modify: 'bg-blue-900 text-blue-300',
    delete: 'bg-red-900 text-red-300',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[op] ?? 'bg-gray-700 text-gray-300'}`}>
      {op}
    </span>
  )
}

export default function DiffReview() {
  const [diffs, setDiffs] = useState<PendingDiff[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchDiffs = useCallback(async () => {
    try {
      const result = await trpc.diffs.getPendingForTeam.query()
      setDiffs(result as PendingDiff[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDiffs()
  }, [fetchDiffs])

  async function handleApprove(diffId: string) {
    try {
      await trpc.diffs.approve.mutate({ diffId })
      setDiffs((prev) => prev.filter((d) => d.id !== diffId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    }
  }

  async function handleReject(diffId: string) {
    try {
      await trpc.diffs.reject.mutate({ diffId })
      setDiffs((prev) => prev.filter((d) => d.id !== diffId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>
  if (error) return <div className="text-red-400">Error: {error}</div>

  const blockedCount = diffs.filter((d) => d.blocked).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Diff Review</h1>
        <span className="text-sm text-gray-400">{diffs.length} pending</span>
      </div>

      {blockedCount > 0 && (
        <div className="rounded-lg border border-red-900 bg-red-950 px-5 py-3 text-sm text-red-300">
          {blockedCount} diff{blockedCount > 1 ? 's' : ''} blocked by safety rules.
          Update project safety settings to unblock.
        </div>
      )}

      {diffs.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-12 text-center text-gray-600">
          No pending diffs
        </div>
      ) : (
        <div className="space-y-3">
          {diffs.map((diff) => (
            <div
              key={diff.id}
              className={`rounded-lg border bg-gray-900 p-4 ${
                diff.blocked ? 'border-red-900' : diff.flagged ? 'border-yellow-900' : 'border-gray-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <OperationBadge op={diff.operation} />
                  <span className="font-mono text-sm text-gray-200">{diff.filePath}</span>
                  <span className="text-xs text-gray-500">
                    <span className="text-green-500">+{diff.linesAdded}</span>
                    {' '}
                    <span className="text-red-500">-{diff.linesRemoved}</span>
                  </span>
                  <span className="font-mono text-xs text-gray-600">{diff.taskId.slice(0, 8)}</span>
                </div>

                <div className="flex items-center gap-2">
                  {diff.blocked ? (
                    <span className="rounded bg-red-900/50 px-3 py-1 text-xs text-red-400">
                      Blocked by safety rule
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApprove(diff.id)}
                        className="rounded bg-green-800 px-3 py-1 text-xs font-medium text-green-200 hover:bg-green-700 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(diff.id)}
                        className="rounded bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700 transition-colors"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              {diff.safetyViolations.length > 0 && (
                <div className="mt-2 space-y-1">
                  {diff.safetyViolations.map((v, i) => (
                    <div
                      key={i}
                      className={`text-xs ${v.severity === 'block' ? 'text-red-400' : 'text-yellow-400'}`}
                    >
                      [{v.rule}] {v.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
