import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import PostCard from '../components/PostCard'
import { timeAgo } from '../util'

function PostInner({ id }) {
  const { user } = useAuth()
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get(`/posts/${id}`), api.get(`/posts/${id}/comments?limit=50`)])
      .then(([p, c]) => { if (!cancelled) { setPost(p.post); setComments(c.comments) } })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [id])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const d = await api.post(`/posts/${id}/comments`, { text })
      setComments((c) => [...c, d.comment])
      setPost((p) => ({ ...p, commentCount: p.commentCount + 1 }))
      setText('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function remove(c) {
    try {
      await api.del(`/posts/${id}/comments/${c.id}`)
      setComments((cs) => cs.filter((x) => x.id !== c.id))
      setPost((p) => ({ ...p, commentCount: p.commentCount - 1 }))
    } catch (err) { setError(err.message) }
  }

  if (error && !post) return <p className="error">{error} <Link to="/">Back home</Link></p>
  if (!post) return <p className="muted center">Loading…</p>
  return (
    <div className="stack">
      <PostCard key={post.commentCount} post={post} linkToPost={false} onDelete={() => window.history.back()} />
      <form className="card composer" onSubmit={submit}>
        <Avatar user={user} size={32} />
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Write a comment…" />
        <button className="btn" disabled={busy || !text.trim()}>Reply</button>
      </form>
      {error && <p className="error">{error}</p>}
      {comments.map((c) => (
        <div className="card comment" key={c.id}>
          <Avatar user={c.author} size={32} />
          <div className="grow">
            <Link to={`/u/${c.author.username}`} className="name">{c.author.displayName}</Link>{' '}
            <span className="muted">{timeAgo(c.createdAt)}</span>
            <p className="post-text">{c.text}</p>
          </div>
          {c.author.id === user.id && <button className="link danger" onClick={() => remove(c)}>Delete</button>}
        </div>
      ))}
    </div>
  )
}
export default function PostPage() {
  const { id } = useParams()
  return <PostInner key={id} id={id} />
}
