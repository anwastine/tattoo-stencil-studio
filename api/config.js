/* GET /api/config — everything the browser needs to render correctly. */
import { handler, methods, send } from './_lib/http.js'
import { publicConfig } from './_lib/config.js'
import { googleConfigured, sessionConfigured, currentUser } from './_lib/session.js'
import { databaseConfigured, publicUser } from './_lib/db.js'

export default handler(async (req, res) => {
  methods(req, ['GET'])
  const ready = {
    google: googleConfigured() && sessionConfigured(),
    database: databaseConfigured(),
    payments: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    image: !!process.env.OPENAI_API_KEY,
  }
  let user = null
  if (ready.google && ready.database) {
    try {
      const u = await currentUser(req)
      if (u) user = publicUser(u)
    } catch { /* signed out or database asleep — treat as logged out */ }
  }
  send(res, 200, {
    ...publicConfig(),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    razorpayKeyId: ready.payments ? process.env.RAZORPAY_KEY_ID : null,
    ready,
    user,
  })
})
