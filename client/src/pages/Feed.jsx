import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../api'
import Avatar from '../components/Avatar'
import Composer from '../components/Composer'
import PostCard from '../components/PostCard'

function Suggestions({ onFollowed }) {
  const [users, setUsers] = useState([])
  useEffect(() => { api.get('/users/suggestions').then((d) => setUsers(d.users)).catch(() => {}) }, [])
  if (!users.length) return null
  async function follow(u) {
    try {
      await api.post(`/users/${u.username}/follow`)
      setUsers((us) => us.filter((x) => x.id !== u.id))
      onFollowed()
    } catch { /* ignore */ }
  }
  return (
    <section className="card suggestions">
      <h3>Who to follow</h3>
      {users.map((u) => (
        <div className="row" key={u.id}>
          <Avatar user={u} size={32} />
          <Link to={`/u/${u.username}`} className="grow">{u.displayName} <span className="muted">@{u.username}</span></Link>
          <button className="btn small" onClick={() => follow(u)}>Follow</button>
        </div>
      ))}
    </section>
  )
}

export default function Feed() {
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const applyPage = useCallback((d, append) => {
    setPosts((p) => (append ? [...p, ...d.posts] : d.posts))
    setCursor(d.nextCursor)
    setError('')
  }, [])

  // First page (and refetch after following someone, since that changes the feed).
  useEffect(() => {
    let cancelled = false
    api.get('/posts/feed')
      .then((d) => !cancelled && applyPage(d, false))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [applyPage, reloadKey])

  async function loadMore() {
    try {
      applyPage(await api.get(`/posts/feed${qs({ cursor })}`), true)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="stack">
      <Composer onPosted={(p) => setPosts((ps) => [p, ...ps])} />
      <Suggestions onFollowed={() => setReloadKey((k) => k + 1)} />
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted center">Loading…</p>}
      {!loading && !error && posts.length === 0 && <p className="muted center">Nothing here yet. Follow some people or write your first post.</p>}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} onDelete={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))} />
      ))}
      {cursor && <button className="btn secondary" onClick={loadMore}>Load more</button>}
    </div>
  )
}
