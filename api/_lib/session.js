/*
 * Google ID-token verification + our own signed session cookie.
 *
 * The session cookie holds only the user id (and a display snapshot). The
 * credit balance is never trusted from the cookie — it is read from the
 * database on every spend, so an edited cookie cannot buy anything.
 *
 * Env: GOOGLE_CLIENT_ID (also exposed to the browser via /api/config),
 *      SESSION_SECRET (any long random string; generate with `openssl rand -hex 32`)
 */

import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose'
import { httpError, parseCookies, appendCookie } from './http.js'
import { getUser } from './db.js'

export const COOKIE = 'tss_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days
const secureFlag = () => (process.env.VERCEL ? '; Secure' : '')

export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID
export const sessionConfigured = () => !!process.env.SESSION_SECRET

function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw httpError('SESSION_SECRET is not set on the server.', 503)
  return new TextEncoder().encode(s)
}

/* ---------------- Google ---------------- */

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/** Verify the ID token the browser got from Google Identity Services. */
export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw httpError('GOOGLE_CLIENT_ID is not set on the server.', 503)
  if (typeof idToken !== 'string' || idToken.length < 20) throw httpError('Missing Google credential', 400)
  let payload
  try {
    ;({ payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      algorithms: ['RS256'], // pin: without this an attacker can try algorithm confusion
      maxTokenAge: '1h',
    }))
  } catch (e) {
    throw httpError(`Google sign-in could not be verified (${e.code || e.message}).`, 401)
  }
  if (!payload.email) throw httpError('Google account has no email address.', 400)
  if (payload.email_verified === false) throw httpError('Please verify your Google email address first.', 403)
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture }
}

/* ---------------- our session ---------------- */

export async function issueSession(res, user) {
  const token = await new SignJWT({ email: user.email, name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())
  // No Domain attribute: a host-only cookie keeps preview deployments from
  // sharing the production session. Secure is skipped on plain-http localhost.
  appendCookie(res, `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFlag()}`)
}

export function clearSession(res) {
  appendCookie(res, `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`)
}

/** Returns the user row, or null when not signed in. */
export async function currentUser(req) {
  const token = parseCookies(req)[COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub) return null
    return await getUser(payload.sub)
  } catch {
    return null
  }
}

export async function requireUser(req) {
  const user = await currentUser(req)
  if (!user) throw httpError('Please sign in to continue.', 401)
  if (user.blocked) throw httpError('This account has been suspended.', 403)
  return user
}
