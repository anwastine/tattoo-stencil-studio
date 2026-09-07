/* POST /api/payments/create-order  { packId } | { credits } → Razorpay order. */
import { handler, methods, send, readJson, httpError } from '../_lib/http.js'
import { requireUser } from '../_lib/session.js'
import { createOrderRow } from '../_lib/db.js'
import { packById, paiseFor, RUPEES_PER_CREDIT } from '../_lib/config.js'

const MIN_CREDITS = 1
const MAX_CREDITS = 1000

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw httpError('Payments are not configured yet. Please try again later.', 503)

  const user = await requireUser(req)
  const body = await readJson(req, 16 * 1024)

  let credits
  if (body.packId) {
    const pack = packById(body.packId)
    if (!pack) throw httpError('Unknown pack', 400)
    credits = pack.credits
  } else {
    credits = Math.floor(Number(body.credits))
  }
  if (!Number.isFinite(credits) || credits < MIN_CREDITS || credits > MAX_CREDITS) {
    throw httpError(`Choose between ${MIN_CREDITS} and ${MAX_CREDITS} credits.`, 400)
  }
  const amountPaise = paiseFor(credits)

  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: `u${user.id}-c${credits}`,
      notes: { userId: String(user.id), credits: String(credits) },
    }),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok || !json.id) throw httpError(json?.error?.description || `Could not start the payment (${r.status}).`, r.status === 401 ? 503 : 502)

  await createOrderRow({ id: json.id, userId: user.id, credits, amountPaise })

  send(res, 200, {
    orderId: json.id,
    amountPaise,
    rupees: credits * RUPEES_PER_CREDIT,
    credits,
    keyId,
    prefill: { name: user.name || '', email: user.email || '' },
  })
})
