import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import Avatar from './Avatar'

export default function Composer({ onPosted }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pick(e) {
    const f = e.target.files[0]
    if (!f) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setError('Use a JPEG, PNG or WebP image')
    if (f.size > 5 * 1024 * 1024) return setError('Image must be under 5 MB')
    setError('')
    setFile(f)
  }
  function clearFile() {
    setFile(null)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() && !file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('text', text)
      if (file) fd.append('image', file)
      const d = await api.post('/posts', fd)
      setText('')
      clearFile()
      onPosted(d.post)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card composer" onSubmit={submit}>
      <Avatar user={user} />
      <div className="grow">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} placeholder="What's happening?" />
        {preview && (
          <div className="preview">
            <img src={preview} alt="Selected upload preview" />
            <button type="button" className="link" onClick={clearFile}>Remove</button>
          </div>
        )}
        <div className="row">
          <label className="link">
            📷 Photo
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
          </label>
          <span className="muted push">{text.length}/500</span>
          <button className="btn" disabled={busy || (!text.trim() && !file)}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </form>
  )
}
