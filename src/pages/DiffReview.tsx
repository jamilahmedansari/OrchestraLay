import { trpc } from '../lib/trpc'

const operationColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  modify: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
}

function DiffState({ message }: { message: string }) {
  return (
    <section className="panel">
      <h2>Diff Review</h2>
      <p>{message}</p>
    </section>
  )
}

export function DiffReview() {
  const pendingDiffs = trpc.diffs.getPendingForTeam.useQuery({ limit: 50 })
  const approveMutation = trpc.diffs.approve.useMutation({
    onSuccess: () => pendingDiffs.refetch(),
  })
  const rejectMutation = trpc.diffs.reject.useMutation({
    onSuccess: () => pendingDiffs.refetch(),
  })
  const approveAllMutation = trpc.diffs.approveAll.useMutation({
    onSuccess: () => pendingDiffs.refetch(),
  })

  const diffList = pendingDiffs.data ?? []
  const hasBlocked = diffList.some((d) => d.blocked)

  if (pendingDiffs.isLoading) {
    return <DiffState message="Loading pending diffs..." />
  }

  if (pendingDiffs.error) {
    return <DiffState message="Diff review is unavailable until the dashboard is authenticated." />
  }

  return (
    <section className="panel panel-stack">
      <div className="panel-header-row">
        <div>
          <h2>Diff Review</h2>
          <p className="muted-copy">Pending changes with safety rule context attached.</p>
        </div>
        <button
          onClick={() => approveAllMutation.mutate({ skipFlagged: false })}
          disabled={diffList.length === 0 || approveAllMutation.isPending}
          className="action-button"
        >
          Approve All Safe
        </button>
      </div>

      {hasBlocked && (
        <div className="warning-banner">
          Some diffs are blocked by safety rules. Update project safety settings to unblock them.
        </div>
      )}

      <div className="diff-list">
        {diffList.map((diff) => (
          <article
            key={diff.id}
            className="diff-card"
          >
            <div className="diff-card-header">
              <div>
                <span
                  className={`operation-badge ${operationColors[diff.operation] ?? 'operation-badge'}`}
                >
                  {diff.operation}
                </span>
                <h3>{diff.filePath}</h3>
              </div>
              <div className="diff-stats">
                <span>+{diff.linesAdded}</span>
                <span>-{diff.linesRemoved}</span>
              </div>
            </div>

            <div className="violation-list">
              {(diff.safetyViolations as Array<{ rule: string; severity: 'warn' | 'block'; message: string }> | null)?.length ? (
                (diff.safetyViolations as Array<{ rule: string; severity: 'warn' | 'block'; message: string }>).map((violation) => (
                  <span
                    key={`${diff.id}-${violation.rule}`}
                    className={`violation-pill violation-${violation.severity}`}
                  >
                    {violation.rule}
                  </span>
                ))
              ) : (
                <span className="violation-pill violation-safe">safe</span>
              )}
            </div>

            <div className="diff-actions">
              <button
                onClick={() => approveMutation.mutate({ diffId: diff.id })}
                disabled={diff.blocked || approveMutation.isPending}
                className="action-button"
              >
                {diff.blocked ? 'Blocked by Safety Rule' : 'Approve'}
              </button>
              <button
                onClick={() => rejectMutation.mutate({ diffId: diff.id })}
                disabled={rejectMutation.isPending}
                className="action-button action-button-secondary"
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
