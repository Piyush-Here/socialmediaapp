import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import { useRealtime } from '../realtime'
import { timeAgo } from '../util'

function Thread({ convo }) {
  const { user } = useAuth()
  const { socket, refreshCounts } = useRealtime()
  const [messages, setMessages] = useState([])
  const [older, setOlder] = useState(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const id = convo.id

  // De-duplicates: our own message arrives both from the POST response and the socket echo.
  const addMessage = useCallback((m) => setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m])), [])

  const markRead = useCallback(() => api.post(`/conversations/${id}/read`).then(refreshCounts).catch(() => {}), [id, refreshCounts])

  useEffect(() => {
    let cancelled = false
    api.get(`/conversations/${id}/messages?limit=30`)
      .then((d) => { if (!cancelled) { setMessages(d.messages); setOlder(d.nextCursor); markRead() } })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [id, markRead])

  useEffect(() => {
    if (!socket) return
    const onMsg = (m) => {
      if (m.conversation !== id) return
      addMessage(m)
      if (m.sender !== user.id) markRead()
    }
    const onRead = (e) => {
      if (e.conversation === id) setMessages((ms) => ms.map((m) => (m.sender === user.id && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m)))
    }
    socket.on('message:new', onMsg)
    socket.on('message:read', onRead)
    return () => { socket.off('message:new', onMsg); socket.off('message:read', onRead) }
  }, [socket, id, user.id, addMessage, markRead])

  // Scroll only when the NEWEST message changes (initial load, send, receive), not when older ones are prepended.
  const lastId = messages[messages.length - 1]?.id
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])

  async function loadOlder() {
    try {
      const d = await api.get(`/conversations/${id}/messages${qs({ cursor: older, limit: 30 })}`)
      setMessages((ms) => [...d.messages, ...ms])
      setOlder(d.nextCursor)
    } catch (e) { setError(e.message) }
  }
  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError('')
    try {
      const d = await api.post(`/conversations/${id}/messages`, { text: body })
      addMessage(d.message)
      setText('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <section className="card thread">
      <header className="thread-head">
        <Avatar user={convo.other} size={32} />
        <Link to={`/u/${convo.other.username}`} className="name">{convo.other.displayName}</Link>
      </header>
      <div className="messages">
        {older && <button className="link center" onClick={loadOlder}>Load earlier messages</button>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.sender === user.id ? 'mine' : ''}`} title={timeAgo(m.createdAt)}>{m.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="row" onSubmit={send}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Message…" autoFocus />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  )
}

export default function Messages() {
  const { conversationId } = useParams()
  const { socket, refreshCounts } = useRealtime()
  const [convos, setConvos] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api.get('/conversations').then((d) => setConvos(d.conversations)).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load, conversationId])
  useEffect(() => {
    if (!socket) return
    // Refresh the sidebar on any new message / read receipt (lists are tiny: max 50).
    const refresh = () => { load(); refreshCounts() }
    socket.on('message:new', refresh)
    return () => socket.off('message:new', refresh)
  }, [socket, load, refreshCounts])

  const active = convos?.find((c) => c.id === conversationId)

  if (error) return <p className="error">{error}</p>
  return (
    <div className="messages-layout">
      <aside className="card convo-list">
        <h3>Messages</h3>
        {convos === null && <p className="muted">Loading…</p>}
        {convos?.length === 0 && <p className="muted">No conversations yet. Open a profile and press Message.</p>}
        {convos?.map((c) => (
          <Link key={c.id} to={`/messages/${c.id}`} className={`convo ${c.id === conversationId ? 'active' : ''}`}>
            <Avatar user={c.other} size={36} />
            <span className="grow">
              <strong>{c.other.displayName}</strong>
              <span className="muted clip">{c.lastMessage?.text ?? 'No messages yet'}</span>
            </span>
            {c.unread > 0 && <span className="badge">{c.unread}</span>}
          </Link>
        ))}
      </aside>
      {active ? <Thread key={active.id} convo={active} /> : <section className="card thread empty muted">{conversationId && convos ? 'Conversation not found.' : 'Select a conversation'}</section>}
    </div>
  )
}
