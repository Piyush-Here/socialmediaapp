import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { timeAgo } from '../util'
import Avatar from './Avatar'

export default function PostCard({ post: initial, onDelete, linkToPost = true }) {
  const { user } = useAuth()
  const [post, setPost] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function toggleLike() {
    if (busy) return
    setBusy(true)
    setError('')
    const was = post.likedByMe
    setPost((p) => ({ ...p, likedByMe: !was, likeCount: p.likeCount + (was ? -1 : 1) })) // optimistic
    try {
      const d = await (was ? api.del : api.post)(`/posts/${post.id}/like`)
      setPost((p) => ({ ...p, likedByMe: d.likedByMe, likeCount: d.likeCount }))
    } catch (e) {
      setPost((p) => ({ ...p, likedByMe: was, likeCount: p.likeCount + (was ? 1 : -1) }))
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Delete this post?')) return
    try {
      await api.del(`/posts/${post.id}`)
      onDelete?.(post.id)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <article className="card post">
      <Link to={`/u/${post.author.username}`}><Avatar user={post.author} /></Link>
      <div className="post-body">
        <header className="post-head">
          <Link to={`/u/${post.author.username}`} className="name">{post.author.displayName}</Link>
          <span className="muted">@{post.author.username} · {timeAgo(post.createdAt)}</span>
          {user.id === post.author.id && (
            <button className="link danger push" onClick={remove}>Delete</button>
          )}
        </header>
        {post.text && <p className="post-text">{post.text}</p>}
        {post.image && <img className="post-img" src={post.image} alt="" loading="lazy" />}
        <footer className="post-actions">
          <button className={`link ${post.likedByMe ? 'liked' : ''}`} onClick={toggleLike} aria-pressed={post.likedByMe}>
            {post.likedByMe ? '♥' : '♡'} {post.likeCount}
          </button>
          {linkToPost ? (
            <Link to={`/p/${post.id}`} className="link">💬 {post.commentCount}</Link>
          ) : (
            <span className="muted">💬 {post.commentCount}</span>
          )}
        </footer>
        {error && <p className="error">{error}</p>}
      </div>
    </article>
  )
}
