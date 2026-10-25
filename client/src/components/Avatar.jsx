export default function Avatar({ user, size = 40 }) {
  const style = { width: size, height: size, fontSize: size * 0.42 }
  if (user.avatar) return <img className="avatar" src={user.avatar} alt="" style={style} />
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {(user.displayName || user.username)[0].toUpperCase()}
    </span>
  )
}
