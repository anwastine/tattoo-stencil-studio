/*
 * POST /api/tts   { text, voice, style, model } → { mime, audio }
 * GET  /api/tts                                 → { models, voices }
 *
 * Narration for the studio's own training material, spoken by Gemini rather
 * than the operating system's speech synthesiser, which sounds like a machine
 * reading a list.
 *
 * Administrators only. It exists here, rather than as a local script, so the
 * Gemini key stays in this project's environment and never has to travel.
 */

import { handler, methods, send, readJson, httpError } from './_lib/http.js'
import { requireUser } from './_lib/session.js'
import { isAdmin } from './_lib/db.js'

const API = 'https://generativelanguage.googleapis.com/v1beta'
const key = () => process.env.GEMINI_API_KEY

/* Gemini's prebuilt speakers. The list is stable enough to hard-code, and a
   wrong name comes back as a clear 400 rather than silence. */
export const VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]

export default handler(async (req, res) => {
  methods(req, ['GET', 'POST'])
  if (!key()) throw httpError('No Gemini key configured.', 503)

  const user = await requireUser(req)
  if (!isAdmin(user.email)) throw httpError('This endpoint is for administrators only.', 403)

  if (req.method === 'GET') {
    const r = await fetch(`${API}/models?key=${key()}&pageSize=200`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw httpError(j?.error?.message || `Gemini HTTP ${r.status}`, r.status)
    const models = (j.models || [])
      .map((m) => m.name?.replace('models/', ''))
      .filter((n) => n && /tts|speech|audio/i.test(n))
    return send(res, 200, { models, voices: VOICES })
  }

  const { text, voice = 'Charon', style = '', model = 'gemini-2.5-flash-preview-tts' } =
    await readJson(req, 64 * 1024)
  if (typeof text !== 'string' || !text.trim()) throw httpError('text is required', 400)
  if (text.length > 4000) throw httpError('text too long', 413)

  /* Gemini takes direction in plain language, which is what makes it read like
     a person instead of a screen reader. */
  const prompt = style ? `${style}\n\n${text}` : text

  const r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError(j?.error?.message || `Gemini HTTP ${r.status}`, r.status)

  const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part) throw httpError('Gemini returned no audio', 502)
  send(res, 200, { mime: part.inlineData.mimeType, audio: part.inlineData.data })
})
