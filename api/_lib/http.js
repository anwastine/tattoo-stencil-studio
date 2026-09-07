/* Tiny helpers shared by every function. Raw Node req/res — no framework. */

export function send(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(obj))
}

export async function readJson(req, limitBytes = 12 * 1024 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limitBytes) throw httpError('Request too large', 413)
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** Raw body as a Buffer — webhooks must verify the bytes, not a re-serialised object. */
export async function readRaw(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

/** Strip credentials and long base64 blobs out of anything we log. */
export const redact = (s) =>
  String(s || '')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, '$1***@')
    .replace(/\b(sk-|rzp_[a-z]+_|AIza)[A-Za-z0-9_-]{6,}/g, '$1***')
    .slice(0, 400)

export const httpError = (message, status = 500) => Object.assign(new Error(message), { status })

export function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header) return {}
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    out[k] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie')
  const list = prev ? (Array.isArray(prev) ? [...prev, cookie] : [prev, cookie]) : [cookie]
  res.setHeader('Set-Cookie', list)
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

/** Wrap a handler so thrown errors become clean JSON instead of a 500 crash. */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (e) {
      const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500
      // Postgres errors embed the whole connection URL, password included, so
      // log a redacted line rather than the error object.
      if (status >= 500) console.error('api_error', { name: e?.name, message: redact(e?.message) })
      if (!res.writableEnded) send(res, status, { error: e?.message || 'Server error' })
    }
  }
}

export function methods(req, allowed) {
  if (!allowed.includes(req.method)) throw httpError(`${req.method} not allowed`, 405)
}
