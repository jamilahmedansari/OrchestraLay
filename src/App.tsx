import { Link, Route, Switch } from 'wouter'

import { Costs } from './pages/Costs'
import { DiffReview } from './pages/DiffReview'
import { Overview } from './pages/Overview'

const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/costs', label: 'Costs' },
  { href: '/diffs', label: 'Diff Review' },
]

export function App() {
  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">OrchestraLay</p>
          <h1>AI orchestration with explicit cost and diff control.</h1>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="page-shell">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/costs" component={Costs} />
          <Route path="/diffs" component={DiffReview} />
        </Switch>
      </main>
    </div>
  )
}