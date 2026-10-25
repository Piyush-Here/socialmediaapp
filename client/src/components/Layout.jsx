import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import { useRealtime } from '../realtime'
import Avatar from './Avatar'

function Search() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    const term = q.trim()
    if (!term) return
    let cancelled = false
    const t = setTimeout(() => {
      api.get(`/users/search${qs({ q: term })}`).then((d) => !cancelled && setResults(d.users)).catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  const shown = q.trim() ? results : []
  return (
    <div className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" maxLength={30} aria-label="Search people" />
      {shown.length > 0 && (
        <ul className="card dropdown">
          {shown.map((u) => (
            <li key={u.id}>
              <button className="dropdown-item" onClick={() => { setQ(''); setResults([]); navigate(`/u/${u.username}`) }}>
                <Avatar user={u} size={28} /> <span>{u.displayName} <span className="muted">@{u.username}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VerifyBanner() {
  const { user } = useAuth()
  const [state, setState] = useState({ busy: false, msg: '', error: false })
  if (user.emailVerified) return null
  async function resend() {
    setState({ busy: true, msg: '', error: false })
    try {
      await api.post('/auth/resend-verification')
      setState({ busy: false, msg: 'Verification email sent.', error: false })
    } catch (e) {
      setState({ busy: false, msg: e.message, error: true })
    }
  }
  return (
    <div className="banner" role="status">
      <span>Please verify your email address{user.email ? <> (<strong>{user.email}</strong>)</> : null} — check your inbox for the link.</span>
      <button className="btn small secondary" onClick={resend} disabled={state.busy}>Resend email</button>
      {state.msg && <span className={state.error ? 'error' : 'muted'}>{state.msg}</span>}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { counts, refreshCounts } = useRealtime()
  useEffect(() => { refreshCounts() }, [refreshCounts])
  const badge = (n) => (n > 0 ? <span className="badge">{n > 99 ? '99+' : n}</span> : null)

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Sociable</Link>
        <Search />
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/messages">Messages{badge(counts.messages)}</NavLink>
          <NavLink to="/notifications">Alerts{badge(counts.notifications)}</NavLink>
          <NavLink to={`/u/${user.username}`}>Profile</NavLink>
          <button className="link" onClick={logout}>Log out</button>
        </nav>
      </header>
      <VerifyBanner />
      <main className="container"><Outlet /></main>
    </>
  )
}
