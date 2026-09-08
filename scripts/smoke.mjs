/*
 * Smoke test for the API handlers.
 *
 * Runs each handler in-process with a real signed session and a deliberately
 * malformed image, so the request reaches body parsing and input validation.
 * That is the exact path that broke once when a shared helper was refactored
 * out from under a route: `readJson` went missing, every call threw, and the
 * catch reported it as "Invalid JSON" — which looked like a client problem.
 *
 * No credit is spent and no image model is called: validation rejects the
 * payload before either happens.
 *
 *   node --env-file=.env.local scripts/smoke.mjs
 */

import { Readable } from 'node:stream'
import { SignJWT } from 'jose'
import { neon } from '@neondatabase/serverless'
import { upsertUser } from '../api/_lib/db.js'

const SUB = 'SMOKE-' + Math.random().toString(36).slice(2)
const EMAIL = `smoke.${Date.now()}@example.invalid`

let failures = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : ' FAIL ') + name + (!ok && detail ? ` — ${detail}` : ''))
  if (!ok) failures++
}

/* The real key lives only in Vercel production. Validation rejects the payload
   long before any model is called, so a placeholder is enough to get past the
   "is the service configured" gate. */
process.env.OPENAI_API_KEY ||= 'placeholder-for-smoke-test'

function mockReq({ method = 'POST', body, cookie, url = '/' }) {
  const raw = Buffer.from(JSON.stringify(body ?? {}))
  const req = Readable.from([raw])
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    writableEnded: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    end(s) { this.body = s; this.writableEnded = true },
  }
  return res
}

async function call(handler, opts) {
  const res = mockRes()
  await handler(mockReq(opts), res)
  let json = null
  try { json = JSON.parse(res.body) } catch { /* non-JSON body */ }
  return { status: res.statusCode, json, raw: res.body }
}

/* ---------------- setup ---------------- */

const user = await upsertUser({ sub: SUB, email: EMAIL, name: 'Smoke Test', picture: null })
const token = await new SignJWT({ email: user.email, name: user.name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(String(user.id))
  .setIssuedAt()
  .setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET))
const cookie = `tss_session=${token}`

const { default: stencil } = await import('../api/stencil.js')
const { default: lettering } = await import('../api/lettering.js')
const { default: config } = await import('../api/config.js')
const { default: me } = await import('../api/auth/me.js')

/* ---------------- signed out ---------------- */

for (const [name, h] of [['stencil', stencil], ['lettering', lettering]]) {
  const r = await call(h, { body: { image: 'x' } })
  check(`${name}: signed out is refused`, r.status === 401 && r.json?.signInRequired === true, `got ${r.status}`)
}

/* ---------------- signed in, bad payload ---------------- */
/* Reaching "image must be a data URL" proves body parsing ran. If a helper
   goes missing again this comes back as 400 "Invalid JSON" instead. */

for (const [name, h] of [['stencil', stencil], ['lettering', lettering]]) {
  const r = await call(h, { cookie, body: { image: 'not-a-data-url' } })
  const parsed = r.json?.error !== 'Invalid JSON'
  check(`${name}: request body parses`, parsed, r.json?.error)
  check(`${name}: rejects a bad image`, r.status === 400 && /data URL/i.test(r.json?.error || ''), `${r.status} ${r.json?.error}`)
}

/* ---------------- GET endpoints ---------------- */

const cfg = await call(config, { method: 'GET', cookie })
check('config: returns ready flags', cfg.status === 200 && typeof cfg.json?.ready === 'object', `got ${cfg.status}`)
check('config: no secrets leak', !/sk-|rzp_(live|test)_[A-Za-z0-9]{10,}|SESSION_SECRET/.test(cfg.raw || ''), 'response contained a secret-looking value')

const whoami = await call(me, { method: 'GET', cookie })
check('auth/me: identifies the session', whoami.status === 200 && whoami.json?.user?.email === EMAIL, `got ${whoami.status}`)

const stencilGet = await call(stencil, { method: 'GET' })
check('stencil GET: reports model', stencilGet.status === 200 && !!stencilGet.json?.model, `got ${stencilGet.status}`)

const letteringGet = await call(lettering, { method: 'GET' })
check('lettering GET: lists scripts and moods',
  letteringGet.status === 200 && Object.keys(letteringGet.json?.scripts || {}).length >= 10 && (letteringGet.json?.moods || []).length === 6)

/* ---------------- cleanup ---------------- */

const sql = neon(process.env.DATABASE_URL)
await sql`DELETE FROM ledger WHERE user_id = ${user.id}`
await sql`DELETE FROM welcome_grants WHERE user_id = ${user.id}`
await sql`DELETE FROM users WHERE id = ${user.id}`

console.log(failures ? `\n${failures} FAILED` : '\nall smoke checks passed')
process.exit(failures ? 1 : 0)
