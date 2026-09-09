/* POST /api/auth/google  { credential } — the ID token from Google Identity Services. */
import { handler, methods, send, readJson } from '../_lib/http.js'
import { verifyGoogleIdToken, issueSession } from '../_lib/session.js'
import { upsertUser, publicUser } from '../_lib/db.js'
import { WELCOME_CREDITS } from '../_lib/config.js'

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const { credential, ref } = await readJson(req, 64 * 1024)
  const profile = await verifyGoogleIdToken(credential)
  /* `ref` is whoever invited them. It is only honoured on a brand-new account;
     upsertUser decides that, not the browser. */
  const before = await upsertUser({ ...profile, referralCode: typeof ref === 'string' ? ref.slice(0, 12) : null })
  await issueSession(res, before)
  send(res, 200, {
    user: publicUser(before),
    welcomeCredits: WELCOME_CREDITS,
    isNew: before.credits === WELCOME_CREDITS,
  })
})
