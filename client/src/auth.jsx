/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  // The session cookie is shared by every tab of this browser profile. If another tab logs in as a
  // different user (or the session expires), this tab's in-memory user goes stale and its requests
  // would silently run as someone else. Re-verify whenever the tab becomes active.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    const check = () => {
      if (document.visibilityState !== 'visible') return
      api.get('/auth/me')
        .then((d) => { if (d.user.id !== userId) window.location.reload() })
        .catch((e) => { if (e.status === 401) setUser(null) }) // ignore network errors
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [userId])

  const refresh = useCallback(
    () => api.get('/auth/me').then((d) => setUser(d.user)).catch(() => {}),
    [],
  )

  const login = useCallback(async (identifier, password) => {
    const d = await api.post('/auth/login', { identifier, password })
    setUser(d.user)
  }, [])
  const register = useCallback(async (form) => {
    const d = await api.post('/auth/register', form)
    setUser(d.user)
  }, [])
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, setUser, loading, login, register, logout, refresh }), [user, loading, login, register, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
