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
    // Optional mobile number, collected once after sign-up. ADD COLUMN IF NOT
    // EXISTS keeps this safe on a database that already has rows.
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_asked BOOLEAN NOT NULL DEFAULT false`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_at TIMESTAMPTZ`
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
  u && {
    id: String(u.id),
    email: u.email,
    name: u.name,
    picture: u.picture,
    credits: u.credits,
    createdAt: u.created_at,
    phone: u.phone || null,
    // drives the one-time "join the channel" prompt
    askPhone: !u.phone && !u.phone_asked,
    isAdmin: isAdmin(u.email),
  }

/* ---------------- phone ---------------- */

/**
 * Indian mobile numbers, stored canonically as +91XXXXXXXXXX.
 * Accepts 9876543210, 09876543210, +91 98765 43210 and similar.
 * Returns null when it is not a valid Indian mobile.
 */
export function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '')
  let local = digits
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2)
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1)
  if (!/^[6-9][0-9]{9}$/.test(local)) return null
  return `+91${local}`
}

export async function savePhone(userId, phone) {
  await init()
  const rows = await client()`
    UPDATE users SET phone = ${phone}, phone_asked = true, phone_at = now()
     WHERE id = ${userId} RETURNING *`
  return rows[0] || null
}

/** They chose "not now" — don't ask again. */
export async function skipPhone(userId) {
  await init()
  const rows = await client()`
    UPDATE users SET phone_asked = true WHERE id = ${userId} RETURNING *`
  return rows[0] || null
}

/* ---------------- admin ---------------- */

/** Admins are listed in ADMIN_EMAILS, comma separated. */
export function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => emailKey(e.trim()))
    .filter(Boolean)
  if (!list.length || !email) return false
  return list.includes(emailKey(email))
}

/** Everyone who has signed up, newest first, with their activity totals. */
export async function listUsers({ limit = 500, search = '' } = {}) {
  await init()
  const sql = client()
  const like = `%${String(search).trim().toLowerCase()}%`
  const rows = search
    ? await sql`
        SELECT u.id, u.email, u.name, u.phone, u.credits, u.created_at, u.last_seen_at, u.blocked,
               COALESCE(-SUM(l.credits) FILTER (WHERE l.kind = 'spend'), 0)  AS spent,
               COALESCE( SUM(l.credits) FILTER (WHERE l.kind = 'purchase'), 0) AS bought
          FROM users u LEFT JOIN ledger l ON l.user_id = u.id
         WHERE lower(u.email) LIKE ${like} OR lower(COALESCE(u.name,'')) LIKE ${like} OR COALESCE(u.phone,'') LIKE ${like}
         GROUP BY u.id ORDER BY u.created_at DESC LIMIT ${limit}`
    : await sql`
        SELECT u.id, u.email, u.name, u.phone, u.credits, u.created_at, u.last_seen_at, u.blocked,
               COALESCE(-SUM(l.credits) FILTER (WHERE l.kind = 'spend'), 0)  AS spent,
               COALESCE( SUM(l.credits) FILTER (WHERE l.kind = 'purchase'), 0) AS bought
          FROM users u LEFT JOIN ledger l ON l.user_id = u.id
         GROUP BY u.id ORDER BY u.created_at DESC LIMIT ${limit}`
  return rows.map((r) => ({
    id: String(r.id),
    email: r.email,
    name: r.name,
    phone: r.phone,
    credits: r.credits,
    spent: Number(r.spent),
    bought: Number(r.bought),
    joined: r.created_at,
    lastSeen: r.last_seen_at,
    blocked: r.blocked,
  }))
}

export async function adminStats() {
  await init()
  const sql = client()
  const [u] = await sql`
    SELECT count(*) AS users,
           count(*) FILTER (WHERE phone IS NOT NULL) AS with_phone,
           count(*) FILTER (WHERE created_at > now() - interval '7 days') AS new_week,
           COALESCE(sum(credits), 0) AS credits_held
      FROM users`
  const [l] = await sql`
    SELECT COALESCE(-sum(credits) FILTER (WHERE kind = 'spend'), 0) AS stencils,
           COALESCE( sum(credits) FILTER (WHERE kind = 'purchase'), 0) AS credits_sold
      FROM ledger`
  const [o] = await sql`
    SELECT COALESCE(sum(amount_paise) FILTER (WHERE status = 'paid'), 0) AS paise,
           count(*) FILTER (WHERE status = 'paid') AS orders
      FROM orders`
  return {
    users: Number(u.users),
    withPhone: Number(u.with_phone),
    newThisWeek: Number(u.new_week),
    creditsHeld: Number(u.credits_held),
    stencilsDrawn: Number(l.stencils),
    creditsSold: Number(l.credits_sold),
    paidOrders: Number(o.orders),
    revenueRupees: Number(o.paise) / 100,
  }
}

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
 *
 * That index is partial (rows with a ref only), so ON CONFLICT has to repeat the
 * same WHERE predicate — Postgres will not pick a partial index as the conflict
 * arbiter otherwise, and the insert fails outright instead of doing nothing.
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
    ON CONFLICT (kind, ref) WHERE ref IS NOT NULL DO NOTHING
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
