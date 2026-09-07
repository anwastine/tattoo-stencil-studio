/*
 * POST /api/payments/webhook — Razorpay server-to-server callback.
 *
 * Safety net for when the browser closes before /verify runs. The signature
 * here is HMAC-SHA256 over the RAW body keyed with RAZORPAY_WEBHOOK_SECRET,
 * which is a different secret and formula from the checkout response.
 */
import crypto from 'node:crypto'
import { handler, methods, send, readRaw, httpError } from '../_lib/http.js'
import { creditOrder } from '../_lib/db.js'

export const config = { api: { bodyParser: false } }

const safeEqual = (a, b) => {
  const x = Buffer.from(a || '', 'utf8')
  const y = Buffer.from(b || '', 'utf8')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export default handler(async (req, res) => {
  methods(req, ['POST'])
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return send(res, 200, { ok: true, skipped: 'no webhook secret configured' })

  const raw = await readRaw(req)
  const signature = req.headers['x-razorpay-signature']
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (!safeEqual(expected, signature)) throw httpError('Bad webhook signature', 400)

  let event
  try { event = JSON.parse(raw.toString('utf8')) } catch { throw httpError('Bad webhook body', 400) }

  const payment = event?.payload?.payment?.entity
  if ((event?.event === 'payment.captured' || event?.event === 'order.paid') && payment?.order_id) {
    const r = await creditOrder({ orderId: payment.order_id, paymentId: payment.id })
    console.log('webhook credited', { order: payment.order_id, credited: r.credited })
  }
  send(res, 200, { ok: true })
})
