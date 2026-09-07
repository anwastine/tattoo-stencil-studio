/* POST /api/auth/logout */
import { handler, methods, send } from '../_lib/http.js'
import { clearSession } from '../_lib/session.js'

export default handler(async (req, res) => {
  methods(req, ['POST'])
  clearSession(res)
  send(res, 200, { ok: true })
})
