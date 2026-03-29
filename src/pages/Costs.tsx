import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

import { trpc } from '../lib/trpc'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MODEL_COLORS = ['#17344f', '#1f7a8c', '#ed7d3a', '#4d9078', '#d95d39', '#9b6b43']

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function CostsState({ message }: { message: string }) {
  return (
    <section className="panel">
      <h2>Costs</h2>
      <p>{message}</p>
    </section>
  )
}

export function Costs() {
  const costs = trpc.dashboard.getCosts.useQuery({ days: 7 })

  if (costs.isLoading) {
    return <CostsState message="Loading spend and savings data..." />
  }

  if (costs.error || !costs.data) {
    return <CostsState message="Cost data is unavailable until the dashboard is authenticated." />
  }

  const { dailyCosts, modelBreakdown, monthToDateCents, budgetCents, billingPeriod, totalSavingsCents } =
    costs.data
  const budgetPercent = budgetCents > 0 ? Math.min((monthToDateCents / budgetCents) * 100, 100) : 0
  const dates = [...new Set(dailyCosts.map((d) => d.date))].sort()
  const models = [...new Set(dailyCosts.map((d) => d.modelName))]
  const chartData = {
    labels: dates,
    datasets: models.map((model, index) => ({
      label: model,
      data: dates.map((date) => {
        const entry = dailyCosts.find((d) => d.date === date && d.modelName === model)
        return entry ? Number(entry.totalCostCents) : 0
      }),
      backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length],
      borderRadius: 10,
    })),
  }
  const totalCostWindow = modelBreakdown.reduce((sum, row) => sum + Number(row.totalCostCents), 0)

  return (
    <section className="panel panel-stack">
      <div className="panel-header-row">
        <div>
          <h2>Costs</h2>
          <p className="muted-copy">Billing period {billingPeriod}</p>
        </div>
        <div className="cost-summary-strip">
          <div>
            <span>Spent</span>
            <strong>{formatMoney(monthToDateCents)}</strong>
          </div>
          <div>
            <span>Saved</span>
            <strong>{formatMoney(totalSavingsCents)}</strong>
          </div>
        </div>
      </div>

      <div className="budget-card">
        <div className="budget-copy-row">
          <div>
            <h3>Month-to-Date Budget</h3>
            <p className="muted-copy">Usage against your monthly team cap.</p>
          </div>
          <strong>{budgetCents > 0 ? `${budgetPercent.toFixed(0)}%` : 'No cap'}</strong>
        </div>
        <div className="budget-bar">
          <div className="budget-fill" style={{ width: `${budgetPercent}%` }} />
        </div>
      </div>

      <div className="chart-shell">
        <Bar
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { stacked: true },
              y: {
                stacked: true,
                ticks: {
                  callback: (value) => formatMoney(Number(value)),
                },
              },
            },
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.dataset.label}: ${formatMoney(Number(context.parsed.y ?? 0))}`,
                },
              },
            },
          }}
        />
      </div>

      <div className="table-shell">
        <div className="table-header">
          <h3>Model Breakdown</h3>
          <p className="muted-copy">Requests, token volume, and spend by model over the selected window.</p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Requests</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {modelBreakdown.map((row) => {
              const pct = totalCostWindow > 0 ? (Number(row.totalCostCents) / totalCostWindow) * 100 : 0
              return (
                <tr key={row.modelName}>
                  <td>{row.modelName}</td>
                  <td>{row.provider}</td>
                  <td>{row.requestCount}</td>
                  <td>{Number(row.totalTokens).toLocaleString()}</td>
                  <td>{formatMoney(Number(row.totalCostCents))}</td>
                  <td>{pct.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
