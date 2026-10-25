import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../api'
import Avatar from '../components/Avatar'
import { useRealtime } from '../realtime'
import { timeAgo } from '../util'

const TEXT = { like: 'liked your post', comment: 'commented on your post', follow: 'started following you' }

export default function Notifications() {
  const { socket, refreshCounts } = useRealtime()
  const [items, setItems] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.get('/notifications')
      .then(async (d) => {
        if (cancelled) return
        setItems(d.notifications)
        setCursor(d.nextCursor)
        await api.post('/notifications/read-all')
        refreshCounts()
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [refreshCounts])

  // New notifications arriving while this page is open are shown live and marked read.
  useEffect(() => {
    if (!socket) return
    const onNew = (n) => { setItems((it) => (it ? [n, ...it] : it)); api.post('/notifications/read-all').then(refreshCounts).catch(() => {}) }
    socket.on('notification:new', onNew)
    return () => socket.off('notification:new', onNew)
  }, [socket, refreshCounts])

  async function more() {
    try {
      const d = await api.get(`/notifications${qs({ cursor })}`)
      setItems((it) => [...it, ...d.notifications])
      setCursor(d.nextCursor)
    } catch (e) { setError(e.message) }
  }

  if (error) return <p className="error">{error}</p>
  if (!items) return <p className="muted center">Loading…</p>
  return (
    <div className="stack">
      <h2>Notifications</h2>
      {items.length === 0 && <p className="muted center">Nothing yet.</p>}
      {items.map((n) => (
        <Link key={n.id} className={`card notif ${n.read ? '' : 'unread'}`} to={n.post ? `/p/${n.post}` : `/u/${n.actor.username}`}>
          <Avatar user={n.actor} size={36} />
          <span className="grow"><strong>{n.actor.displayName}</strong> {TEXT[n.type]}</span>
          <span className="muted">{timeAgo(n.createdAt)}</span>
        </Link>
      ))}
      {cursor && <button className="btn secondary" onClick={more}>Load more</button>}
    </div>
  )
}
