import { Route, Switch, Link, useLocation } from 'wouter'
import Overview from './pages/Overview'
import Costs from './pages/Costs'
import DiffReview from './pages/DiffReview'

const navLinks = [
  { href: '/', label: 'Overview' },
  { href: '/costs', label: 'Costs' },
  { href: '/diffs', label: 'Diff Review' },
]

export default function App() {
  const [location] = useLocation()

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-gray-900">OrchestraLay</h1>
            <div className="flex gap-1">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  <span
                    className={`px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                      location === link.href
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {link.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/costs" component={Costs} />
          <Route path="/diffs" component={DiffReview} />
        </Switch>
      </main>
    </div>
  )
}
