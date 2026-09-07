/*
 * Postgres (Neon over HTTP) — users, credit ledger and payment orders.
 *
 * The schema creates itself on first use, so adding the database to the Vercel
 * project is the only setup step; there is no migration to run.
 *
 * Env: DATABASE_URL (injected automatically by the Vercel ↔ Neon integration;
 * POSTGRES_URL / NEON_DATABASE_URL are accepted as aliases).
 */

import { neon } from '@neondatabase/serverless'
import { httpError } from './http.js'
import { WELCOME_CREDITS, LIMITS } from './config.js'

const URL_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING']

export const databaseConfigured = () => URL_KEYS.some((k) => !!process.env[k])

let _sql = null
function client() {
  if (_sql) return _sql
  const url = URL_KEYS.map((k) => process.env[k]).find(Boolean)
  if (!url) throw httpError('No database configured. Add a Postgres database to the Vercel project (Storage → Neon) so accounts and credits can be stored.', 503)
  _sql = neon(url)
  return _sql
}

/* ---------------- schema ---------------- */

let ready = null
export function init() {
  if (ready) return ready
  const sql = client()
  ready = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        email_key TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        credits INTEGER NOT NULL DEFAULT 0,
        generating_since TIMESTAMPTZ,
        blocked BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS users_email_key_idx ON users (email_key)`
    // One welcome bonus per real mailbox, not per Google account row.
    await sql`
      CREATE TABLE IF NOT EXISTS welcome_grants (
        email_key TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`
      CREATE TABLE IF NOT EXISTS ledger (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        credits INTEGER NOT NULL,
        ref TEXT,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS ledger_user_time_idx ON ledger (user_id, created_at DESC)`
    // Makes crediting a payment idempotent: the same order can only ever be credited once.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ledger_kind_ref_idx ON ledger (kind, ref) WHERE ref IS NOT NULL`
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credits INTEGER NOT NULL,
        amount_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        payment_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ
      )`
    await sql`CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC)`
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}

/* ---------------- users ---------------- */

/**
 * Gmail treats "a.b+tag@gmail.com" and "ab@gmail.com" as the same mailbox, so
 * the welcome bonus is keyed on the normalised form.
 */
export function emailKey(email) {
  const raw = String(email || '').trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  if (at < 0) return raw
  let local = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus >= 0) local = local.slice(0, plus)
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replaceAll('.', '')
  return `${local}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`
}

/** Find or create the user for a verified Google profile; grant the bonus once. */
export async function upsertUser({ sub, email, name, picture }) {
  await init()
  const sql = client()
  const key = emailKey(email)
  const rows = await sql`
    INSERT INTO users (google_sub, email, email_key, name, picture)
    VALUES (${sub}, ${email}, ${key}, ${name || null}, ${picture || null})
    ON CONFLICT (google_sub) DO UPDATE
      SET email = EXCLUDED.email,
          email_key = EXCLUDED.email_key,
          name = COALESCE(EXCLUDED.name, users.name),
          picture = COALESCE(EXCLUDED.picture, users.picture),
          last_seen_at = now()
    RETURNING *`
  let user = rows[0]

  // Welcome bonus: only if this mailbox has never had one.
  const claimed = await sql`
    INSERT INTO welcome_grants (email_key, user_id)
    VALUES (${key}, ${user.id})
    ON CONFLICT (email_key) DO NOTHING
    RETURNING email_key`
  if (claimed.length) {
    const updated = await sql`
      UPDATE users SET credits = credits + ${WELCOME_CREDITS} WHERE id = ${user.id} RETURNING *`
    user = updated[0]
    await sql`
      INSERT INTO ledger (user_id, kind, credits, ref, meta)
      VALUES (${user.id}, 'welcome', ${WELCOME_CREDITS}, ${'welcome:' + key}, ${JSON.stringify({ email: user.email })})
      ON CONFLICT DO NOTHING`
  }
  return user
}

export async function getUser(id) {
  await init()
  const rows = await client()`SELECT * FROM users WHERE id = ${id}`
  return rows[0] || null
}

export const publicUser = (u) =>
  u && { id: String(u.id), email: u.email, name: u.name, picture: u.picture, credits: u.credits, createdAt: u.created_at }

/* ---------------- credits ---------------- */

/**
 * Atomically take `cost` credits and claim the one-generation-at-a-time slot.
 * A single UPDATE, so concurrent requests cannot both succeed on the last credit.
 * Returns { ok, credits } or { ok: false, reason }.
 */
export async function spendCredits(userId, cost, meta = {}) {
  await init()
  const sql = client()
  const rows = await sql`
    UPDATE users
       SET credits = credits - ${cost},
           generating_since = now()
     WHERE id = ${userId}
       AND blocked = false
       AND credits >= ${cost}
       AND (generating_since IS NULL OR generating_since < now() - interval '10 minutes')
    RETURNING credits`
  if (!rows.length) {
    const u = await getUser(userId)
    if (!u) return { ok: false, reason: 'no_user' }
    if (u.blocked) return { ok: false, reason: 'blocked' }
    if (u.credits < cost) return { ok: false, reason: 'insufficient', credits: u.credits }
    return { ok: false, reason: 'busy', credits: u.credits }
  }
  await sql`
    INSERT INTO ledger (user_id, kind, credits, meta)
    VALUES (${userId}, 'spend', ${-cost}, ${JSON.stringify(meta)})`
  return { ok: true, credits: rows[0].credits }
}

/** Give the credits back when the generation itself failed. */
export async function refundCredits(userId, cost, meta = {}) {
  await init()
  const sql = client()
  const rows = await sql`
    UPDATE users SET credits = credits + ${cost}, generating_since = NULL
     WHERE id = ${userId} RETURNING credits`
  await sql`
    INSERT INTO ledger (user_id, kind, credits, meta)
    VALUES (${userId}, 'refund', ${cost}, ${JSON.stringify(meta)})`
  return rows[0]?.credits ?? null
}

export async function releaseSlot(userId) {
  await init()
  await client()`UPDATE users SET generating_since = NULL WHERE id = ${userId}`
}

/** Per-user rate limit over the spend ledger. */
export async function checkRateLimit(userId) {
  await init()
  const sql = client()
  const rows = await sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS hour,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')  AS day
    FROM ledger WHERE user_id = ${userId} AND kind = 'spend'`
  const hour = Number(rows[0]?.hour || 0)
  const day = Number(rows[0]?.day || 0)
  if (hour >= LIMITS.generationsPerHour) return { ok: false, reason: `Hourly limit reached (${LIMITS.generationsPerHour}). Try again later.` }
  if (day >= LIMITS.generationsPerDay) return { ok: false, reason: `Daily limit reached (${LIMITS.generationsPerDay}). Try again tomorrow.` }
  return { ok: true }
}

/* ---------------- orders / purchases ---------------- */

export async function createOrderRow({ id, userId, credits, amountPaise }) {
  await init()
  await client()`
    INSERT INTO orders (id, user_id, credits, amount_paise)
    VALUES (${id}, ${userId}, ${credits}, ${amountPaise})
    ON CONFLICT (id) DO NOTHING`
}

export async function getOrder(id) {
  await init()
  const rows = await client()`SELECT * FROM orders WHERE id = ${id}`
  return rows[0] || null
}

/**
 * Credit a paid order exactly once. The unique (kind, ref) ledger index is the
 * guard: a replayed callback or a webhook racing the browser cannot double-credit.
 * Returns { credited, credits }.
 */
export async function creditOrder({ orderId, paymentId }) {
  await init()
  const sql = client()
  const order = await getOrder(orderId)
  if (!order) throw httpError('Unknown order', 404)

  const claim = await sql`
    INSERT INTO ledger (user_id, kind, credits, ref, meta)
    VALUES (${order.user_id}, 'purchase', ${order.credits}, ${orderId}, ${JSON.stringify({ paymentId, amountPaise: order.amount_paise })})
    ON CONFLICT (kind, ref) DO NOTHING
    RETURNING id`

  if (!claim.length) {
    const u = await getUser(order.user_id)
    return { credited: false, credits: u?.credits ?? null, userId: String(order.user_id) }
  }
  const rows = await sql`
    UPDATE users SET credits = credits + ${order.credits} WHERE id = ${order.user_id} RETURNING credits`
  await sql`
    UPDATE orders SET status = 'paid', payment_id = ${paymentId}, paid_at = now() WHERE id = ${orderId}`
  return { credited: true, credits: rows[0]?.credits ?? null, userId: String(order.user_id), addedCredits: order.credits }
}

export async function recentLedger(userId, limit = 20) {
  await init()
  const rows = await client()`
    SELECT kind, credits, created_at FROM ledger
     WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`
  return rows.map((r) => ({ kind: r.kind, credits: r.credits, at: r.created_at }))
}
