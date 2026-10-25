/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import { api } from './api'
import { useAuth } from './auth'

const RealtimeContext = createContext(null)
export const useRealtime = () => useContext(RealtimeContext)

export function RealtimeProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id
  const [socket, setSocket] = useState(null)
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 })

  const refreshCounts = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([api.get('/notifications/unread-count'), api.get('/conversations/unread-count')])
      setCounts({ notifications: n.count, messages: m.count })
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!userId) return
    const s = io({ transports: ['websocket', 'polling'] })
    s.on('notification:new', () => setCounts((c) => ({ ...c, notifications: c.notifications + 1 })))
    s.on('message:new', (m) => {
      if (m.sender !== userId) setCounts((c) => ({ ...c, messages: c.messages + 1 }))
    })
    // After a reconnect we may have missed events, so resync from the server.
    s.on('connect', refreshCounts)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s)
    return () => {
      s.close()
      setSocket(null)
      setCounts({ notifications: 0, messages: 0 })
    }
  }, [userId, refreshCounts])

  const value = useMemo(() => ({ socket, counts, refreshCounts }), [socket, counts, refreshCounts])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
