/*
 * POST /api/lettering
 *   Body: { image, script, mood, text, width, height }
 *   Returns: { image, model, ms, credits }
 *
 * `image` is the phrase ALREADY TYPESET correctly by the browser in a real
 * Unicode font for that script. The model is asked to restyle those exact
 * shapes, never to write the script itself — image models reliably mangle
 * Indic conjuncts and matras when they generate them from a text prompt, and
 * a misspelt tattoo is permanent. Restyling a correct rendering keeps the
 * spelling intact.
 *
 * Costs the same one credit as a portrait, refunded if the model fails.
 */

import { clientIp } from './_lib/http.js'
import { requireUser } from './_lib/session.js'
import { spendCredits, refundCredits, releaseSlot, checkRateLimit } from './_lib/db.js'
import { creditCostFor } from './_lib/config.js'
import { models, apiKey, callOpenAI, isModelMissing } from './_lib/openai.js'

export const SCRIPT_NAMES = {
  devanagari: 'Devanagari (Hindi / Marathi / Sanskrit)',
  tamil: 'Tamil',
  telugu: 'Telugu',
  kannada: 'Kannada',
  malayalam: 'Malayalam',
  bengali: 'Bengali',
  gujarati: 'Gujarati',
  gurmukhi: 'Gurmukhi (Punjabi)',
  odia: 'Odia',
  urdu: 'Urdu Nastaliq',
}

const BASE = (scriptName) => `You are a master tattoo lettering artist inking a stencil.

The image contains a word or phrase already typeset correctly in ${scriptName}.

ABSOLUTE RULE — the writing must survive untouched:
- Reproduce every character, matra, vowel sign, conjunct, nukta and dot exactly as it appears. Trace the existing shapes.
- Do not translate, transliterate, respell, correct, add or delete any mark, and do not substitute a similar-looking letter. A single wrong stroke makes the tattoo wrong forever.
- Keep the same number of words and the same line breaks.

Render it as a hand-inked tattoo stencil:
- Pure black ink on flat white. No grey, no gradients, no colour, no paper texture, no frame, no signature, no watermark.
- Every tone built only from discrete black marks a thermal stencil printer can reproduce — solid fills, clean outlines, hatching or dots. Never soft shading.
- Centre the lettering with generous even margins, and keep it perfectly legible at small size.`

const MOODS = {
  name: {
    label: 'Name',
    prompt: `- Style: a personal name piece. Elegant, confident, timeless letterforms with balanced weight and gentle entry and exit strokes. Restrained — the name is the whole design. No ornament beyond a subtle flourish on the first and last letter.`,
  },
  emotional: {
    label: 'Emotional',
    prompt: `- Style: soft and heartfelt. Flowing script-like strokes with thick-to-thin modulation, as if written in one breath. A single delicate accent is welcome — a fine underline that curls, or one small rose or heartline — but it must never touch or obscure the letters.`,
  },
  flexing: {
    label: 'Flexing',
    prompt: `- Style: bold and loud. Heavy blackletter-influenced weight, sharp spurs and aggressive serifs, chicano and graffiti lettering energy. High contrast, tight spacing, drop shadow rendered as solid black or hard hatching. Reads from across the room.`,
  },
  devotional: {
    label: 'Devotional',
    prompt: `- Style: sacred and reverent. Letterforms carved like temple stone, with strong even weight and a quiet ornamental border above and below — lotus petals, a simple mandala arc or a fine double rule. Symmetrical and calm.`,
  },
  minimal: {
    label: 'Minimal',
    prompt: `- Style: fine line. A single consistent hairline weight throughout, no thick strokes, no fills, no ornament whatsoever. Airy spacing. The kind of small, quiet tattoo that sits on a wrist or collarbone.`,
  },
  ornamental: {
    label: 'Ornamental',
    prompt: `- Style: ornate. The lettering is framed by filigree — paisley, vines, fine dot-work and mandala flourishes — that surrounds and decorates without ever overlapping or obscuring a single character. The writing stays the clear focus.`,
  },
}

export const MOOD_LIST = Object.entries(MOODS).map(([id, m]) => ({ id, label: m.label }))

/* per-instance flood guard, same as the portrait route */
const burst = new Map()
function burstOk(key, limit = 6, windowMs = 60_000) {
  const now = Date.now()
  const hits = (burst.get(key) || []).filter((t) => now - t < windowMs)
  hits.push(now)
  burst.set(key, hits)
  if (burst.size > 5000) burst.clear()
  return hits.length <= limit
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'GET') return send(200, { scripts: SCRIPT_NAMES, moods: MOOD_LIST })
  if (req.method !== 'POST') return send(405, { error: 'POST only' })
  if (!apiKey()) return send(503, { error: 'The drawing service is not configured.' })
  if (!burstOk(clientIp(req))) return send(429, { error: 'Too many requests. Please slow down.' })

  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    return send(e.status || 401, { error: e.message, signInRequired: true })
  }

  let body
  try { body = await readJson(req) } catch { return send(400, { error: 'Invalid JSON' }) }
  const { image, script = 'devanagari', mood = 'name', width, height } = body || {}

  if (typeof image !== 'string' || !image.startsWith('data:image/')) return send(400, { error: 'image must be a data URL' })
  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return send(400, { error: 'image must be base64 data URL' })
  const [, mime, b64] = m
  if (b64.length > 6_000_000) return send(413, { error: 'Image too large' })

  const scriptName = SCRIPT_NAMES[script] || SCRIPT_NAMES.devanagari
  const moodPrompt = (MOODS[mood] || MOODS.name).prompt
  const prompt = `${BASE(scriptName)}\n${moodPrompt}`
  const w = Number(width) || 3, h = Number(height) || 2
  const cost = creditCostFor()

  const rate = await checkRateLimit(user.id)
  if (!rate.ok) return send(429, { error: rate.reason, credits: user.credits })

  const spend = await spendCredits(user.id, cost, { kind: 'lettering', script, mood })
  if (!spend.ok) {
    if (spend.reason === 'insufficient') {
      return send(402, { error: 'You are out of credits. Top up your wallet to keep drawing.', credits: spend.credits, rechargeRequired: true })
    }
    if (spend.reason === 'busy') return send(429, { error: 'A design is already being drawn on this account. Wait for it to finish.', credits: spend.credits })
    if (spend.reason === 'blocked') return send(403, { error: 'This account has been suspended.' })
    return send(400, { error: 'Could not start the drawing.' })
  }

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
      if (!isModelMissing(e)) break
    }
  }
  const credits = await refundCredits(user.id, cost, { reason: 'lettering_failed', script, mood })
  const status = lastErr?.status >= 400 && lastErr.status < 600 ? lastErr.status : 502
  return send(status, { error: `${lastErr?.message || 'The drawing failed'} — your credit was not charged.`, credits, refunded: cost })
}
