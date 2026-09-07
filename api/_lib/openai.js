/*
 * Shared OpenAI image plumbing: sizing, the edits call, and the "this model
 * does not exist" test used to fall back down the model list.
 */

const OPENAI_MODELS = [process.env.OPENAI_IMAGE_MODEL, 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'].filter(Boolean)
export const models = () => [...new Set(OPENAI_MODELS)]
export const apiKey = () => process.env.OPENAI_API_KEY

export const httpError = (msg, status) => Object.assign(new Error(msg), { status })
export const isModelMissing = (e) =>
  e.status === 404 || (e.status === 400 && /model|not found|unsupported|does not exist/i.test(e.message))

// gpt-image-2 accepts any WxH that is a multiple of 16 within its pixel budget.
// We always render at the 1K tier: it is the size that keeps a credit profitable.
export function openaiSize(w, h, model) {
  if (!/gpt-image-2/.test(model)) {
    // older models: fixed sizes only
    const r = w / h
    return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024'
  }
  const target = 1024
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

export async function callOpenAI({ model, key, prompt, mime, b64, w, h }) {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('image', new Blob([Buffer.from(b64, 'base64')], { type: mime }), mime === 'image/png' ? 'photo.png' : 'photo.jpg')
  form.append('size', openaiSize(w, h, model))
  form.append('quality', 'medium')
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
