import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function AuthPage({ mode }) {
  const { user, login, register } = useAuth()
  const isRegister = mode === 'register'
  const [form, setForm] = useState({ identifier: '', username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (isRegister) await register({ username: form.username, email: form.email, password: form.password })
      else await login(form.identifier, form.password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="brand">Sociable</h1>
        <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
        {isRegister ? (
          <>
            <label>Username<input value={form.username} onChange={set('username')} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" autoComplete="username" /></label>
            <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
          </>
        ) : (
          <label>Email or username<input value={form.identifier} onChange={set('identifier')} required autoComplete="username" /></label>
        )}
        <label>Password<input type="password" value={form.password} onChange={set('password')} required minLength={isRegister ? 8 : 1} autoComplete={isRegister ? 'new-password' : 'current-password'} /></label>
        {!isRegister && <Link to="/forgot-password" className="muted">Forgot password?</Link>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? '…' : isRegister ? 'Sign up' : 'Log in'}</button>
        <p className="muted center">
          {isRegister ? <>Have an account? <Link to="/login">Log in</Link></> : <>New here? <Link to="/register">Create an account</Link></>}
        </p>
      </form>
    </div>
  )
}
