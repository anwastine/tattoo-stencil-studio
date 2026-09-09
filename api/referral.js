/*
 * GET /api/referral — the signed-in artist's invite link and how it is doing.
 *
 * The reward is paid on the invited artist's first purchase, not on their
 * sign-up, so `invited` and `converted` are deliberately shown separately:
 * people ask why a name has not turned into credits yet.
 */
import { handler, methods, send } from './_lib/http.js'
import { requireUser } from './_lib/session.js'
import { ensureReferralCode, referralSummary } from './_lib/db.js'
import { REFERRAL_CREDITS, REFERRAL_MIN_PURCHASE, RUPEES_PER_CREDIT } from './_lib/config.js'

export default handler(async (req, res) => {
  methods(req, ['GET'])
  const user = await ensureReferralCode(await requireUser(req))
  const stats = await referralSummary(user.id)
  send(res, 200, {
    code: user.referral_code,
    link: `https://sui.ink/?r=${user.referral_code}`,
    reward: REFERRAL_CREDITS,
    minPurchase: REFERRAL_MIN_PURCHASE,
    rupeesPerCredit: RUPEES_PER_CREDIT,
    ...stats,
  })
})
