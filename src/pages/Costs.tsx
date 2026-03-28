import { useState, useEffect } from 'react'
import { trpc } from '../lib/trpc.js'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MODEL_COLORS: Record<string, string> = {
  'claude-3-5-sonnet': '#3b82f6',
  'claude-3-haiku': '#60a5fa',
  'gpt-4o': '#14b8a6',
  'gpt-4o-mini': '#5eead4',
  'perplexity-sonar-pro': '#f59e0b',
  'perplexity-sonar': '#fbbf24',
}

interface CostsData {
  budget: {
    monthlyBudgetCents: number
    currentSpendCents: number
    billingPeriod: string
  } | null
  dailyCosts: Array<{
    date: string
    modelName: string
    totalCents: number
    totalTokens: number
    requestCount: number
  }>
  modelBreakdown: Array<{
    modelName: string
    provider: string
    totalCents: number
    totalTokens: number
    requestCount: number
  }>
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function BudgetBar({ budget }: { budget: CostsData['budget'] }) {
  if (!budget) return null

  const pct = Math.min((budget.currentSpendCents / budget.monthlyBudgetCents) * 100, 100)
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm text-gray-400">Month-to-date ({budget.billingPeriod})</span>
        <span className="text-sm text-gray-300">
          {formatCents(budget.currentSpendCents)} / {formatCents(budget.monthlyBudgetCents)}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-800">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right text-xs text-gray-500">{pct.toFixed(1)}%</div>
    </div>
  )
}

export default function Costs() {
  const [data, setData] = useState<CostsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    trpc.dashboard.getCosts.query({ days: 7 })
      .then((result) => setData(result as CostsData))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [])

  if (error) return <div className="text-red-400">Error: {error}</div>
  if (!data) return <div className="text-gray-500">Loading...</div>

  // Build chart data grouped by date
  const dates = [...new Set(data.dailyCosts.map((d) => d.date))].sort()
  const models = [...new Set(data.dailyCosts.map((d) => d.modelName))]

  const chartData = {
    labels: dates,
    datasets: models.map((model) => ({
      label: model,
      data: dates.map((date) => {
        const entry = data.dailyCosts.find((d) => d.date === date && d.modelName === model)
        return entry ? Number(entry.totalCents) / 100 : 0
      }),
      backgroundColor: MODEL_COLORS[model] ?? '#6b7280',
    })),
  }

  const totalSpend = data.modelBreakdown.reduce((sum, m) => sum + Number(m.totalCents), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Costs</h1>

      <BudgetBar budget={data.budget} />

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-gray-300">7-day spend by model</h2>
        <div className="h-64">
          <Bar
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  stacked: true,
                  ticks: { color: '#6b7280' },
                  grid: { display: false },
                },
                y: {
                  stacked: true,
                  ticks: { color: '#6b7280', callback: (v) => `$${v}` },
                  grid: { color: '#1f2937' },
                },
              },
              plugins: {
                legend: { labels: { color: '#9ca3af' } },
              },
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-300">Model breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-500">
              <th className="px-5 py-2 font-medium">Model</th>
              <th className="px-5 py-2 font-medium">Requests</th>
              <th className="px-5 py-2 font-medium">Tokens</th>
              <th className="px-5 py-2 font-medium">Cost</th>
              <th className="px-5 py-2 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.modelBreakdown.map((m) => (
              <tr key={m.modelName} className="border-b border-gray-800/50">
                <td className="px-5 py-2 text-gray-300">{m.modelName}</td>
                <td className="px-5 py-2 text-gray-400">{Number(m.requestCount)}</td>
                <td className="px-5 py-2 text-gray-400">{Number(m.totalTokens).toLocaleString()}</td>
                <td className="px-5 py-2 text-gray-300">{formatCents(Number(m.totalCents))}</td>
                <td className="px-5 py-2 text-gray-500">
                  {totalSpend > 0 ? `${((Number(m.totalCents) / totalSpend) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
            {data.modelBreakdown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-600">
                  No cost data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
