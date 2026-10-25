async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) {
    opts.body = body
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`/api${url}`, opts)
  } catch {
    throw new Error('Network error — is the server reachable?')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data.code
    throw err
  }
  return data
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
}

export function qs(params) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') s.set(k, v)
  const str = s.toString()
  return str ? `?${str}` : ''
}
