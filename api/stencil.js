/*
 * GET  /api/stencil            → { ready, model }
 * POST /api/stencil
 *   Body: { image: "data:image/jpeg;base64,...",
 *           style: "studio" | "fineline" | "bold" | "dotwork" | "realism",
 *           width, height }
 *   Returns: { image: "data:image/png;base64,...", provider, model, ms, credits }
 *
 * Requires a signed-in user and spends credits (see _lib/config.js). The credit
 * is refunded automatically if the model fails.
 *
 * Sends the portrait to an image-to-image model with a tattoo-stencil prompt
 * and returns the redrawn image. Runs as a Vercel serverless function; also
 * mounted by vite.config.js for local dev.
 *
 * Environment:
 *   OPENAI_API_KEY      https://platform.openai.com/api-keys
 *   OPENAI_IMAGE_MODEL  optional, default gpt-image-2 (falls back to gpt-image-1.5, gpt-image-1)
 */

import { clientIp } from './_lib/http.js'
import { models, apiKey, callOpenAI, isModelMissing } from './_lib/openai.js'
import { requireUser } from './_lib/session.js'
import { spendCredits, refundCredits, releaseSlot, checkRateLimit } from './_lib/db.js'
import { creditCostFor } from './_lib/config.js'


const BASE = `You are a master tattoo artist preparing a transfer stencil from this portrait photo.
Redraw the photo as a hand-inked tattoo stencil drawing:
- Keep the exact likeness, proportions, expression, pose, crop and composition of the person. Do not beautify or change the face.
- Pure black ink on a plain flat white background. Absolutely no grey tones, no smooth pencil or graphite shading, no soft gradients, no blending, no colour, no paper texture, no frame, no border, no signature, no text, no watermark.
- All tone must be built only from discrete, individually visible black marks (dots, short strokes or hatch lines) that a thermal stencil printer can reproduce; every mark is either solid black or absent.
- Leave the background completely empty white; draw only the person.`

const STYLES = {
  studio: `${BASE}
- Style: classic realism stencil. Clean, confident, continuous single-line contours for the face, eyes, eyebrows, nose, lips, jaw and neck.
- Hair drawn as long, flowing, calligraphic single strokes following the direction of the strands; no solid fills.
- Shading only with fine stippling (dot-work): dense dots in the shadow side of the face, under the jaw, around the eye sockets and beside the nose, fading to no dots in the lit areas. Skin highlights stay pure white.
- Cross-hatching only on the very darkest tones such as the lips and irises.
- Every line and dot must be crisp and printable at high resolution.`,
  fineline: `${BASE}
- Style: delicate fine-line tattoo. Very thin, elegant, minimal single-stroke outlines; only the essential contours of the features and a few flowing hair strands.
- Very sparse, light stippling only in the deepest shadows. Mostly open white space. No hatching.`,
  bold: `${BASE}
- Style: bold American traditional. Thick, uniform, heavy black outlines around every feature and the hair mass; simplified shapes.
- Shading with bold, evenly spaced dots or short stipple clusters in the shadow areas. No fine detail, no thin lines.`,
  dotwork: `${BASE}
- Style: full dotwork portrait. Minimal outlines; the whole face and hair rendered with stippling only, with dot density describing the tones: dense in shadows, sparse in mid tones, empty in highlights.
- No hatching, no solid fills, no grey.`,
  realism: `${BASE}
- Style: detailed realism line map for a black-and-grey artist. Precise, thin contour lines tracing every feature, wrinkle, fold and hair section, plus outline boundaries around each distinct shadow zone so the artist knows where tones change.
- Light stippling to indicate the darkest shadows only.`,
}

/* ---------------- helpers ---------------- */

const RATIOS = { '1:1': 1, '4:5': 0.8, '5:4': 1.25, '3:4': 0.75, '4:3': 4 / 3, '2:3': 2 / 3, '3:2': 1.5, '9:16': 9 / 16, '16:9': 16 / 9 }
function nearestRatio(w, h) {
  const r = w / h
  let best = '1:1', d = Infinity
  for (const [k, v] of Object.entries(RATIOS)) {
    const dd = Math.abs(Math.log(v / r))
    if (dd < d) { d = dd; best = k }
  }
  return best
}

/* ---------------- abuse guard ---------------- */

/*
 * Per-instance burst limiter. It resets on cold start, so it is a cheap first
 * line only — the real limits are the per-user ledger checks in _lib/db.js.
 * The point is to reject a flood before it costs a database round trip.
 */
const burst = new Map()
function burstOk(key, limit = 6, windowMs = 60_000) {
  const now = Date.now()
  const hits = (burst.get(key) || []).filter((t) => now - t < windowMs)
  hits.push(now)
  burst.set(key, hits)
  if (burst.size > 5000) burst.clear() // bound memory on a long-lived instance
  return hits.length <= limit
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'GET') return send(200, { ready: !!apiKey(), model: models()[0] })
  if (req.method !== 'POST') return send(405, { error: 'POST only' })

  if (!apiKey()) return send(503, { error: 'The drawing service is not configured. Add OPENAI_API_KEY in Vercel → Settings → Environment Variables, then redeploy.' })

  // Reject obvious floods before touching the session or the database.
  if (!burstOk(clientIp(req))) return send(429, { error: 'Too many requests. Please slow down.' })

  /* --- who is asking, and can they afford it --- */
  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    return send(e.status || 401, { error: e.message, signInRequired: true })
  }

  let body
  try { body = await readJson(req) } catch { return send(400, { error: 'Invalid JSON' }) }
  const { image, style = 'studio', width, height } = body || {}

  if (typeof image !== 'string' || !image.startsWith('data:image/')) return send(400, { error: 'image must be a data URL' })
  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return send(400, { error: 'image must be base64 data URL' })
  const [, mime, b64] = m
  if (b64.length > 6_000_000) return send(413, { error: 'Image too large; send ≤ ~4 MB' })
  const prompt = STYLES[style] || STYLES.studio
  const w = Number(width) || 3, h = Number(height) || 4
  const cost = creditCostFor()

  const rate = await checkRateLimit(user.id)
  if (!rate.ok) return send(429, { error: rate.reason, credits: user.credits })

  const spend = await spendCredits(user.id, cost, { style })
  if (!spend.ok) {
    if (spend.reason === 'insufficient') {
      return send(402, {
        error: `You are out of credits. Top up your wallet to keep drawing.`,
        credits: spend.credits,
        needCredits: cost,
        rechargeRequired: true,
      })
    }
    if (spend.reason === 'busy') return send(429, { error: 'A stencil is already being drawn on this account. Wait for it to finish.', credits: spend.credits })
    if (spend.reason === 'blocked') return send(403, { error: 'This account has been suspended.' })
    return send(400, { error: 'Could not start the generation.' })
  }

  /* --- draw; give the credit back if the model fails --- */
  const t0 = Date.now()
  let lastErr
  for (const model of models()) {
    try {
      const out = await callOpenAI({ model, key: apiKey(), prompt, mime, b64, w, h })
      await releaseSlot(user.id)
      return send(200, {
        image: `data:${out.mime};base64,${out.data}`,
        model,
        ms: Date.now() - t0,
        credits: spend.credits,
        creditsUsed: cost,
      })
    } catch (e) {
      lastErr = e
      if (!isModelMissing(e)) break // only fall through when this model is unavailable
    }
  }
  const credits = await refundCredits(user.id, cost, { reason: 'generation_failed', style })
  const status = lastErr?.status >= 400 && lastErr.status < 600 ? lastErr.status : 502
  return send(status, { error: `${lastErr?.message || 'The drawing failed'} — your credit was not charged.`, credits, refunded: cost })
}
