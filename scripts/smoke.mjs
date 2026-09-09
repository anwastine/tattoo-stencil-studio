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

import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { SignJWT } from 'jose'
import { neon } from '@neondatabase/serverless'
import { upsertUser } from '../api/_lib/db.js'

const sqlRef = neon(process.env.DATABASE_URL)

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

function mockReq({ method = 'POST', body, raw, cookie, url = '/', headers = {} }) {
  const bytes = Buffer.from(raw ?? JSON.stringify(body ?? {}))
  const req = Readable.from([bytes])
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }
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
check('lettering GET: lists scripts, moods and motifs',
  letteringGet.status === 200 &&
  Object.keys(letteringGet.json?.scripts || {}).length >= 10 &&
  (letteringGet.json?.moods || []).length >= 18 &&
  (letteringGet.json?.motifs || []).length >= 10,
  JSON.stringify({ moods: letteringGet.json?.moods?.length, motifs: letteringGet.json?.motifs?.length }))

/* Transliteration is what lets someone type "amma" instead of hunting for a
   Telugu keyboard, so a silent upstream change is worth catching. This is the
   one check that talks to a third party. */
const { default: translit } = await import('../api/translit.js')
const tl = await call(translit, { method: 'GET', url: '/api/translit?lang=telugu&text=amma' })
check('translit: converts a roman word', tl.status === 200 && (tl.json?.candidates || []).length > 0, JSON.stringify(tl.json))
check('translit: returns the target script', /[\u0C00-\u0C7F]/.test(tl.json?.candidates?.[0] || ''), tl.json?.candidates?.[0])
const tlBad = await call(translit, { method: 'GET', url: '/api/translit?lang=klingon&text=amma' })
check('translit: refuses an unknown language', tlBad.status === 400, `got ${tlBad.status}`)

/* ---------------- payments ---------------- */
/*
 * The money paths, exercised without touching Razorpay.
 *
 * Two things must hold or people lose money: a forged checkout response must
 * never add credits, and a paid order must credit exactly once however many
 * times the callback arrives — Razorpay retries webhooks, and the browser's
 * /verify call races them. Idempotency rests on one unique index; this proves
 * the index is actually doing its job.
 *
 * /verify's happy path is not testable here: after checking the signature it
 * asks Razorpay whether the money really landed, which needs the live secret.
 * The webhook does no outbound call, so crediting is tested through that.
 */

process.env.RAZORPAY_KEY_ID ||= 'rzp_test_smoke'
process.env.RAZORPAY_KEY_SECRET ||= 'smoke-key-secret'
process.env.RAZORPAY_WEBHOOK_SECRET ||= 'smoke-webhook-secret'

const { default: verifyPay } = await import('../api/payments/verify.js')
const { default: payWebhook } = await import('../api/payments/webhook.js')
const { createOrderRow, getUser } = await import('../api/_lib/db.js')

const ORDER = 'order_smoke_' + Math.random().toString(36).slice(2, 10)
const PAYMENT = 'pay_smoke_' + Math.random().toString(36).slice(2, 10)
const ORDER_CREDITS = 10

await createOrderRow({ id: ORDER, userId: user.id, credits: ORDER_CREDITS, amountPaise: ORDER_CREDITS * 900 })
const before = (await getUser(user.id)).credits

const forged = await call(verifyPay, {
  cookie,
  body: { razorpay_order_id: ORDER, razorpay_payment_id: PAYMENT, razorpay_signature: 'deadbeef'.repeat(8) },
})
check('payments: forged signature is refused', forged.status === 400 && /signature/i.test(forged.json?.error || ''), `${forged.status} ${forged.json?.error}`)
check('payments: forged signature added no credits', (await getUser(user.id)).credits === before, 'credits moved on a forged signature')

const event = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: PAYMENT, order_id: ORDER, status: 'captured' } } },
})
const sign = (raw) => crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')

const badHook = await call(payWebhook, { raw: event, headers: { 'x-razorpay-signature': sign(event + 'x') } })
check('webhook: wrong signature is refused', badHook.status === 400, `got ${badHook.status}`)
check('webhook: wrong signature added no credits', (await getUser(user.id)).credits === before, 'credits moved on a bad webhook')

const hook1 = await call(payWebhook, { raw: event, headers: { 'x-razorpay-signature': sign(event) } })
check('webhook: a captured payment is accepted', hook1.status === 200, `got ${hook1.status}`)
const afterFirst = (await getUser(user.id)).credits
check('webhook: credits the order once', afterFirst === before + ORDER_CREDITS, `${before} -> ${afterFirst}, expected +${ORDER_CREDITS}`)

const hook2 = await call(payWebhook, { raw: event, headers: { 'x-razorpay-signature': sign(event) } })
check('webhook: a retry is accepted', hook2.status === 200, `got ${hook2.status}`)
const afterRetry = (await getUser(user.id)).credits
check('webhook: a retry does not double-credit', afterRetry === afterFirst, `${afterFirst} -> ${afterRetry} on redelivery`)

/* The browser's own confirmation, arriving after the webhook already credited
   the same order — the common race. Razorpay's payment lookup is stubbed so the
   route can be driven all the way through crediting without a live secret. */
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) =>
  String(url).includes('/v1/payments/')
    ? new Response(JSON.stringify({ id: PAYMENT, order_id: ORDER, status: 'captured', amount: ORDER_CREDITS * 900 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : realFetch(url, init)

const replay = await call(verifyPay, {
  cookie,
  body: {
    razorpay_order_id: ORDER,
    razorpay_payment_id: PAYMENT,
    razorpay_signature: crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${ORDER}|${PAYMENT}`).digest('hex'),
  },
})
globalThis.fetch = realFetch

check('payments: a genuine signature is accepted', replay.status === 200, `${replay.status} ${replay.json?.error}`)
check('payments: /verify sees the order already credited', replay.json?.alreadyCredited === true && replay.json?.added === 0, JSON.stringify(replay.json))
check('payments: /verify after the webhook does not double-credit', (await getUser(user.id)).credits === afterFirst, 'credits moved when the browser confirmed an already-credited order')

/* ---------------- referrals ---------------- */
/*
 * A referral pays real credits, so it gets the same scrutiny as a payment:
 * it must fire once, only on a genuinely new account, never for yourself, and
 * never twice however many times the invited artist buys.
 */

const { attachReferrer, rewardReferrer, ensureReferralCode, referralSummary, createOrderRow: mkOrder, creditOrder, getUser: readUser } =
  await import('../api/_lib/db.js')
const { REFERRAL_CREDITS } = await import('../api/_lib/config.js')

const alice = await ensureReferralCode(
  await upsertUser({ sub: 'SMOKE-A-' + Math.random().toString(36).slice(2), email: `alice.${Date.now()}@example.invalid`, name: 'Alice', picture: null }))
check('referral: everyone gets a code', /^[A-Z0-9]{6}$/.test(alice.referral_code || ''), alice.referral_code)

const bob = await upsertUser({
  sub: 'SMOKE-B-' + Math.random().toString(36).slice(2),
  email: `bob.${Date.now()}@example.invalid`,
  name: 'Bob',
  picture: null,
  referralCode: alice.referral_code,
})
check('referral: a new account records who invited it', String(bob.referred_by) === String(alice.id), `referred_by=${bob.referred_by}`)

const self = await attachReferrer(alice, alice.referral_code)
check('referral: you cannot invite yourself', !self.ok && self.reason === 'self', JSON.stringify(self))

const again = await attachReferrer(bob, alice.referral_code)
check('referral: the referrer is only ever set once', !again.ok && again.reason === 'already-referred', JSON.stringify(again))

const bogus = await attachReferrer(bob, 'ZZZZZZ')
check('referral: an unknown code is refused', !bogus.ok && bogus.reason === 'unknown-code', JSON.stringify(bogus))

/* Bob buys. Alice should be paid exactly once, however many orders follow. */
const aliceBefore = (await readUser(alice.id)).credits
const o1 = 'order_ref1_' + Math.random().toString(36).slice(2, 8)
await mkOrder({ id: o1, userId: bob.id, credits: 10, amountPaise: 9000 })
await creditOrder({ orderId: o1, paymentId: 'pay_ref1' })
const aliceAfterFirst = (await readUser(alice.id)).credits
check('referral: the referrer is paid on the first purchase',
  aliceAfterFirst === aliceBefore + REFERRAL_CREDITS, `${aliceBefore} -> ${aliceAfterFirst}, expected +${REFERRAL_CREDITS}`)

const o2 = 'order_ref2_' + Math.random().toString(36).slice(2, 8)
await mkOrder({ id: o2, userId: bob.id, credits: 25, amountPaise: 22500 })
await creditOrder({ orderId: o2, paymentId: 'pay_ref2' })
check('referral: a second purchase does not pay again',
  (await readUser(alice.id)).credits === aliceAfterFirst, 'the referrer was paid twice')

const sum = await referralSummary(alice.id)
check('referral: the invite panel counts joined, bought and earned',
  sum.invited === 1 && sum.converted === 1 && sum.creditsEarned === REFERRAL_CREDITS, JSON.stringify(sum))

/* Below the minimum pays nothing — the threshold is the other half of the
   economics, so it needs a test of its own. */
const { REFERRAL_MIN_PURCHASE } = await import('../api/_lib/config.js')
const tooSmall = await rewardReferrer(bob.id, REFERRAL_MIN_PURCHASE - 1)
check('referral: a purchase under the minimum pays nothing',
  !tooSmall.paid && tooSmall.reason === 'below-minimum', JSON.stringify(tooSmall))

/* A purchase by someone nobody invited must pay nobody. */
const solo = await rewardReferrer(alice.id, 10)
check('referral: an uninvited buyer pays nobody', !solo.paid && solo.reason === 'not-referred', JSON.stringify(solo))

for (const u of [bob, alice]) {
  await sqlRef`DELETE FROM orders WHERE user_id = ${u.id}`
  await sqlRef`DELETE FROM ledger WHERE user_id = ${u.id}`
  await sqlRef`DELETE FROM welcome_grants WHERE user_id = ${u.id}`
  await sqlRef`UPDATE users SET referred_by = NULL WHERE id = ${u.id}`
}
await sqlRef`DELETE FROM ledger WHERE ref = ${'referral:' + bob.id}`
await sqlRef`DELETE FROM users WHERE id = ${bob.id}`
await sqlRef`DELETE FROM users WHERE id = ${alice.id}`

/* ---------------- cleanup ---------------- */

const sql = neon(process.env.DATABASE_URL)
await sql`DELETE FROM ledger WHERE user_id = ${user.id}`
await sql`DELETE FROM welcome_grants WHERE user_id = ${user.id}`
await sql`DELETE FROM users WHERE id = ${user.id}`

console.log(failures ? `\n${failures} FAILED` : '\nall smoke checks passed')
process.exit(failures ? 1 : 0)
