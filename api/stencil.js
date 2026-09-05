/*
 * POST /api/stencil
 * Body: { image: "data:image/jpeg;base64,...", style: "studio" | "fineline" | "bold" | "dotwork" | "realism", size?: "1K" | "2K" }
 * Returns: { image: "data:image/png;base64,...", model, ms }
 *
 * Sends the portrait to Google's Gemini image model (Nano Banana) with a
 * tattoo-stencil prompt and returns the redrawn image. Runs as a Vercel
 * serverless function; also mounted by vite.config.js for local dev.
 *
 * Environment:
 *   GEMINI_API_KEY   required — https://aistudio.google.com/apikey
 *   GEMINI_IMAGE_MODEL optional — default gemini-3.1-flash-image
 */

const DEFAULT_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'
const FALLBACK_MODELS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image']

const BASE = `You are a master tattoo artist preparing a transfer stencil from this portrait photo.
Redraw the photo as a hand-inked tattoo stencil drawing:
- Keep the exact likeness, proportions, expression, pose, crop and composition of the person. Do not beautify or change the face.
- Pure black ink on a plain flat white background. No grey tones, no gradients, no colour, no paper texture, no frame, no border, no signature, no text, no watermark.
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

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function callGemini(model, key, prompt, mime, b64, aspectRatio, size) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio, imageSize: size },
    },
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(json?.error?.message || `Gemini HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  const parts = json?.candidates?.[0]?.content?.parts || []
  const img = parts.find((p) => p.inlineData?.data)
  if (!img) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason
    const text = parts.find((p) => p.text)?.text
    throw new Error(`No image returned${reason ? ` (${reason})` : ''}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return { mime: img.inlineData.mimeType || 'image/png', data: img.inlineData.data }
}

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  if (req.method !== 'POST') return send(405, { error: 'POST only' })
  const key = process.env.GEMINI_API_KEY
  if (!key) return send(503, { error: 'GEMINI_API_KEY is not set on the server. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.' })

  let body
  try { body = await readJson(req) } catch { return send(400, { error: 'Invalid JSON' }) }
  const { image, style = 'studio', size = '2K', width, height } = body || {}
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return send(400, { error: 'image must be a data URL' })
  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return send(400, { error: 'image must be base64 data URL' })
  const [, mime, b64] = m
  if (b64.length > 6_000_000) return send(413, { error: 'Image too large; send ≤ ~4 MB' })
  const prompt = STYLES[style] || STYLES.studio
  const aspectRatio = width && height ? nearestRatio(width, height) : '3:4'
  const imageSize = size === '1K' || size === '2K' || size === '4K' ? size : '2K'

  const models = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((x) => x !== DEFAULT_MODEL)]
  const t0 = Date.now()
  let lastErr
  for (const model of models) {
    try {
      const out = await callGemini(model, key, prompt, mime, b64, aspectRatio, imageSize)
      return send(200, { image: `data:${out.mime};base64,${out.data}`, model, ms: Date.now() - t0 })
    } catch (e) {
      lastErr = e
      // only fall through to the next model when this one is unavailable
      if (!(e.status === 404 || e.status === 400 && /model|not found|unsupported/i.test(e.message))) break
    }
  }
  return send(lastErr?.status && lastErr.status >= 400 && lastErr.status < 600 ? lastErr.status : 502, { error: lastErr?.message || 'Generation failed' })
}
