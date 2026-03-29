import { Link, Route, Switch, useLocation } from 'wouter'

import { Costs } from './pages/Costs'
import { DiffReview } from './pages/DiffReview'
import { Overview } from './pages/Overview'

const navLinks = [
  { href: '/', label: 'Overview' },
  { href: '/costs', label: 'Costs' },
  { href: '/diffs', label: 'Diff Review' },
]

export function App() {
  const [location] = useLocation()

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">OrchestraLay</p>
          <h1>Route work to the cheapest model that can still finish safely.</h1>
        </div>
        <nav className="nav">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${location === link.href ? 'nav-link-active' : ''}`}
            >
              {link.label}
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
