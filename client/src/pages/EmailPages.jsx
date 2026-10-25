import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

function Shell({ title, children }) {
  return (
    <div className="auth">
      <div className="card auth-card">
        <h1 className="brand">Sociable</h1>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Reset your password">
      {sent ? (
        <p>If an account with that email exists, we've sent a reset link. It expires in 1 hour.</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={busy}>{busy ? '…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="muted center"><Link to="/login">Back to log in</Link></p>
    </Shell>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <Shell title="Reset your password"><p className="error">This link is missing its token. <Link to="/forgot-password">Request a new one</Link>.</p></Shell>
  return (
    <Shell title="Choose a new password">
      {done ? (
        <p>Your password has been changed. All other sessions were signed out. <Link to="/login">Log in</Link></p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
          <label>Confirm password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={busy}>{busy ? '…' : 'Change password'}</button>
          {error && /expired/i.test(error) && <Link to="/forgot-password" className="muted center">Request a new link</Link>}
        </form>
      )}
    </Shell>
  )
}

export function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { user, refresh } = useAuth()
  const [status, setStatus] = useState(token ? 'loading' : 'invalid')
  const started = useRef(false)

  // The ref guard stops React StrictMode's double-invoked effect (dev only) from spending the one-time token twice.
  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    api.post('/auth/verify-email', { token })
      .then(() => { setStatus('ok'); refresh() })
      .catch(() => setStatus('invalid'))
  }, [token, refresh])

  return (
    <Shell title="Email verification">
      {status === 'loading' && <p className="muted">Verifying…</p>}
      {status === 'ok' && <p>Your email address is verified. <Link to={user ? '/' : '/login'}>{user ? 'Continue' : 'Log in'}</Link></p>}
      {status === 'invalid' && <p className="error">This link is invalid or has expired. {user ? 'Use "Resend email" in the banner after you log in.' : <>Log in and use "Resend email". <Link to="/login">Log in</Link></>}</p>}
    </Shell>
  )
}
