/* POST /api/auth/google  { credential } — the ID token from Google Identity Services. */
import { handler, methods, send, readJson } from '../_lib/http.js'
import { verifyGoogleIdToken, issueSession } from '../_lib/session.js'
import { upsertUser, publicUser } from '../_lib/db.js'
import { WELCOME_CREDITS } from '../_lib/config.js'

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const { credential } = await readJson(req, 64 * 1024)
  const profile = await verifyGoogleIdToken(credential)
  const before = await upsertUser(profile)
  await issueSession(res, before)
  send(res, 200, {
    user: publicUser(before),
    welcomeCredits: WELCOME_CREDITS,
    isNew: before.credits === WELCOME_CREDITS,
  })
})
