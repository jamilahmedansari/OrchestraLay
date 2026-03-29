import { trpc } from '../lib/trpc'

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function timeAgo(date: Date | string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function OverviewState({ message }: { message: string }) {
  return (
    <section className="panel">
      <h2>Overview</h2>
      <p>{message}</p>
    </section>
  )
}

export function Overview() {
  const overview = trpc.dashboard.getOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  })

  if (overview.isLoading) {
    return <OverviewState message="Loading team activity and spend..." />
  }

  if (overview.error || !overview.data) {
    return (
      <OverviewState message="Dashboard data is unavailable. Store a dashboard JWT in localStorage under orchestralay.auth.token to authenticate this view." />
    )
  }

  const { metrics, recentTasks, team } = overview.data
  const cards = [
    { label: 'Tasks Today', value: String(metrics.tasksToday) },
    { label: 'Cost Today', value: formatMoney(metrics.costTodayCents) },
    { label: 'Saved Today', value: formatMoney(metrics.directSavingsTodayCents) },
    { label: 'Pending Diffs', value: String(metrics.pendingDiffs) },
    { label: 'Failed Today', value: String(metrics.failedToday) },
  ]

  return (
    <section className="panel panel-stack">
      <div className="panel-header-row">
        <div>
          <h2>Overview</h2>
          <p className="muted-copy">
            Team plan {team?.plan ?? 'unknown'} with {formatMoney(team?.currentMonthSpendCents ?? 0)} spent this month.
          </p>
        </div>
      </div>

      <div className="metric-grid metric-grid-wide">
        {cards.map((card) => (
          <article key={card.label} className="metric-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>

      <div className="table-shell">
        <div className="table-header">
          <h3>Live Task Feed</h3>
          <p className="muted-copy">Recent routed work with measured spend and savings.</p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Prompt</th>
              <th>Status</th>
              <th>Model</th>
              <th>Spend</th>
              <th>Saved</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {recentTasks.map((task) => (
              <tr>
                <td>
                  <div className="table-primary">{task.prompt.slice(0, 84)}</div>
                  <div className="table-secondary">{task.taskType.replace(/_/g, ' ')}</div>
                </td>
                <td>
                  <span className={`status-pill status-${task.status}`}>{task.status}</span>
                </td>
                <td>{task.selectedModel ?? 'routing'}</td>
                <td>{formatMoney(task.actualCostCents ?? 0)}</td>
                <td>{formatMoney(task.metadata?.directSavingsCents ?? 0)}</td>
                <td>{timeAgo(task.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
