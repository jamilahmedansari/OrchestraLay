import { trpc } from '../lib/trpc'

const operationColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  modify: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
}

export default function DiffReview() {
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

  return (
    <div className="space-y-4">
      {/* Warning Banner */}
      {hasBlocked && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 text-sm font-medium">
            Some diffs are blocked by safety rules. Update project safety settings to unblock them.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          Pending Diffs ({diffList.length})
        </h2>
        <button
          onClick={() => approveAllMutation.mutate({ skipFlagged: false })}
          disabled={diffList.length === 0 || approveAllMutation.isPending}
          className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve All Safe
        </button>
      </div>

      {/* Diff List */}
      <div className="space-y-2">
        {diffList.map((diff) => (
          <div
            key={diff.id}
            className={`bg-white rounded-lg border p-4 ${
              diff.blocked
                ? 'border-red-200'
                : diff.flagged
                  ? 'border-yellow-200'
                  : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    operationColors[diff.operation] ?? 'bg-gray-100'
                  }`}
                >
                  {diff.operation}
                </span>
                <span className="font-mono text-sm">{diff.filePath}</span>
                <span className="text-xs text-gray-500">
                  <span className="text-green-600">+{diff.linesAdded}</span>{' '}
                  <span className="text-red-600">-{diff.linesRemoved}</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                {diff.blocked ? (
                  <span className="text-xs text-red-600 font-medium px-3 py-1.5 bg-red-50 rounded">
                    Blocked by safety rule
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => approveMutation.mutate({ diffId: diff.id })}
                      disabled={approveMutation.isPending}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate({ diffId: diff.id })}
                      disabled={rejectMutation.isPending}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Safety violations */}
            {diff.safetyViolations && (diff.safetyViolations as Array<{ rule: string; severity: string; message: string }>).length > 0 && (
              <div className="mt-2 space-y-1">
                {(diff.safetyViolations as Array<{ rule: string; severity: string; message: string }>).map((v, i) => (
                  <div
                    key={i}
                    className={`text-xs px-2 py-1 rounded ${
                      v.severity === 'block'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-yellow-50 text-yellow-600'
                    }`}
                  >
                    [{v.rule}] {v.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {diffList.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            No pending diffs. All clear!
          </div>
        )}
      </div>
    </div>
  )
}
