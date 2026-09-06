import { useCallback, useEffect, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  constants                                                          */
/* ------------------------------------------------------------------ */

const SEND_MAX = 1536 // long side of the photo sent to the model
const PREVIEW_MAX = 1400 // long side of the on-screen preview

const STYLES = [
  { value: 'studio', label: 'Studio stencil', desc: 'Flowing lines, skin stipple, hatched lips' },
  { value: 'fineline', label: 'Fine line', desc: 'Thin minimal contours' },
  { value: 'bold', label: 'Bold traditional', desc: 'Heavy outlines, chunky dots' },
  { value: 'dotwork', label: 'Dotwork', desc: 'Everything in dots' },
  { value: 'realism', label: 'Realism map', desc: 'Every contour plus shadow zones' },
]

const SIZES = [
  { value: '1K', label: '1K', hint: 'fast · draft' },
  { value: '2K', label: '2K', hint: 'final · ~2 min' },
  { value: '4K', label: '4K', hint: 'print · slow' },
]

const INKS = [
  { name: 'Black', value: '#0a0a0a' },
  { name: 'Stencil purple', value: '#5b2a86' },
  { name: 'Thermal blue', value: '#1d3fa3' },
  { name: 'Red', value: '#b91c1c' },
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/* ------------------------------------------------------------------ */
/*  UI atoms                                                           */
/* ------------------------------------------------------------------ */

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className="grid gap-1 rounded-lg bg-neutral-800/80 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
            value === o.value ? 'bg-neutral-100 text-neutral-900 shadow' : 'text-neutral-400 hover:text-neutral-100'
          }`}
        >
          {o.label}
          {o.hint && <span className={`block text-[10px] font-normal ${value === o.value ? 'text-neutral-500' : 'text-neutral-600'}`}>{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between py-1 text-left">
      <span>
        <span className="block text-xs text-neutral-300">{label}</span>
        {hint && <span className="block text-[11px] text-neutral-500">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-neutral-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-4.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, format = (v) => v, hint }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="block select-none">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="font-mono tabular-nums text-neutral-400">{format(value)}</span>
      </div>
      <input type="range" className="range w-full" style={{ '--fill': `${fill}%` }} min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint && <p className="-mt-0.5 text-[11px] leading-snug text-neutral-500">{hint}</p>}
    </label>
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
      <p className="mb-3 text-[11px] font-medium tracking-wider text-neutral-500 uppercase">{title}</p>
      <div className="space-y-3.5">{children}</div>
    </div>
  )
}

function Thumb({ bitmap }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const s = 160 / Math.max(bitmap.width, bitmap.height)
    c.width = Math.round(bitmap.width * s)
    c.height = Math.round(bitmap.height * s)
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height)
  }, [bitmap])
  return <canvas ref={ref} className="block h-full w-full object-cover" />
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [source, setSource] = useState(null) // { bitmap, w, h, name }
  const [providers, setProviders] = useState(null) // null = checking
  const [provider, setProvider] = useState('openai')
  const [style, setStyle] = useState('studio')
  const [size, setSize] = useState('2K')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { bitmap, w, h, model, provider, ms, style, id }
  const [history, setHistory] = useState([]) // previous results
  const [threshold, setThreshold] = useState(0) // 0 = off
  const [ink, setInk] = useState('#0a0a0a')
  const [bg, setBg] = useState('white')
  const [mirror, setMirror] = useState(false)
  const [view, setView] = useState('ai') // ai | split | original
  const [split, setSplit] = useState(50)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [dragOver, setDragOver] = useState(false)

  const aiCanvasRef = useRef(null)
  const originalRef = useRef(null)
  const stageRef = useRef(null)
  const fileInputRef = useRef(null)

  /* which providers have keys on the server */
  useEffect(() => {
    fetch('/api/stencil')
      .then((r) => r.json())
      .then((j) => {
        const list = j.providers || []
        setProviders(list)
        setProvider((p) => (list.includes(p) ? p : list[0] || p))
      })
      .catch(() => setProviders([]))
  }, [])

  /* ---------------- loading ---------------- */
  const loadFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setError(null)
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      setSource({ bitmap, w: bitmap.width, h: bitmap.height, name: file.name.replace(/\.[^.]+$/, '') })
      setResult(null)
      setHistory([])
      setView('original')
    } catch (e) {
      console.error(e)
      setError('Could not decode that image. Try JPEG, PNG or WebP.')
    }
  }, [])

  const loadSample = useCallback(async () => {
    const blob = await (await fetch('/samples/portrait2.jpg')).blob()
    await loadFile(new File([blob], 'sample-portrait.jpg', { type: 'image/jpeg' }))
  }, [loadFile])

  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  /* draw the original photo to its preview canvas */
  useEffect(() => {
    const c = originalRef.current
    if (!c || !source) return
    const s = Math.min(1, PREVIEW_MAX / Math.max(source.w, source.h))
    c.width = Math.round(source.w * s)
    c.height = Math.round(source.h * s)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.bitmap, 0, 0, c.width, c.height)
  }, [source])

  /* ---------------- generate ---------------- */
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  const generate = useCallback(async () => {
    if (!source || busy) return
    setBusy(true)
    setElapsed(0)
    setError(null)
    try {
      const s = Math.min(1, SEND_MAX / Math.max(source.w, source.h))
      const w = Math.round(source.w * s), h = Math.round(source.h * s)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source.bitmap, 0, 0, w, h)
      const image = c.toDataURL('image/jpeg', 0.92)
      const r = await fetch('/api/stencil', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, provider, style, size, width: w, height: h }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `Server error ${r.status}`)
      const blob = await (await fetch(json.image)).blob()
      const bitmap = await createImageBitmap(blob)
      const next = { bitmap, w: bitmap.width, h: bitmap.height, model: json.model, provider: json.provider, ms: json.ms, style, id: Date.now() }
      setResult((prev) => {
        if (prev) setHistory((hst) => [prev, ...hst].slice(0, 8))
        return next
      })
      setView('ai')
    } catch (e) {
      console.error(e)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [source, busy, provider, style, size])

  /* ---------------- render result with clean-up ---------------- */
  const renderResult = useCallback(
    (ctx, res) => {
      const cw = ctx.canvas.width, ch = ctx.canvas.height
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, cw, ch)
      if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1) }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(res.bitmap, 0, 0, cw, ch)
      ctx.restore()
      const img = ctx.getImageData(0, 0, cw, ch)
      const d = img.data
      const [ir, ig, ib] = hexToRgb(ink)
      const white = bg === 'white'
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        let a = 1 - lum / 255
        if (threshold > 0) a = a > threshold ? 1 : 0
        if (white) {
          d[i] = Math.round(255 + (ir - 255) * a)
          d[i + 1] = Math.round(255 + (ig - 255) * a)
          d[i + 2] = Math.round(255 + (ib - 255) * a)
          d[i + 3] = 255
        } else {
          d[i] = ir; d[i + 1] = ig; d[i + 2] = ib
          d[i + 3] = Math.round(a * 255)
        }
      }
      ctx.putImageData(img, 0, 0)
    },
    [ink, bg, mirror, threshold],
  )

  useEffect(() => {
    const c = aiCanvasRef.current
    if (!c || !result) return
    const s = Math.min(1, PREVIEW_MAX / Math.max(result.w, result.h))
    c.width = Math.round(result.w * s)
    c.height = Math.round(result.h * s)
    renderResult(c.getContext('2d', { willReadFrequently: true }), result)
  }, [result, renderResult])

  /* fit the stage */
  const shown = view === 'original' ? source : result || source
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!shown) return
      const pw = el.clientWidth - 24, ph = el.clientHeight - 24
      const s = Math.min(pw / shown.w, ph / shown.h)
      setFit({ w: Math.floor(shown.w * s), h: Math.floor(shown.h * s) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown])

  /* ---------------- export ---------------- */
  const exportPNG = useCallback(async () => {
    if (!result) return
    const c = document.createElement('canvas')
    c.width = result.w
    c.height = result.h
    renderResult(c.getContext('2d', { willReadFrequently: true }), result)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${source?.name || 'portrait'}-stencil-${result.style}-${result.w}px${mirror ? '-mirrored' : ''}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [result, renderResult, mirror, source])

  /* split-view drag */
  const onSplitPointer = (e) => {
    if (view !== 'split' || !result) return
    const rect = e.currentTarget.getBoundingClientRect()
    const move = (ev) => setSplit(Math.round(Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100))))
    move(e)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const noKey = providers !== null && providers.length === 0
  const providerMissing = providers !== null && providers.length > 0 && !providers.includes(provider)
  const showResult = !!result && view !== 'original'

  /* ------------------------------------------------------------------ */
  /*  render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex h-full min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-neutral-950">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-lg leading-tight tracking-wide">Tattoo Stencil Studio</h1>
            <p className="hidden text-[11px] text-neutral-500 sm:block">Portrait photo → hand-inked tattoo stencil, drawn by AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium hover:border-neutral-500">
            {source ? 'Replace photo' : 'Upload'}
          </button>
          <button
            type="button"
            disabled={!result}
            onClick={exportPNG}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            <span className="hidden sm:inline">Export PNG</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        {/* stage */}
        <section
          className={`relative flex min-h-[55vh] flex-col overflow-hidden rounded-2xl border transition lg:min-h-0 ${dragOver ? 'border-accent bg-accent/5' : 'border-neutral-800 bg-neutral-900/40'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]) }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <Segmented
              value={result ? view : 'original'}
              onChange={setView}
              disabled={!result}
              options={[
                { value: 'ai', label: 'Stencil' },
                { value: 'split', label: 'Compare' },
                { value: 'original', label: 'Original' },
              ]}
            />
            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              {busy && <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />drawing · {elapsed}s</span>}
              {result && !busy && <span className="font-mono tabular-nums">{result.w}×{result.h} · {result.model} · {(result.ms / 1000).toFixed(0)} s</span>}
            </div>
          </div>

          <div ref={stageRef} className={`relative flex flex-1 items-center justify-center p-3 ${bg === 'transparent' && showResult ? 'checker' : ''}`}>
            {!source ? (
              <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-neutral-700 text-neutral-500">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                </div>
                <div>
                  <p className="text-base font-medium">Drop a portrait here</p>
                  <p className="mt-1 text-sm text-neutral-500">JPEG, PNG or WebP · or paste from clipboard · a downsized copy is sent to the AI model only when you press Generate</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-white">Choose photo</button>
                  <button type="button" onClick={loadSample} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">Try sample</button>
                </div>
              </div>
            ) : (
              <div
                className={`relative select-none overflow-hidden rounded-md shadow-2xl shadow-black/60 ${view === 'split' && result ? 'cursor-ew-resize' : ''}`}
                style={{ width: fit.w || undefined, height: fit.h || undefined }}
                onPointerDown={onSplitPointer}
              >
                <canvas ref={aiCanvasRef} className="block h-full w-full" style={{ display: showResult ? 'block' : 'none' }} />
                <canvas
                  ref={originalRef}
                  className={showResult ? 'absolute inset-0 h-full w-full' : 'block h-full w-full'}
                  style={{
                    display: !result || view !== 'ai' ? 'block' : 'none',
                    clipPath: result && view === 'split' ? `inset(0 ${100 - split}% 0 0)` : undefined,
                    transform: mirror && showResult ? 'scaleX(-1)' : undefined,
                  }}
                />
                {result && view === 'split' && (
                  <div className="pointer-events-none absolute inset-y-0" style={{ left: `calc(${split}% - 1px)` }}>
                    <div className="h-full w-0.5 bg-accent shadow" />
                    <div className="absolute top-1/2 left-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-neutral-950 shadow">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
                    </div>
                  </div>
                )}
                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-neutral-950/60 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900/90 px-6 py-5 text-center shadow-xl">
                      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent/30 border-t-accent" />
                      <p className="text-sm font-medium">Drawing your stencil…</p>
                      <p className="text-[11px] text-neutral-400">{elapsed}s · {size === '1K' ? 'usually 20–40 s' : size === '2K' ? 'usually 1–2 min' : 'usually 2–4 min'}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* controls */}
        <aside className="scrollbar-thin space-y-3 lg:overflow-y-auto lg:pr-1">
          <div className="rounded-xl border border-accent/40 bg-gradient-to-b from-accent/10 to-transparent p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-medium tracking-wider text-accent uppercase">Style</p>
              <span className="text-[10px] text-neutral-500">
                {providers === null ? 'checking server…' : providers.length ? `${providers.length === 2 ? 'OpenAI + Gemini' : providers[0] === 'openai' ? 'OpenAI' : 'Gemini'} ready` : 'no API key configured'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
              {STYLES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setStyle(st.value)}
                  className={`rounded-lg border px-3 py-2 text-left ${style === st.value ? 'border-accent bg-accent/10' : 'border-neutral-800 bg-neutral-800/50 hover:border-neutral-600'}`}
                >
                  <span className="block text-xs font-medium">{st.label}</span>
                  <span className="block text-[10px] text-neutral-500">{st.desc}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 mb-1.5 text-[11px] text-neutral-400">Output size</p>
            <Segmented value={size} onChange={setSize} options={SIZES} />
            {providers && providers.length > 1 && (
              <>
                <p className="mt-3 mb-1.5 text-[11px] text-neutral-400">Model</p>
                <Segmented value={provider} onChange={setProvider} options={[{ value: 'openai', label: 'OpenAI' }, { value: 'gemini', label: 'Gemini' }]} />
              </>
            )}
            <button
              type="button"
              disabled={!source || busy || noKey || providerMissing}
              onClick={generate}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-semibold text-neutral-950 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-900/30 border-t-neutral-900" />
                  Drawing… {elapsed}s
                </>
              ) : result ? (
                '✦ Draw again'
              ) : (
                '✦ Generate stencil'
              )}
            </button>
            {!source && <p className="mt-2 text-center text-[11px] text-neutral-500">Upload a photo first</p>}
            {noKey && <p className="mt-2 rounded-md bg-red-900/40 px-2 py-1.5 text-[11px] leading-snug text-red-200">No API key configured on the server. Add OPENAI_API_KEY or GEMINI_API_KEY in Vercel → Settings → Environment Variables and redeploy.</p>}
            {error && <p className="mt-2 rounded-md bg-red-900/40 px-2 py-1.5 text-[11px] leading-snug text-red-200">{error}</p>}
            {result && <p className="mt-2 text-[11px] leading-snug text-neutral-500">Every run is a fresh drawing. Not happy with the likeness? Draw again.</p>}
          </div>

          {result && (
            <Section title="Clean-up for transfer">
              <Toggle label="Hard black & white" hint="Threshold to pure ink for thermal stencil printers" checked={threshold > 0} onChange={(v) => setThreshold(v ? 0.45 : 0)} />
              {threshold > 0 && (
                <Slider label="Ink cut-off" value={threshold} min={0.1} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setThreshold} hint="Lower keeps faint marks; higher keeps only solid ink." />
              )}
            </Section>
          )}

          <Section title="Output">
            <div>
              <p className="mb-1.5 text-xs text-neutral-300">Ink colour</p>
              <div className="flex items-center gap-2">
                {INKS.map((c) => (
                  <button key={c.value} type="button" title={c.name} onClick={() => setInk(c.value)} className={`h-7 w-7 rounded-full border-2 ${ink === c.value ? 'border-accent' : 'border-neutral-700'}`} style={{ background: c.value }} />
                ))}
                <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 border-neutral-700" title="Custom colour">
                  <span className="absolute inset-0" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
                  <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <span className="ml-1 font-mono text-[11px] text-neutral-500">{ink}</span>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-neutral-300">Background</p>
              <Segmented value={bg} onChange={setBg} options={[{ value: 'white', label: 'White' }, { value: 'transparent', label: 'Transparent' }]} />
            </div>
            <Toggle label="Mirror for transfer" hint="Flip horizontally so the stencil reads correctly once applied to skin" checked={mirror} onChange={setMirror} />
            <p className="text-[11px] text-neutral-500">Export downloads the drawing at its full generated size ({result ? `${result.w}×${result.h}` : size}) as PNG.</p>
          </Section>

          {history.length > 0 && (
            <Section title="Earlier drawings">
              <div className="grid grid-cols-4 gap-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    title={`${STYLES.find((s) => s.value === h.style)?.label} · ${h.w}×${h.h}`}
                    onClick={() => {
                      setHistory((hst) => [result, ...hst.filter((x) => x.id !== h.id)])
                      setResult(h)
                      setView('ai')
                    }}
                    className="overflow-hidden rounded-md border border-neutral-800 bg-white hover:border-accent"
                  >
                    <Thumb bitmap={h.bitmap} />
                  </button>
                ))}
              </div>
            </Section>
          )}

          <p className="px-2 pb-6 text-center text-[11px] text-neutral-600">
            Your photo is only sent to the AI model when you press Generate. Nothing is stored.
          </p>
        </aside>
      </main>

      {source && (
        <div className="sticky bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/90 p-3 backdrop-blur lg:hidden">
          {result ? (
            <button type="button" onClick={exportPNG} className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-neutral-950">Export PNG · {result.w} px</button>
          ) : (
            <button type="button" disabled={busy || noKey} onClick={generate} className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50">
              {busy ? `Drawing… ${elapsed}s` : '✦ Generate stencil'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
