import { useMemo } from 'react'
import { trpc } from '../lib/trpc'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const MODEL_COLORS: Record<string, string> = {
  'claude-3-5-sonnet': '#3B82F6',
  'claude-3-haiku': '#60A5FA',
  'gpt-4o': '#14B8A6',
  'gpt-4o-mini': '#5EEAD4',
  'perplexity-sonar-pro': '#F59E0B',
  'perplexity-sonar': '#FCD34D',
}

export default function Costs() {
  const costs = trpc.dashboard.getCosts.useQuery({ days: 7 })
  const { dailyCosts, modelBreakdown, monthToDateCents, budgetCents, billingPeriod } =
    costs.data ?? {
      dailyCosts: [],
      modelBreakdown: [],
      monthToDateCents: 0,
      budgetCents: 0,
      billingPeriod: '',
    }

  const budgetPercent = budgetCents > 0 ? Math.min((monthToDateCents / budgetCents) * 100, 100) : 0

  // Build chart data
  const chartData = useMemo(() => {
    const dates = [...new Set(dailyCosts.map((d) => d.date))].sort()
    const models = [...new Set(dailyCosts.map((d) => d.modelName))]

    return {
      labels: dates,
      datasets: models.map((model) => ({
        label: model,
        data: dates.map((date) => {
          const entry = dailyCosts.find((d) => d.date === date && d.modelName === model)
          return entry ? Number(entry.totalCostCents) / 100 : 0
        }),
        backgroundColor: MODEL_COLORS[model] ?? '#9CA3AF',
      })),
    }
  }, [dailyCosts])

  return (
    <div className="space-y-6">
      {/* Budget Progress */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold">
            Month-to-Date ({billingPeriod})
          </h2>
          <span className="text-sm text-gray-500">
            ${(monthToDateCents / 100).toFixed(2)} / ${(budgetCents / 100).toFixed(2)}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              budgetPercent >= 100
                ? 'bg-red-500'
                : budgetPercent >= 80
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
            }`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
        {budgetPercent >= 80 && (
          <p
            className={`text-sm mt-1 ${
              budgetPercent >= 100 ? 'text-red-600' : 'text-yellow-600'
            }`}
          >
            {budgetPercent >= 100
              ? 'Budget exceeded!'
              : `${budgetPercent.toFixed(0)}% of budget used`}
          </p>
        )}
      </div>

      {/* 7-day Stacked Bar Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-semibold mb-4">7-Day Spend Breakdown</h2>
        {dailyCosts.length > 0 ? (
          <Bar
            data={chartData}
            options={{
              responsive: true,
              scales: {
                x: { stacked: true },
                y: {
                  stacked: true,
                  ticks: { callback: (v) => `$${v}` },
                },
              },
              plugins: {
                tooltip: {
                  callbacks: {
                    label: (ctx) => `${ctx.dataset.label}: $${(ctx.parsed.y ?? 0).toFixed(4)}`,
                  },
                },
              },
            }}
          />
        ) : (
          <p className="text-gray-400 text-center py-8">No cost data yet.</p>
        )}
      </div>

      {/* Model Breakdown Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Model Breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Model</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Requests</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Tokens</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Cost</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {modelBreakdown.map((row) => {
              const totalCost = modelBreakdown.reduce(
                (sum, r) => sum + Number(r.totalCostCents),
                0
              )
              const pct = totalCost > 0 ? (Number(row.totalCostCents) / totalCost) * 100 : 0
              return (
                <tr key={row.modelName}>
                  <td className="px-4 py-2 font-medium">{row.modelName}</td>
                  <td className="px-4 py-2 text-right">{row.requestCount}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {Number(row.totalTokens).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    ${(Number(row.totalCostCents) / 100).toFixed(4)}
                  </td>
                  <td className="px-4 py-2 text-right">{pct.toFixed(1)}%</td>
                </tr>
              )
            })}
            {modelBreakdown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No cost data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
