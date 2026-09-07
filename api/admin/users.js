/*
 * GET /api/admin/users[?search=]
 * Signed-in admins only — the email must be listed in ADMIN_EMAILS.
 * Returns the sign-up list (email, mobile, credits, activity) plus totals.
 */
import { handler, methods, send, httpError } from '../_lib/http.js'
import { requireUser } from '../_lib/session.js'
import { isAdmin, listUsers, adminStats } from '../_lib/db.js'

export default handler(async (req, res) => {
  methods(req, ['GET'])
  const user = await requireUser(req)
  if (!isAdmin(user.email)) throw httpError('This page is for administrators only.', 403)

  const search = new URL(req.url, 'http://x').searchParams.get('search') || ''
  const [users, stats] = await Promise.all([listUsers({ search }), adminStats()])
  send(res, 200, { users, stats })
})
