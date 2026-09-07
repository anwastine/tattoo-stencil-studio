/* GET /api/auth/me — current user and balance, or { user: null }. */
import { handler, methods, send } from '../_lib/http.js'
import { currentUser } from '../_lib/session.js'
import { publicUser, recentLedger } from '../_lib/db.js'

export default handler(async (req, res) => {
  methods(req, ['GET'])
  const user = await currentUser(req)
  if (!user) return send(res, 200, { user: null })
  send(res, 200, { user: publicUser(user), history: await recentLedger(user.id, 15) })
})
