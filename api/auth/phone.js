/*
 * POST /api/auth/phone
 *   { phone: "9876543210" }  → save it
 *   { skip: true }           → don't ask again
 *
 * The mobile number is optional. It is only ever collected from the signed-in
 * user for their own account, and is never shown to anyone but an admin.
 */
import { handler, methods, send, readJson, httpError } from '../_lib/http.js'
import { requireUser } from '../_lib/session.js'
import { savePhone, skipPhone, normalisePhone, publicUser } from '../_lib/db.js'

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const user = await requireUser(req)
  const body = await readJson(req, 8 * 1024)

  if (body?.skip) {
    return send(res, 200, { user: publicUser(await skipPhone(user.id)) })
  }

  const phone = normalisePhone(body?.phone)
  if (!phone) throw httpError('Please enter a valid 10-digit Indian mobile number.', 400)
  send(res, 200, { user: publicUser(await savePhone(user.id, phone)) })
})
