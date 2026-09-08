import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { useSession } from './Auth.jsx'
import SignIn, { Splash } from './SignIn.jsx'
import PhonePrompt from './PhonePrompt.jsx'
import Admin from './Admin.jsx'
import Lettering from './Lettering.jsx'
import { paintStencil, downloadStencil } from './stencil.js'
import { CreditTicket, AccountMenu, BuyCreditsModal } from './Wallet.jsx'
import { startTattooCursor } from './cursors.js'
import { Lockup } from './Logo.jsx'

/* ------------------------------------------------------------------ */
/*  constants                                                          */
/* ------------------------------------------------------------------ */

const SEND_MAX = 1024 // long side of the photo sent to the model
const PREVIEW_MAX = 1400 // long side of the on-screen preview

const STYLES = [
  { value: 'studio', numeral: 'I', label: 'Studio Stencil', desc: 'Clean linework, stippled skin, hatched lips' },
  { value: 'fineline', numeral: 'II', label: 'Fine Line', desc: 'Thin, minimal, plenty of open skin' },
  { value: 'bold', numeral: 'III', label: 'Bold Traditional', desc: 'Heavy outlines, chunky dot shading' },
  { value: 'dotwork', numeral: 'IV', label: 'Dotwork', desc: 'No outlines — tone built purely from dots' },
  { value: 'realism', numeral: 'V', label: 'Realism Map', desc: 'Every contour plus shadow boundaries' },
]

const INKS = [
  { name: 'Black', value: '#0b0a09' },
  { name: 'Stencil purple', value: '#5b2a86' },
  { name: 'Thermal blue', value: '#1d3fa3' },
  { name: 'Traditional red', value: '#b3271e' },
]

const LEGAL = [
  ['Pricing', 'pricing'],
  ['Terms', 'terms'],
  ['Privacy', 'privacy'],
  ['Refunds', 'refunds'],
  ['Delivery', 'shipping'],
  ['Contact', 'contact'],
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/* ------------------------------------------------------------------ */
/*  ornaments                                                          */
/* ------------------------------------------------------------------ */

const Diamond = ({ className = '' }) => (
  <svg viewBox="0 0 12 12" className={className} aria-hidden="true" fill="currentColor">
    <path d="M6 0 L9 6 L6 12 L3 6 Z" />
  </svg>
)

/** Registration crosses, like the corners of a real flash sheet. */
const Corners = () => (
  <>
    {['left-1.5 top-1.5', 'right-1.5 top-1.5', 'left-1.5 bottom-1.5', 'right-1.5 bottom-1.5'].map((pos) => (
      <span key={pos} className={`pointer-events-none absolute ${pos} text-ink/30`} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M6 0v12M0 6h12" />
        </svg>
      </span>
    ))}
  </>
)

const SectionTitle = ({ children, right }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <p className="stamp text-[11px] text-gold">{children}</p>
    {right}
  </div>
)

/* ------------------------------------------------------------------ */
/*  UI atoms                                                           */
/* ------------------------------------------------------------------ */

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div
      className="grid gap-px overflow-hidden rounded-sm border border-gold/25 bg-gold/15"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`stamp px-2 py-2 text-[11px] transition disabled:opacity-40 ${
            value === o.value ? 'bg-red text-paper' : 'bg-ink-2 text-paper-3 hover:text-paper'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-[13px] text-paper-2">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-paper-3/70">{hint}</span>}
      </span>
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${checked ? 'border-red-bright bg-red' : 'border-gold/30 bg-ink-4'}`}>
        <span className={`absolute top-[3px] h-3 w-3 rounded-full bg-paper transition-all ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
      </span>
    </button>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, format = (v) => v, hint }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="block select-none">
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="text-paper-2">{label}</span>
        <span className="stamp text-[12px] text-gold">{format(value)}</span>
      </div>
      <input type="range" className="range w-full" style={{ '--fill': `${fill}%` }} min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint && <p className="-mt-0.5 text-[11px] leading-snug text-paper-3/70">{hint}</p>}
    </label>
  )
}

function Panel({ title, right, children }) {
  return (
    <section className="panel rounded-sm p-4">
      {title && <SectionTitle right={right}>{title}</SectionTitle>}
      <div className="space-y-3.5">{children}</div>
    </section>
  )
}

function FinishPanel({ ink, setInk, bg, setBg, mirror, setMirror, threshold, setThreshold, sizeNote }) {
  return (
    <Panel title="Finish">
      <div>
        <p className="mb-2 text-[13px] text-paper-2">Ink colour</p>
        <div className="flex items-center gap-2">
          {INKS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.name}
              onClick={() => setInk(c.value)}
              className={`h-7 w-7 rounded-full border-2 transition ${ink === c.value ? 'border-gold' : 'border-gold/25 hover:border-gold/60'}`}
              style={{ background: c.value }}
            />
          ))}
          <label className="relative h-7 w-7 overflow-hidden rounded-full border-2 border-gold/25" title="Custom colour">
            <span className="absolute inset-0" style={{ background: 'conic-gradient(#b3271e,#c9a24a,#5d7a55,#1d3fa3,#5b2a86,#b3271e)' }} />
            <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} className="absolute inset-0 opacity-0" />
          </label>
          <span className="stamp ml-auto text-[11px] text-paper-3/60">{ink}</span>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] text-paper-2">Background</p>
        <Segmented value={bg} onChange={setBg} options={[{ value: 'white', label: 'Paper' }, { value: 'transparent', label: 'Transparent' }]} />
      </div>
      <Toggle label="Hard black &amp; white" hint="Threshold to solid ink for thermal stencil printers" checked={threshold > 0} onChange={(v) => setThreshold(v ? 0.45 : 0)} />
      {threshold > 0 && (
        <Slider label="Ink cut-off" value={threshold} min={0.1} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setThreshold} hint="Lower keeps faint marks; higher keeps only solid ink." />
      )}
      <Toggle label="Mirror" hint="Flip so the stencil reads correctly once it is on skin" checked={mirror} onChange={setMirror} />
      {sizeNote && <p className="text-[11px] leading-snug text-paper-3/60">{sizeNote}</p>}
    </Panel>
  )
}

function Thumb({ bitmap }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const s = 180 / Math.max(bitmap.width, bitmap.height)
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
  const { config, user, setUser, loading: sessionLoading, refresh, signOut, setCredits } = useSession()
  const [showBuy, setShowBuy] = useState(false)
  const [welcome, setWelcome] = useState(null)
  const [askPhone, setAskPhone] = useState(false)
  const [mode, setMode] = useState('portrait') // portrait | lettering
  const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/admin'

  const [source, setSource] = useState(null)
  const [style, setStyle] = useState('studio')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [threshold, setThreshold] = useState(0)
  const [ink, setInk] = useState('#0b0a09')
  const [bg, setBg] = useState('white')
  const [mirror, setMirror] = useState(false)
  const [view, setView] = useState('ai')
  const [split, setSplit] = useState(50)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [dragOver, setDragOver] = useState(false)

  const aiCanvasRef = useRef(null)
  const originalRef = useRef(null)
  const stageRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => startTattooCursor(), [])

  useEffect(() => { if (user?.askPhone) setAskPhone(true) }, [user?.askPhone])

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
      setError('Could not read that image. Try a JPEG, PNG or WebP.')
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

  /* ---------------- draw ---------------- */
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
      const json = await api('/api/stencil', { method: 'POST', body: { image, style, width: w, height: h } })
      if (typeof json.credits === 'number') setCredits(json.credits)
      const blob = await (await fetch(json.image)).blob()
      const bitmap = await createImageBitmap(blob)
      const next = { bitmap, w: bitmap.width, h: bitmap.height, model: json.model, ms: json.ms, style, id: Date.now() }
      setResult((prev) => {
        if (prev) setHistory((hst) => [prev, ...hst].slice(0, 8))
        return next
      })
      setView('ai')
    } catch (e) {
      console.error(e)
      if (typeof e.credits === 'number') setCredits(e.credits)
      if (e.rechargeRequired) setShowBuy(true)
      if (e.signInRequired) refresh()
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [source, busy, style, setCredits, refresh])

  /* ---------------- render + export ---------------- */
  const finish = useMemo(() => ({ ink, bg, mirror, threshold }), [ink, bg, mirror, threshold])
  const renderResult = useCallback((ctx, res) => paintStencil(ctx, res.bitmap, finish), [finish])

  useEffect(() => {
    const c = aiCanvasRef.current
    if (!c || !result) return
    const s = Math.min(1, PREVIEW_MAX / Math.max(result.w, result.h))
    c.width = Math.round(result.w * s)
    c.height = Math.round(result.h * s)
    renderResult(c.getContext('2d', { willReadFrequently: true }), result)
  }, [result, renderResult])

  const shown = view === 'original' ? source : result || source
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!shown) return
      const pw = el.clientWidth - 76, ph = el.clientHeight - 76 // room for the paper mat
      const s = Math.min(pw / shown.w, ph / shown.h)
      setFit({ w: Math.max(80, Math.floor(shown.w * s)), h: Math.max(80, Math.floor(shown.h * s)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown])

  const exportPNG = useCallback(async () => {
    if (!result) return
    await downloadStencil(result.bitmap, result.w, result.h, finish,
      `${source?.name || 'portrait'}-stencil-${result.style}${mirror ? '-mirrored' : ''}.png`)
  }, [result, finish, mirror, source])

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

  const noKey = !!config && config.ready?.image === false
  const signedIn = !!user
  const perStencil = config?.creditsPerStencil ?? 1
  const canAfford = !user || user.credits >= perStencil
  const showResult = !!result && view !== 'original'

  /* ---------------- gate ---------------- */
  // Every hook above has already run, so these early returns are safe.
  if (sessionLoading) return <Splash />
  if (!signedIn) {
    // /admin still needs a sign-in first; the landing page handles that.
    return (
      <SignIn
        config={config}
        onSignedIn={(out) => {
          refresh()
          if (out?.isNew) setWelcome(out.welcomeCredits)
        }}
      />
    )
  }
  if (isAdminRoute) return <Admin user={user} />

  /* ------------------------------------------------------------------ */

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      {/* ---------------- header ---------------- */}
      <header className="border-b border-gold/20 bg-ink/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Lockup />

          <div className="mx-2 hidden shrink-0 md:block">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'lettering', label: 'Lettering' }]} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
            <CreditTicket credits={user.credits} onClick={() => setShowBuy(true)} />
            {mode === 'portrait' && (
              <>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-quiet hidden rounded-sm px-3 py-2 text-[11px] sm:block">
                  {source ? 'New photo' : 'Upload'}
                </button>
                <button type="button" disabled={!result} onClick={exportPNG} className="btn-ink rounded-sm px-3.5 py-2 text-[11px] sm:px-4">
                  Download
                </button>
              </>
            )}
            <AccountMenu user={user} onBuy={() => setShowBuy(true)} onSignOut={signOut} />
          </div>
        </div>
      </header>

      <div className="border-b border-gold/15 px-4 py-2 md:hidden">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'lettering', label: 'Lettering' }]} />
      </div>

      {/* ---------------- body ---------------- */}
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_370px] lg:overflow-hidden">
        {mode === 'lettering' ? (
          <Lettering
            user={user}
            config={config}
            setCredits={setCredits}
            refresh={refresh}
            onNeedCredits={() => setShowBuy(true)}
            finish={finish}
            finishPanel={
              <FinishPanel
                ink={ink} setInk={setInk} bg={bg} setBg={setBg}
                mirror={mirror} setMirror={setMirror}
                threshold={threshold} setThreshold={setThreshold}
              />
            }
          />
        ) : (
        <>
        {/* stage */}
        <section
          className={`panel relative flex min-h-[58vh] flex-col overflow-hidden rounded-sm transition lg:h-full lg:min-h-0 ${dragOver ? 'border-red-bright' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]) }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/15 px-3 py-2">
            <Segmented
              value={result ? view : 'original'}
              onChange={setView}
              disabled={!result}
              options={[
                { value: 'ai', label: 'Stencil' },
                { value: 'split', label: 'Compare' },
                { value: 'original', label: 'Photo' },
              ]}
            />
            <div className="stamp flex items-center gap-2 text-[10px] text-paper-3/60">
              {busy && <span className="inkpulse text-red-bright">Inking · {elapsed}s</span>}
              {result && !busy && <span>{result.w}×{result.h} · {(result.ms / 1000).toFixed(0)}s</span>}
            </div>
          </div>

          <div ref={stageRef} className="relative flex flex-1 items-center justify-center p-5">
            {!source ? (
              <div className="flex max-w-sm flex-col items-center gap-5 text-center">
                <div className="rule-double grid h-28 w-28 place-items-center rounded-sm text-gold/60">
                  <svg width="42" height="42" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 12 C10 6 22 6 26 12 C22 18 10 18 6 12 Z" /><circle cx="16" cy="12" r="3.4" />
                    <path d="M16 18 v9 M11 27 h10" />
                  </svg>
                </div>
                <div>
                  <p className="wordmark text-2xl text-paper">Pin a portrait here</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-paper-3/80">
                    Drag a photo in, paste from the clipboard, or browse. A clear, well-lit face works best.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-ink rounded-sm px-5 py-2.5 text-xs">Choose photo</button>
                  <button type="button" onClick={loadSample} className="btn-quiet rounded-sm px-5 py-2.5 text-xs">Try a sample</button>
                </div>
              </div>
            ) : (
              <div className={`relative rounded-sm p-4 ${showResult && bg === 'transparent' ? 'checker' : 'flash-paper'}`}>
                <Corners />
                <div
                  className={`relative overflow-hidden ${view === 'split' && result ? 'cursor-ew-resize' : ''}`}
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
                      <div className="h-full w-0.5 bg-red-bright" />
                      <div className="absolute top-1/2 left-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-paper/40 bg-red text-paper">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
                      </div>
                    </div>
                  )}
                </div>

                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-ink/75 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <svg width="34" height="46" viewBox="0 0 34 46" className="text-red-bright" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M10 4 h14 v10 h-14 z" /><path d="M17 14 v8" />
                        <g className="needle"><path d="M17 22 v14" /><path d="M14 40 h6" /></g>
                      </svg>
                      <p className="wordmark text-xl text-paper">Inking your stencil</p>
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
            <SectionTitle right={<span className="stamp text-[10px] text-paper-3/50">{perStencil} credit each</span>}>Choose a style</SectionTitle>

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
              {STYLES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  data-on={style === st.value}
                  onClick={() => setStyle(st.value)}
                  className="flash-card flex items-center gap-3 rounded-sm px-3 py-2.5 text-left"
                >
                  <span className={`stamp w-6 shrink-0 text-center text-[15px] ${style === st.value ? 'text-red-bright' : 'text-gold/45'}`}>{st.numeral}</span>
                  <span className="min-w-0">
                    <span className="stamp block text-[13px] text-paper">{st.label}</span>
                    <span className="block truncate text-[11px] text-paper-3/70">{st.desc}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <button
                type="button"
                disabled={!source || busy || noKey}
                onClick={canAfford ? generate : () => setShowBuy(true)}
                className="btn-ink flex w-full items-center justify-center gap-2 rounded-sm py-3.5 text-[13px]"
              >
                {busy ? `Inking… ${elapsed}s` : !canAfford ? 'Add credits to continue' : result ? 'Ink it again' : 'Ink it'}
              </button>
              {!source && <p className="stamp mt-2 text-center text-[10px] text-paper-3/50">Pin a photo first</p>}
              {noKey && <p className="mt-2 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[11px] leading-snug text-paper-2">The drawing service is not configured yet. Add OPENAI_API_KEY in Vercel and redeploy.</p>}
              {error && <p className="mt-2 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[11px] leading-snug text-paper-2">{error}</p>}
              {result && !error && <p className="mt-2 text-center text-[11px] text-paper-3/60">Every run is a fresh drawing. Not happy? Ink it again.</p>}
            </div>
          </section>

          <FinishPanel
            ink={ink} setInk={setInk} bg={bg} setBg={setBg}
            mirror={mirror} setMirror={setMirror}
            threshold={threshold} setThreshold={setThreshold}
            sizeNote={`Download gives you the full-size PNG${result ? ` (${result.w}×${result.h})` : ''}, ready to print or send to a thermal printer.`}
          />

          {history.length > 0 && (
            <Panel title="Earlier draws">
              <div className="grid grid-cols-4 gap-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    title={STYLES.find((s) => s.value === h.style)?.label}
                    onClick={() => {
                      setHistory((hst) => [result, ...hst.filter((x) => x.id !== h.id)])
                      setResult(h)
                      setView('ai')
                    }}
                    className="overflow-hidden rounded-sm border border-gold/20 bg-paper transition hover:border-red-bright"
                  >
                    <Thumb bitmap={h.bitmap} />
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <div className="px-1 pb-6 text-center">
            <div className="ornament mb-3"><Diamond className="h-2.5 w-2.5" /></div>
            <p className="text-[11px] leading-snug text-paper-3/55">
              Your photo goes to the AI only when you press Ink it, and is never stored.
              {config?.rupeesPerCredit ? ` Extra credits ₹${config.rupeesPerCredit} each.` : ''}
            </p>
            <nav className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
              {LEGAL.map(([label, slug], i) => (
                <span key={slug} className="flex items-center gap-2.5">
                  {i > 0 && <Diamond className="h-1.5 w-1.5 text-gold/40" />}
                  <a href={`/legal/${slug}.html`} className="stamp text-[10px] text-paper-3/60 hover:text-gold">{label}</a>
                </span>
              ))}
            </nav>
          </div>
        </aside>
        </>
        )}
      </main>

      {askPhone && (
        <PhonePrompt
          onDone={(updated) => {
            setAskPhone(false)
            if (updated) setUser(updated)
          }}
        />
      )}

      {showBuy && (
        <BuyCreditsModal config={config} user={user} onClose={() => setShowBuy(false)} onCredited={(credits) => setCredits(credits)} />
      )}

      {welcome && (
        <div className="fixed inset-x-0 top-4 z-50 mx-auto w-fit max-w-[92vw] rounded-sm border border-gold/50 bg-ink-2 px-5 py-3 text-center shadow-2xl">
          <p className="wordmark text-lg text-paper">Welcome to the studio</p>
          <p className="stamp mt-0.5 text-[11px] text-gold">{welcome} free credits added</p>
          <button type="button" onClick={() => setWelcome(null)} className="stamp mt-2 text-[10px] text-paper-3/60 hover:text-paper">Dismiss</button>
        </div>
      )}

      {mode === 'portrait' && source && (
        <div className="sticky bottom-0 z-10 flex gap-2 border-t border-gold/20 bg-ink/95 p-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-quiet rounded-sm px-4 py-3 text-[11px]">New</button>
          {result ? (
            <button type="button" onClick={exportPNG} className="btn-ink flex-1 rounded-sm py-3 text-[12px]">Download stencil</button>
          ) : (
            <button
              type="button"
              disabled={busy || noKey}
              onClick={canAfford ? generate : () => setShowBuy(true)}
              className="btn-ink flex-1 rounded-sm py-3 text-[12px]"
            >
              {busy ? `Inking… ${elapsed}s` : !canAfford ? 'Add credits' : 'Ink it'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
