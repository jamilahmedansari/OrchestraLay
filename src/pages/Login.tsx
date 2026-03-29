import { useState } from 'react'
import { setToken } from '../lib/trpc'
import { trpc } from '../lib/trpc'

export function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setLocalToken] = useState('')
  const [error, setError]      = useState<string | null>(null)
  const [loading, setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const t = token.trim()
    if (!t) { setError('Token is required'); return }
    if (!t.startsWith('eyJ') && !t.startsWith('olay_')) {
      setError('Must be a Supabase JWT (eyJ…) or an API key (olay_…)')
      return
    }

    setLoading(true)
    try {
      // Store token so the tRPC client picks it up, then verify with health call
      setToken(t)
      await trpc.health.query({})
      onLogin()
    } catch (e: unknown) {
      setToken('')
      setError(e instanceof Error ? e.message : 'Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        width: '100%', maxWidth: 440, padding: '40px 36px',
        borderRadius: 28, background: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(23,42,58,0.1)', backdropFilter: 'blur(12px)',
      }}>
        <p className="eyebrow" style={{ margin: '0 0 8px' }}>OrchestraLay</p>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.8rem', lineHeight: 1.2 }}>Sign in</h1>
        <p style={{ margin: '0 0 28px', color: '#666', fontSize: '0.875rem' }}>
          Paste your Supabase JWT or API key to access the dashboard.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
            Token
          </label>
          <textarea
            value={token}
            onChange={e => setLocalToken(e.target.value)}
            placeholder="eyJ… or olay_…"
            rows={4}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12,
              border: '1px solid rgba(23,42,58,0.2)', fontFamily: 'monospace',
              fontSize: '0.78rem', resize: 'vertical', outline: 'none',
              background: '#fafafa', boxSizing: 'border-box',
            }}
          />

          {error && (
            <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 10, background: '#fff0ed', color: '#e76f51', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 18, width: '100%', padding: 12, borderRadius: 999,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: '#172a3a', color: '#fff', fontWeight: 700, fontSize: '0.95rem',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: '0.78rem', color: '#999', lineHeight: 1.6 }}>
          Get a JWT: Dashboard → Auth → Users → Copy JWT<br />
          Get an API key: Dashboard → Auth → Create API Key
        </p>
      </div>
    </div>
  )
}
