import { Route, Switch, Link, useLocation } from 'wouter'
import Overview from './pages/Overview.js'
import Costs from './pages/Costs.js'
import DiffReview from './pages/DiffReview.js'

const NAV_ITEMS = [
  { path: '/', label: 'Overview' },
  { path: '/costs', label: 'Costs' },
  { path: '/diffs', label: 'Diff Review' },
]

export default function App() {
  const [location] = useLocation()

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-3">
          <span className="text-lg font-bold text-white">OrchestraLay</span>
          <div className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  location === item.path
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/costs" component={Costs} />
          <Route path="/diffs" component={DiffReview} />
          <Route>
            <div className="text-center text-gray-500">Page not found</div>
          </Route>
        </Switch>
      </main>
    </div>
  )
}
