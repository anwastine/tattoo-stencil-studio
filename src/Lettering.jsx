import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { paintStencil, downloadStencil } from './stencil.js'

/* ------------------------------------------------------------------ */
/*  scripts and their real Unicode fonts                               */
/*                                                                     */
/*  The phrase is always typeset in a genuine font first. That render  */
/*  is what the AI restyles, and it is also downloadable on its own —  */
/*  so there is always a version whose spelling is correct by          */
/*  construction, however the AI behaves.                              */
/* ------------------------------------------------------------------ */

const SCRIPTS = [
  { id: 'devanagari', label: 'Hindi', native: 'हिन्दी', sample: 'प्रेम', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Tiro Devanagari Hindi', google: 'Tiro+Devanagari+Hindi' },
      { label: 'Display', family: 'Rozha One', google: 'Rozha+One' },
      { label: 'Handwritten', family: 'Kalam', google: 'Kalam:wght@700' },
    ] },
  { id: 'tamil', label: 'Tamil', native: 'தமிழ்', sample: 'அன்பு', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Tamil', google: 'Noto+Serif+Tamil:wght@600' },
      { label: 'Display', family: 'Arima', google: 'Arima:wght@700' },
      { label: 'Handwritten', family: 'Kavivanar', google: 'Kavivanar' },
    ] },
  { id: 'telugu', label: 'Telugu', native: 'తెలుగు', sample: 'ప్రేమ', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Telugu', google: 'Noto+Serif+Telugu:wght@600' },
      { label: 'Display', family: 'Ramabhadra', google: 'Ramabhadra' },
    ] },
  { id: 'kannada', label: 'Kannada', native: 'ಕನ್ನಡ', sample: 'ಪ್ರೀತಿ', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Kannada', google: 'Noto+Serif+Kannada:wght@600' },
      { label: 'Display', family: 'Baloo Tamma 2', google: 'Baloo+Tamma+2:wght@700' },
    ] },
  { id: 'malayalam', label: 'Malayalam', native: 'മലയാളം', sample: 'സ്നേഹം', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Malayalam', google: 'Noto+Serif+Malayalam:wght@600' },
      { label: 'Display', family: 'Baloo Chettan 2', google: 'Baloo+Chettan+2:wght@700' },
    ] },
  { id: 'bengali', label: 'Bengali', native: 'বাংলা', sample: 'ভালোবাসা', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Bengali', google: 'Noto+Serif+Bengali:wght@600' },
      { label: 'Display', family: 'Baloo Da 2', google: 'Baloo+Da+2:wght@700' },
    ] },
  { id: 'gujarati', label: 'Gujarati', native: 'ગુજરાતી', sample: 'પ્રેમ', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Gujarati', google: 'Noto+Serif+Gujarati:wght@600' },
      { label: 'Display', family: 'Baloo Bhai 2', google: 'Baloo+Bhai+2:wght@700' },
    ] },
  { id: 'gurmukhi', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', sample: 'ਪਿਆਰ', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Gurmukhi', google: 'Noto+Serif+Gurmukhi:wght@600' },
      { label: 'Display', family: 'Baloo Paaji 2', google: 'Baloo+Paaji+2:wght@700' },
    ] },
  { id: 'odia', label: 'Odia', native: 'ଓଡ଼ିଆ', sample: 'ପ୍ରେମ', dir: 'ltr',
    fonts: [
      { label: 'Classic', family: 'Noto Serif Oriya', google: 'Noto+Serif+Oriya:wght@600' },
      { label: 'Display', family: 'Baloo Bhaina 2', google: 'Baloo+Bhaina+2:wght@700' },
    ] },
  { id: 'urdu', label: 'Urdu', native: 'اردو', sample: 'محبت', dir: 'rtl',
    fonts: [{ label: 'Nastaliq', family: 'Noto Nastaliq Urdu', google: 'Noto+Nastaliq+Urdu:wght@600' }] },
]

const MOODS = [
  { id: 'name', label: 'Name', desc: 'Elegant and timeless — the name is the design' },
  { id: 'emotional', label: 'Emotional', desc: 'Soft flowing script, one delicate accent' },
  { id: 'flexing', label: 'Flexing', desc: 'Heavy, sharp, chicano and graffiti energy' },
  { id: 'devotional', label: 'Devotional', desc: 'Carved like temple stone, quiet border' },
  { id: 'minimal', label: 'Minimal', desc: 'One hairline weight, no ornament at all' },
  { id: 'ornamental', label: 'Ornamental', desc: 'Filigree and dot-work framing the words' },
]

const RENDER_W = 1024 // long side of the typeset image sent to the model

/* ---------------- font loading ---------------- */

const loaded = new Set()
function ensureFont(font) {
  if (loaded.has(font.google)) return
  loaded.add(font.google)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`
  document.head.appendChild(link)
}

/**
 * Typeset `text` into `canvas`, black on white, auto-fitted.
 * Returns the canvas so it can be sent to the model or exported directly.
 */
async function typeset(canvas, { text, family, dir, padding = 0.09 }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null

  try { await document.fonts.load(`700 120px "${family}"`, text) } catch { /* fall back to whatever is there */ }
  try { await document.fonts.ready } catch { /* not fatal */ }

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const W = RENDER_W
  const pad = W * padding

  // find the size that fits the widest line, then set the canvas height to match
  let size = 300
  ctx.font = `700 ${size}px "${family}", serif`
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
  if (widest > 0) size = Math.min(size, ((W - pad * 2) / widest) * size)

  const lineHeight = size * 1.45
  const H = Math.round(lineHeight * lines.length + pad * 2)
  canvas.width = W
  canvas.height = Math.max(280, H)

  const c = canvas.getContext('2d', { willReadFrequently: true })
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, canvas.width, canvas.height)
  c.fillStyle = '#000000'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.direction = dir === 'rtl' ? 'rtl' : 'ltr'
  c.font = `700 ${size}px "${family}", serif`

  const top = (canvas.height - lineHeight * lines.length) / 2
  lines.forEach((line, i) => c.fillText(line, canvas.width / 2, top + lineHeight * (i + 0.5)))
  return canvas
}

/* ------------------------------------------------------------------ */

export default function Lettering({ user, config, setCredits, onNeedCredits, refresh, finish, finishPanel }) {
  const [scriptId, setScriptId] = useState('devanagari')
  const [fontIdx, setFontIdx] = useState(0)
  const [mood, setMood] = useState('name')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [view, setView] = useState('ai') // ai | typeset

  const typesetRef = useRef(document.createElement('canvas'))
  const previewRef = useRef(null)
  const stageRef = useRef(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })

  const script = useMemo(() => SCRIPTS.find((s) => s.id === scriptId) || SCRIPTS[0], [scriptId])
  const font = script.fonts[Math.min(fontIdx, script.fonts.length - 1)]
  const perStencil = config?.creditsPerStencil ?? 1
  const canAfford = (user?.credits ?? 0) >= perStencil

  useEffect(() => { script.fonts.forEach(ensureFont) }, [script])
  useEffect(() => { setFontIdx(0) }, [scriptId])

  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  /* keep the typeset preview in step with the text, font and finishing options */
  const redraw = useCallback(async () => {
    const canvas = previewRef.current
    if (!canvas) return
    const showing = view === 'ai' && result ? result.bitmap : null
    if (showing) {
      const s = Math.min(1, 1400 / Math.max(result.w, result.h))
      canvas.width = Math.round(result.w * s)
      canvas.height = Math.round(result.h * s)
      paintStencil(canvas.getContext('2d', { willReadFrequently: true }), result.bitmap, finish)
      setFitFor(result.w, result.h)
      return
    }
    if (!text.trim()) { canvas.width = 0; canvas.height = 0; setFit({ w: 0, h: 0 }); return }
    const t = await typeset(typesetRef.current, { text, family: font.family, dir: script.dir })
    if (!t) return
    canvas.width = t.width
    canvas.height = t.height
    paintStencil(canvas.getContext('2d', { willReadFrequently: true }), t, finish)
    setFitFor(t.width, t.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, font, script, finish, result, view])

  const setFitFor = useCallback((w, h) => {
    const el = stageRef.current
    if (!el || !w || !h) return
    const pw = el.clientWidth - 76, ph = el.clientHeight - 76
    const s = Math.min(pw / w, ph / h, 1.4)
    setFit({ w: Math.max(60, Math.floor(w * s)), h: Math.max(40, Math.floor(h * s)) })
  }, [])

  useEffect(() => { redraw() }, [redraw])
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [redraw])

  /* ---------------- generate ---------------- */
  const generate = useCallback(async () => {
    if (!text.trim() || busy) return
    if (!canAfford) return onNeedCredits?.()
    setBusy(true)
    setElapsed(0)
    setError(null)
    try {
      const t = await typeset(typesetRef.current, { text, family: font.family, dir: script.dir })
      if (!t) throw new Error('Type something first.')
      const image = t.toDataURL('image/png')
      const json = await api('/api/lettering', {
        method: 'POST',
        body: { image, script: script.id, mood, text, width: t.width, height: t.height },
      })
      if (typeof json.credits === 'number') setCredits(json.credits)
      const blob = await (await fetch(json.image)).blob()
      const bitmap = await createImageBitmap(blob)
      setResult({ bitmap, w: bitmap.width, h: bitmap.height, ms: json.ms, mood, text })
      setView('ai')
    } catch (e) {
      console.error(e)
      if (typeof e.credits === 'number') setCredits(e.credits)
      if (e.rechargeRequired) onNeedCredits?.()
      if (e.signInRequired) refresh?.()
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [text, busy, canAfford, font, script, mood, setCredits, onNeedCredits, refresh])

  /* ---------------- export ---------------- */
  const download = useCallback(async (which) => {
    const name = (text.trim().split('\n')[0] || 'lettering').slice(0, 24).replace(/[^\p{L}\p{N}]+/gu, '-')
    if (which === 'typeset' || !result) {
      const t = await typeset(typesetRef.current, { text, family: font.family, dir: script.dir })
      if (!t) return
      // typeset at 2× for a crisper print
      const big = document.createElement('canvas')
      big.width = t.width * 2
      big.height = t.height * 2
      await downloadStencil(t, big.width, big.height, finish, `${name}-clean${finish.mirror ? '-mirrored' : ''}.png`)
      return
    }
    await downloadStencil(result.bitmap, result.w, result.h, finish, `${name}-${result.mood}${finish.mirror ? '-mirrored' : ''}.png`)
  }, [text, font, script, result, finish])

  const hasText = !!text.trim()

  return (
    <>
      {/* stage */}
      <section className="panel relative flex min-h-[52vh] flex-col overflow-hidden rounded-sm lg:h-full lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/15 px-3 py-2">
          <div className="grid gap-px overflow-hidden rounded-sm border border-gold/25 bg-gold/15" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            {[
              { v: 'ai', label: 'Inked' },
              { v: 'typeset', label: 'Clean type' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={o.v === 'ai' && !result}
                onClick={() => setView(o.v)}
                className={`stamp px-3 py-2 text-[11px] transition disabled:opacity-40 ${view === o.v ? 'bg-red text-paper' : 'bg-ink-2 text-paper-3 hover:text-paper'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="stamp flex items-center gap-2 text-[10px] text-paper-3/60">
            {busy && <span className="inkpulse text-red-bright">Inking · {elapsed}s</span>}
            {result && !busy && view === 'ai' && <span>{result.w}×{result.h} · {(result.ms / 1000).toFixed(0)}s</span>}
            {view === 'typeset' && hasText && <span>{font.family}</span>}
          </div>
        </div>

        <div ref={stageRef} className="relative flex flex-1 items-center justify-center p-5">
          {!hasText ? (
            <div className="max-w-sm text-center">
              <p className="wordmark text-2xl text-paper">Write it in your language</p>
              <p className="mt-2 text-[13px] leading-relaxed text-paper-3/80">
                Type or paste a name, a word or a line of verse in {script.native}. It gets typeset properly
                first, then inked — so the spelling never changes.
              </p>
              <p className="stamp mt-4 text-[10px] text-paper-3/50">Try {script.sample}</p>
            </div>
          ) : (
            <div className={`relative rounded-sm p-4 ${finish.bg === 'transparent' && result && view === 'ai' ? 'checker' : 'flash-paper'}`}>
              <canvas ref={previewRef} className="block" style={{ width: fit.w || undefined, height: fit.h || undefined }} />
              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/75 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <svg width="30" height="42" viewBox="0 0 34 46" className="text-red-bright" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M10 4 h14 v10 h-14 z" /><path d="M17 14 v8" />
                      <g className="needle"><path d="M17 22 v14" /><path d="M14 40 h6" /></g>
                    </svg>
                    <p className="wordmark text-lg text-paper">Inking your lettering</p>
                    <p className="stamp text-[10px] text-paper-3/70">{elapsed}s · usually 20–40 seconds</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* controls */}
      <aside className="scrollbar-thin space-y-3 lg:overflow-y-auto lg:pr-1">
        <section className="panel rounded-sm p-4">
          <p className="stamp mb-3 text-[11px] text-gold">Your words</p>

          <div className="mb-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3">
            {SCRIPTS.map((s) => (
              <button
                key={s.id}
                type="button"
                data-on={s.id === scriptId}
                onClick={() => setScriptId(s.id)}
                className="flash-card rounded-sm px-2 py-2 text-center"
                title={s.label}
              >
                <span className="block truncate text-[15px] leading-tight text-paper" style={{ fontFamily: `"${s.fonts[0].family}", serif` }}>{s.native}</span>
                <span className="stamp mt-0.5 block truncate text-[9px] text-paper-3/60">{s.label}</span>
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 80))}
            rows={2}
            dir={script.dir}
            placeholder={script.sample}
            aria-label={`Text in ${script.label}`}
            className="w-full resize-none rounded-sm border border-gold/25 bg-ink-2 px-3 py-2.5 text-[20px] leading-snug text-paper outline-none placeholder:text-paper-3/30 focus:border-gold"
            style={{ fontFamily: `"${font.family}", serif` }}
          />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[10px] text-paper-3/50">Use your phone's {script.label} keyboard, or paste it in.</p>
            <span className="stamp text-[10px] text-paper-3/40">{text.length}/80</span>
          </div>

          {script.fonts.length > 1 && (
            <>
              <p className="stamp mt-3 mb-1.5 text-[10px] text-paper-3/60">Letterform</p>
              <div className="grid gap-px overflow-hidden rounded-sm border border-gold/25 bg-gold/15" style={{ gridTemplateColumns: `repeat(${script.fonts.length}, minmax(0,1fr))` }}>
                {script.fonts.map((f, i) => (
                  <button
                    key={f.family}
                    type="button"
                    onClick={() => setFontIdx(i)}
                    className={`stamp px-2 py-2 text-[10px] transition ${i === fontIdx ? 'bg-red text-paper' : 'bg-ink-2 text-paper-3 hover:text-paper'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel rounded-sm p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="stamp text-[11px] text-gold">Mood</p>
            <span className="stamp text-[10px] text-paper-3/50">{perStencil} credit each</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
            {MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                data-on={m.id === mood}
                onClick={() => setMood(m.id)}
                className="flash-card rounded-sm px-3 py-2.5 text-left"
              >
                <span className="stamp block text-[13px] text-paper">{m.label}</span>
                <span className="block truncate text-[11px] text-paper-3/70">{m.desc}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!hasText || busy}
            onClick={generate}
            className="btn-ink mt-4 w-full rounded-sm py-3.5 text-[13px]"
          >
            {busy ? `Inking… ${elapsed}s` : !canAfford ? 'Add credits to continue' : result ? 'Ink it again' : 'Ink it'}
          </button>
          {!hasText && <p className="stamp mt-2 text-center text-[10px] text-paper-3/50">Type something first</p>}
          {error && <p className="mt-2 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[11px] leading-snug text-paper-2">{error}</p>}
        </section>

        {/* the part that matters most */}
        <section className="rounded-sm border border-gold/45 bg-gold/[0.07] p-4">
          <p className="stamp mb-1.5 text-[11px] text-gold">Check the spelling before you tattoo</p>
          <p className="text-[11px] leading-snug text-paper-2">
            Your words are typeset in a real {script.label} font first, so <strong>Clean type</strong> is always
            spelled correctly. The inked version is the AI's redrawing of it — compare the two, and have a
            native reader confirm it before any needle touches skin.
          </p>
        </section>

        {finishPanel}

        <section className="panel rounded-sm p-4">
          <p className="stamp mb-3 text-[11px] text-gold">Download</p>
          <div className="space-y-2">
            <button type="button" disabled={!result} onClick={() => download('ai')} className="btn-ink w-full rounded-sm py-3 text-[12px]">
              Inked version
            </button>
            <button type="button" disabled={!hasText} onClick={() => download('typeset')} className="btn-quiet w-full rounded-sm py-3 text-[11px] disabled:opacity-40">
              Clean type · spelling guaranteed
            </button>
          </div>
          <p className="mt-2.5 text-[11px] leading-snug text-paper-3/60">
            Ink colour, background and mirror from the Finish panel apply to both.
          </p>
        </section>
      </aside>
    </>
  )
}
