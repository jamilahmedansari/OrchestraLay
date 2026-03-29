const metrics = [
  { label: 'Tasks Today', value: '0' },
  { label: 'Cost Today', value: '$0.00' },
  { label: 'Pending Diffs', value: '0' },
  { label: 'Failed Tasks', value: '0' },
]

export function Overview() {
  return (
    <section className="panel">
      <h2>Overview</h2>
      <p>The live task feed and realtime metrics will attach here once the backend routers are in place.</p>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}