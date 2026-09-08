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

import { clientIp, readJson } from './_lib/http.js'
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

const BASE = (scriptName) => `You are a master calligrapher who designs tattoo lettering.

The image shows a word or phrase already typeset in ${scriptName}. It is a plain reference for the SPELLING ONLY — its font, weight and proportions are not the design and must not be copied.

ABSOLUTE RULE — the writing must survive untouched:
- Reproduce every character, matra, vowel sign, conjunct, nukta and dot exactly as it appears, in the same order.
- Do not translate, transliterate, respell, correct, add or delete any mark, and never substitute a similar-looking letter. A single wrong stroke makes the tattoo wrong forever.
- Keep the same number of words and the same line breaks.

Now redraw it completely as a finished calligraphic tattoo piece:
- Draw every stroke as one confident pass of a pointed brush: hairline entries and exits, swelling thick through the curves, dramatic thick-to-thin contrast. Never a uniform-width trace.
- Let the natural exit strokes grow into long, sweeping swashes and tails that carry well beyond the body of the word, and let strokes cross and interlock where the script allows. The result must look designed and hand-drawn, not typed.
- Solid pure black on flat white, with crisp vector-clean edges.
- Fill the strokes solid. No grey, no gradients, no soft shading, no outline-only letters, no sketch lines, no paper texture, no frame, no background objects, no signature, no watermark.
- Compose the whole piece deliberately. It may be asymmetric and dynamic, but keep clear margins on every side and keep every character perfectly legible at small size.`

/* An optional symbol woven into the letterforms. This is what turns a nicely
   set word into a piece someone actually wants tattooed — but it is also the
   fastest way to make the writing unreadable, so every one of these insists
   the symbol shares the letter's stroke rather than sitting on top of it. */
const MOTIFS = {
  none: { label: 'No symbol', prompt: '' },
  heart: {
    label: 'Heart',
    prompt: `- Weave a single heart into the lettering: formed by one of the strokes, or by a sweeping tail curling back on itself. It must read as part of the writing, never as an object placed beside it.`,
  },
  mother: {
    label: 'Mother & child',
    prompt: `- Inside the enclosed counter of the largest letter, draw the silhouette of a mother holding her baby, their profiles almost touching, in fine continuous line that shares the letter's own stroke. The figure sits within the letter, never over it, and the letter stays completely readable.`,
  },
  couple: {
    label: 'Two faces',
    prompt: `- Inside the enclosed counter of the largest letter, draw two profiles turned towards each other, almost touching, in one fine continuous line that flows out of the letter's own stroke. The letter stays completely readable.`,
  },
  hands: {
    label: 'Praying hands',
    prompt: `- Weave a pair of praying hands into the largest letter, drawn in the same fine line and sharing its stroke, so the letter and the hands read as one drawn form.`,
  },
  lotus: {
    label: 'Lotus',
    prompt: `- Let one stroke open into a lotus in bloom, its petals growing out of the letter's own line. Place it where a swash naturally ends, not floating separately.`,
  },
  rose: {
    label: 'Rose',
    prompt: `- Let one long swash coil into a fine-line rose with two leaves at the point where the stroke ends. Same weight and hand as the lettering.`,
  },
  feather: {
    label: 'Feather',
    prompt: `- Draw one of the long tails as a feather, its barbs breaking away into a few small birds as it thins out.`,
  },
  infinity: {
    label: 'Infinity',
    prompt: `- Let two strokes cross and loop into an infinity symbol under the word, drawn in one continuous line with the lettering.`,
  },
  crown: {
    label: 'Crown',
    prompt: `- Rest a small, finely drawn crown on the tallest letter, its base following that letter's top curve so the two touch as one shape.`,
  },
  om: {
    label: 'Flame',
    prompt: `- Let one upward stroke rise into a single diya flame, drawn in the same tapering line, with three small dots trailing above it.`,
  },
}

export const MOTIF_LIST = Object.entries(MOTIFS).map(([id, m]) => ({ id, label: m.label }))

/* The style the whole piece is drawn in. Grouped so eighteen of them stay
   browsable rather than becoming a wall of buttons. */
const MOODS = {
  /* ---- classic ---- */
  name: {
    label: 'Name', group: 'Classic', desc: 'Elegant and timeless — the name is the design',
    prompt: `- Style: a personal name piece. Confident, timeless letterforms with strong weight contrast, and one long graceful swash sweeping underneath the whole word to carry it. Restrained — the name is the design.`,
  },
  minimal: {
    label: 'Minimal', group: 'Classic', desc: 'One hairline weight, no ornament at all',
    prompt: `- Style: fine line. A single consistent hairline weight throughout — this is the one style with no thick-to-thin contrast. No fills, no ornament, airy spacing, one long thin tail. The kind of small quiet tattoo that sits on a wrist.`,
  },
  ornamental: {
    label: 'Ornamental', group: 'Classic', desc: 'Filigree and dot-work framing the words',
    prompt: `- Style: ornate. Filigree grows out of the letters themselves — paisley, vines, fine dot-work, mandala flourishes — surrounding and decorating without ever overlapping or obscuring a single character.`,
  },
  vintage: {
    label: 'Vintage sign', group: 'Classic', desc: "A 1930s sign painter's panel",
    prompt: `- Style: a 1930s sign painter's panel. Confident brush script with strong swash capitals, a hard drop shadow rendered as solid black offset down and right, and a fine keyline running parallel to the letters.`,
  },
  royal: {
    label: 'Royal', group: 'Classic', desc: 'High-contrast serif, crowned and symmetrical',
    prompt: `- Style: regal. High-contrast serif letterforms with sharp entry strokes and fine hairlines, a symmetrical ornamental rule above and below the word, and one small finely drawn coronet flourish centred over it.`,
  },

  /* ---- feeling ---- */
  romantic: {
    label: 'Romantic', group: 'Feeling', desc: 'A love letter — looping copperplate flourishes',
    prompt: `- Style: a love letter. Copperplate and Spencerian influence — a steep consistent slant, whisper-thin hairline upstrokes against deep swelling downstrokes, and extravagant looping flourishes off the first and last letters that curl back over and under the word without touching it. Tender, generous, unhurried.`,
  },
  emotional: {
    label: 'Emotional', group: 'Feeling', desc: 'Soft flowing script, one delicate accent',
    prompt: `- Style: soft and heartfelt, written in one breath. Deep thick-to-thin modulation, generous flowing curves, and a long ribbon-like stroke curving beneath the word and tapering away to nothing.`,
  },
  sultry: {
    label: 'Sultry', group: 'Feeling', desc: 'Boudoir pin-up — languid curves, silk and lace',
    prompt: `- Style: sensual and slow, in the register of classic boudoir pin-up flash. A languid slant, exaggerated hips to the curves, very high contrast between whisper-thin hairlines and heavy swelling strokes, and long tapering tails that trail off like silk. One restrained accent is welcome — a fine lace edge along a stroke, a ribbon curling through a letter, or a small lipstick kiss set beside the word. Alluring and elegant; never crude, and no figures or bodies.`,
  },
  devotional: {
    label: 'Devotional', group: 'Feeling', desc: 'Carved like temple stone, quiet border',
    prompt: `- Style: sacred and reverent. Letterforms with the even, carved weight of temple stone, and a quiet symmetrical flourish above and below the word. Calm and upright.`,
  },
  memorial: {
    label: 'Memorial', group: 'Feeling', desc: 'Quiet and dignified, for remembrance',
    prompt: `- Style: a remembrance piece. Quiet, upright, evenly weighted letters with generous spacing, a fine horizontal rule beneath the word, and one restrained flourish. Dignified — nothing loud, nothing decorative for its own sake.`,
  },

  /* ---- street ---- */
  flexing: {
    label: 'Flexing', group: 'Street', desc: 'Heavy, sharp, graffiti energy',
    prompt: `- Style: bold and loud. Heavy blackletter and chicano influence, sharp spurs, aggressive serifs, tight spacing, very high stroke contrast. Reads from across the room.`,
  },
  chicano: {
    label: 'Chicano', group: 'Street', desc: 'Single-needle fine-line script',
    prompt: `- Style: LA fine-line script. Even thin strokes at a fast confident slant, long crossing flourishes trailing off the ends, the look of a single-needle piece. Sharp and clean, no solid fills.`,
  },
  gothic: {
    label: 'Gothic', group: 'Street', desc: 'Medieval blackletter, severe and upright',
    prompt: `- Style: medieval blackletter textura. Dense vertical strokes with diamond terminals, hairline connecting strokes, a tight even rhythm. Severe and upright, with one sharp flourish off the final letter.`,
  },
  grunge: {
    label: 'Grunge', group: 'Street', desc: 'Dry brush, split strokes, spatter',
    prompt: `- Style: rough brush. Dry-brush drag leaving the stroke split and broken in places, ragged edges, a little ink spatter flicking off the ends. Fast and unpolished — but every character stays legible.`,
  },
  horror: {
    label: 'Horror', group: 'Street', desc: 'Jagged, barbed, dripping',
    prompt: `- Style: dread. Jagged uneven strokes with sharp barbs on the terminals and a few heavy drips running down from the baseline. Deliberately rough. Legible but unsettling.`,
  },

  /* ---- modern ---- */
  cyber: {
    label: 'Cyber', group: 'Modern', desc: 'Angular, chamfered, circuit hairlines',
    prompt: `- Style: angular and technical. Letterforms rebuilt from straight cuts and hard corners with chamfered ends, and hairline circuit-like extensions running off the terminals into small square nodes.`,
  },
  nature: {
    label: 'Nature', group: 'Modern', desc: 'Grown from branches and leaves',
    prompt: `- Style: grown, not written. The strokes are branches — fine bark texture, small leaves and one bud sprouting where a stroke turns or ends. Organic, asymmetric, still perfectly readable.`,
  },
  celestial: {
    label: 'Celestial', group: 'Modern', desc: 'Moon, stars and constellation lines',
    prompt: `- Style: night sky. Fine even letterstrokes, a crescent moon resting where a stroke curves, and a scatter of small stars along a long sweeping arc beneath the word, joined by hairlines like a constellation.`,
  },
}

export const MOOD_LIST = Object.entries(MOODS).map(([id, m]) => ({ id, label: m.label, group: m.group, desc: m.desc }))

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


export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'GET') return send(200, { scripts: SCRIPT_NAMES, moods: MOOD_LIST, motifs: MOTIF_LIST })
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
  const { image, script = 'devanagari', mood = 'name', motif = 'none', width, height } = body || {}

  if (typeof image !== 'string' || !image.startsWith('data:image/')) return send(400, { error: 'image must be a data URL' })
  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return send(400, { error: 'image must be base64 data URL' })
  const [, mime, b64] = m
  if (b64.length > 6_000_000) return send(413, { error: 'Image too large' })

  const scriptName = SCRIPT_NAMES[script] || SCRIPT_NAMES.devanagari
  const moodPrompt = (MOODS[mood] || MOODS.name).prompt
  const motifPrompt = (MOTIFS[motif] || MOTIFS.none).prompt
  const prompt = [BASE(scriptName), moodPrompt, motifPrompt].filter(Boolean).join('\n')
  const w = Number(width) || 3, h = Number(height) || 2
  const cost = creditCostFor()

  const rate = await checkRateLimit(user.id)
  if (!rate.ok) return send(429, { error: rate.reason, credits: user.credits })

  const spend = await spendCredits(user.id, cost, { kind: 'lettering', script, mood, motif })
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
  const credits = await refundCredits(user.id, cost, { reason: 'lettering_failed', script, mood, motif })
  const status = lastErr?.status >= 400 && lastErr.status < 600 ? lastErr.status : 502
  return send(status, { error: `${lastErr?.message || 'The drawing failed'} — your credit was not charged.`, credits, refunded: cost })
}
