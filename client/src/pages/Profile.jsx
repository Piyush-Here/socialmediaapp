import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import Avatar from '../components/Avatar'
import PostCard from '../components/PostCard'

function EditProfile({ profile, onSaved, onCancel }) {
  const { setUser } = useAuth()
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio)
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      let d = await api.patch('/users/me', { displayName, bio })
      if (file) {
        const fd = new FormData()
        fd.append('image', file)
        d = await api.post('/users/me/avatar', fd)
      }
      setUser(d.user)
      onSaved(d.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required /></label>
      <label>Bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={2} /></label>
      <label>Avatar<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function ProfileInner({ username }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get(`/users/${username}`), api.get(`/posts/user/${username}`)])
      .then(([u, p]) => {
        if (cancelled) return
        setData(u)
        setPosts(p.posts)
        setCursor(p.nextCursor)
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [username])

  async function toggleFollow() {
    try {
      const d = await (data.isFollowing ? api.del : api.post)(`/users/${username}/follow`)
      setData((x) => ({ ...x, user: d.user, isFollowing: d.isFollowing }))
    } catch (e) { setError(e.message) }
  }
  async function message() {
    try {
      const d = await api.post('/conversations', { username })
      navigate(`/messages/${d.conversation.id}`)
    } catch (e) { setError(e.message) }
  }
  async function more() {
    try {
      const p = await api.get(`/posts/user/${username}${qs({ cursor })}`)
      setPosts((ps) => [...ps, ...p.posts])
      setCursor(p.nextCursor)
    } catch (e) { setError(e.message) }
  }

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted center">Loading…</p>
  const { user: u } = data

  return (
    <div className="stack">
      <section className="card profile">
        <Avatar user={u} size={84} />
        <div className="grow">
          {editing ? (
            <EditProfile profile={u} onCancel={() => setEditing(false)} onSaved={(nu) => { setData((x) => ({ ...x, user: nu })); setEditing(false) }} />
          ) : (
            <>
              <h2>{u.displayName}</h2>
              <p className="muted">@{u.username}</p>
              {u.bio && <p>{u.bio}</p>}
              <p><strong>{u.followingCount}</strong> following · <strong>{u.followerCount}</strong> followers</p>
              <div className="row">
                {data.isMe ? (
                  <button className="btn secondary" onClick={() => setEditing(true)}>Edit profile</button>
                ) : (
                  <>
                    <button className={`btn ${data.isFollowing ? 'secondary' : ''}`} onClick={toggleFollow}>{data.isFollowing ? 'Unfollow' : 'Follow'}</button>
                    <button className="btn secondary" onClick={message}>Message</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {posts.length === 0 && <p className="muted center">No posts yet.</p>}
      {posts.map((p) => <PostCard key={p.id} post={p} onDelete={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))} />)}
      {cursor && <button className="btn secondary" onClick={more}>Load more</button>}
    </div>
  )
}

// Keyed so navigating between profiles remounts with fresh state.
export default function Profile() {
  const { username } = useParams()
  return <ProfileInner key={username} username={username} />
}
