/*
 * GET /api/translit?lang=telugu&text=amma
 *   → { word: 'amma', candidates: ['అమ్మ', 'అమ్మా', ...] }
 *
 * Lets people type a name the way they say it — "amma" — instead of hunting
 * for an Indic keyboard. Google's input-tools endpoint does the work; this
 * proxies it so the browser is not blocked by CORS and so one bad upstream
 * response cannot take the typing UI down.
 *
 * The typed word is transliterated, never translated: the result is the same
 * sounds written in the target script, which is what a name needs.
 */

import { send, httpError, handler, methods, clientIp } from './_lib/http.js'

/* our script ids → the language tags Google's endpoint expects */
const LANG = {
  devanagari: 'hi',
  hindi: 'hi',
  marathi: 'mr',
  tamil: 'ta',
  telugu: 'te',
  kannada: 'kn',
  malayalam: 'ml',
  bengali: 'bn',
  gujarati: 'gu',
  gurmukhi: 'pa',
  odia: 'or',
  urdu: 'ur',
}

/* Typing fires a request per word, so the guard is generous but present. */
const burst = new Map()
function burstOk(key, limit = 120, windowMs = 60_000) {
  const now = Date.now()
  const hits = (burst.get(key) || []).filter((t) => now - t < windowMs)
  hits.push(now)
  burst.set(key, hits)
  if (burst.size > 5000) burst.clear()
  return hits.length <= limit
}

export default handler(async (req, res) => {
  methods(req, ['GET'])
  const url = new URL(req.url, 'http://localhost')
  const lang = LANG[String(url.searchParams.get('lang') || '').toLowerCase()]
  const text = String(url.searchParams.get('text') || '').trim()

  if (!lang) throw httpError('Unknown language', 400)
  if (!text) return send(res, 200, { word: '', candidates: [] })
  if (text.length > 40) throw httpError('One word at a time, please', 400)
  // Only romanised input is meaningful here; anything else is already in script.
  if (!/^[A-Za-z][A-Za-z'.-]*$/.test(text)) return send(res, 200, { word: text, candidates: [] })
  if (!burstOk(clientIp(req))) throw httpError('Too many requests. Please slow down.', 429)

  const endpoint =
    'https://inputtools.google.com/request?itc=' + encodeURIComponent(`${lang}-t-i0-und`) +
    '&num=8&cp=0&cs=1&ie=utf-8&oe=utf-8&text=' + encodeURIComponent(text)

  let candidates = []
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(4000) })
    const json = await r.json()
    // ["SUCCESS", [[ "amma", ["అమ్మ", ...], ... ]]]
    if (Array.isArray(json) && json[0] === 'SUCCESS') {
      const list = json[1]?.[0]?.[1]
      if (Array.isArray(list)) candidates = list.filter((s) => typeof s === 'string').slice(0, 8)
    }
  } catch {
    /* Upstream hiccup or timeout: fall through with no candidates so the
       caller keeps the roman text rather than losing what was typed. */
  }

  // Cached hard: the same word always transliterates the same way.
  res.setHeader('cache-control', 'public, max-age=86400, s-maxage=604800')
  send(res, 200, { word: text, candidates })
})
