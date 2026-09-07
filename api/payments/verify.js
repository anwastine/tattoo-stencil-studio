/*
 * POST /api/payments/verify
 *   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * Called by the browser straight after Checkout succeeds. The signature is
 * HMAC-SHA256 of "order_id|payment_id" keyed with the API secret — a different
 * formula from the webhook, which signs the raw request body with the webhook
 * secret. Crediting is idempotent, so the webhook and this route can both fire.
 */
import crypto from 'node:crypto'
import { handler, methods, send, readJson, httpError } from '../_lib/http.js'
import { requireUser } from '../_lib/session.js'
import { creditOrder, getOrder } from '../_lib/db.js'

const safeEqual = (a, b) => {
  const x = Buffer.from(a || '', 'utf8')
  const y = Buffer.from(b || '', 'utf8')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw httpError('Payments are not configured.', 503)

  const user = await requireUser(req)
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await readJson(req, 16 * 1024)
  if (!orderId || !paymentId || !signature) throw httpError('Incomplete payment response', 400)

  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
  if (!safeEqual(expected, signature)) throw httpError('Payment signature did not match.', 400)

  const order = await getOrder(orderId)
  if (!order) throw httpError('Unknown order', 404)
  if (String(order.user_id) !== String(user.id)) throw httpError('This order belongs to another account.', 403)

  // A valid signature proves the response came from Razorpay, but ask Razorpay
  // directly whether the money actually landed, and for the right amount.
  const keyId = process.env.RAZORPAY_KEY_ID
  const pr = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}` },
  })
  const payment = await pr.json().catch(() => ({}))
  if (!pr.ok) throw httpError('Could not confirm the payment with Razorpay. If money was debited it will be credited automatically within a few minutes.', 502)
  if (payment.order_id !== orderId) throw httpError('Payment does not belong to this order.', 400)
  if (!['captured', 'authorized'].includes(payment.status)) {
    throw httpError(`Payment is ${payment.status || 'incomplete'}. Credits are added once it is captured.`, 402)
  }
  if (Number(payment.amount) !== Number(order.amount_paise)) throw httpError('Payment amount did not match the order.', 400)

  const result = await creditOrder({ orderId, paymentId })
  send(res, 200, { ok: true, credits: result.credits, added: result.credited ? result.addedCredits : 0, alreadyCredited: !result.credited })
})
