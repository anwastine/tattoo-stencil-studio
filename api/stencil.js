/*
 * GET  /api/stencil            → { providers: ["gemini", "openai"], defaults }
 * POST /api/stencil
 *   Body: { image: "data:image/jpeg;base64,...", provider?: "gemini" | "openai",
 *           style: "studio" | "fineline" | "bold" | "dotwork" | "realism",
 *           size?: "1K" | "2K" | "4K", width, height }
 *   Returns: { image: "data:image/png;base64,...", provider, model, ms }
 *
 * Sends the portrait to an image-to-image model with a tattoo-stencil prompt
 * and returns the redrawn image. Runs as a Vercel serverless function; also
 * mounted by vite.config.js for local dev.
 *
 * Environment (set at least one):
 *   OPENAI_API_KEY      https://platform.openai.com/api-keys
 *   OPENAI_IMAGE_MODEL  optional, default gpt-image-2 (falls back to gpt-image-1.5, gpt-image-1)
 *   GEMINI_API_KEY      https://aistudio.google.com/apikey
 *   GEMINI_IMAGE_MODEL  optional, default gemini-3.1-flash-image
 */

const GEMINI_MODELS = [process.env.GEMINI_IMAGE_MODEL, 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].filter(Boolean)
const OPENAI_MODELS = [process.env.OPENAI_IMAGE_MODEL, 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'].filter(Boolean)

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

// OpenAI gpt-image-2: any WxH, multiples of 16, ≤3840 edge, 655,360..8,294,400 px
function openaiSize(w, h, size, model) {
  if (!/gpt-image-2/.test(model)) {
    // older models: fixed sizes only
    const r = w / h
    return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024'
  }
  const target = size === '4K' ? 3840 : size === '2K' ? 2048 : 1024
  const r = w / h
  let W, H
  if (r >= 1) { W = target; H = target / r } else { H = target; W = target * r }
  const snap = (v) => Math.max(256, Math.round(v / 16) * 16)
  W = snap(W); H = snap(H)
  // keep within the pixel budget
  let px = W * H
  if (px > 8_294_400) { const k = Math.sqrt(8_294_400 / px); W = snap(W * k); H = snap(H * k) }
  if (px < 655_360) { const k = Math.sqrt(655_360 / px) * 1.01; W = snap(W * k); H = snap(H * k) }
  return `${W}x${H}`
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const httpError = (msg, status) => Object.assign(new Error(msg), { status })
const isModelMissing = (e) => e.status === 404 || (e.status === 400 && /model|not found|unsupported|does not exist/i.test(e.message))

/* ---------------- providers ---------------- */

async function callGemini({ model, key, prompt, mime, b64, w, h, size }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: nearestRatio(w, h), imageSize: size } },
  }
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError(json?.error?.message || `Gemini HTTP ${r.status}`, r.status)
  const parts = json?.candidates?.[0]?.content?.parts || []
  const img = parts.find((p) => p.inlineData?.data)
  if (!img) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason
    const text = parts.find((p) => p.text)?.text
    throw httpError(`Gemini returned no image${reason ? ` (${reason})` : ''}${text ? `: ${text.slice(0, 200)}` : ''}`, 502)
  }
  return { mime: img.inlineData.mimeType || 'image/png', data: img.inlineData.data }
}

async function callOpenAI({ model, key, prompt, mime, b64, w, h, size }) {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('image', new Blob([Buffer.from(b64, 'base64')], { type: mime }), mime === 'image/png' ? 'photo.png' : 'photo.jpg')
  form.append('size', openaiSize(w, h, size, model))
  form.append('quality', size === '1K' ? 'medium' : 'high')
  form.append('output_format', 'png')
  form.append('background', 'opaque')
  if (!/gpt-image-2/.test(model)) form.append('input_fidelity', 'high')
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError(json?.error?.message || `OpenAI HTTP ${r.status}`, r.status)
  const data = json?.data?.[0]?.b64_json
  if (!data) throw httpError('OpenAI returned no image', 502)
  return { mime: 'image/png', data }
}

const PROVIDERS = {
  openai: { key: () => process.env.OPENAI_API_KEY, models: OPENAI_MODELS, call: callOpenAI },
  gemini: { key: () => process.env.GEMINI_API_KEY, models: GEMINI_MODELS, call: callGemini },
}
const available = () => Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].key())

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'GET') return send(200, { providers: available(), models: { openai: OPENAI_MODELS[0], gemini: GEMINI_MODELS[0] } })
  if (req.method !== 'POST') return send(405, { error: 'POST only' })

  let body
  try { body = await readJson(req) } catch { return send(400, { error: 'Invalid JSON' }) }
  const { image, style = 'studio', size = '2K', width, height } = body || {}
  let { provider } = body || {}
  const avail = available()
  if (!avail.length) return send(503, { error: 'No AI provider configured. Add OPENAI_API_KEY or GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.' })
  if (!provider || !PROVIDERS[provider]) provider = avail[0]
  if (!PROVIDERS[provider].key()) return send(503, { error: `${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} is not set on the server. Available: ${avail.join(', ')}.` })

  if (typeof image !== 'string' || !image.startsWith('data:image/')) return send(400, { error: 'image must be a data URL' })
  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return send(400, { error: 'image must be base64 data URL' })
  const [, mime, b64] = m
  if (b64.length > 6_000_000) return send(413, { error: 'Image too large; send ≤ ~4 MB' })
  const prompt = STYLES[style] || STYLES.studio
  const sz = size === '1K' || size === '2K' || size === '4K' ? size : '2K'
  const w = Number(width) || 3, h = Number(height) || 4

  const P = PROVIDERS[provider]
  const t0 = Date.now()
  let lastErr
  for (const model of [...new Set(P.models)]) {
    try {
      const out = await P.call({ model, key: P.key(), prompt, mime, b64, w, h, size: sz })
      return send(200, { image: `data:${out.mime};base64,${out.data}`, provider, model, ms: Date.now() - t0 })
    } catch (e) {
      lastErr = e
      if (!isModelMissing(e)) break // only fall through when this model is unavailable
    }
  }
  const status = lastErr?.status >= 400 && lastErr.status < 600 ? lastErr.status : 502
  return send(status, { error: lastErr?.message || 'Generation failed' })
}
