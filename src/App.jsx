import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  constants                                                          */
/* ------------------------------------------------------------------ */

const PREVIEW_MAX = 1000 // long-side px used for live preview
const DRAG_SCALE = 0.65 // preview resolution while a slider is being dragged
const EXPORT_CAP = 4000

const DEFAULT_PARAMS = {
  // lines
  lineEngine: 'flow', // flow (coherent line drawing) | canny
  edgeSensitivity: 0.5, // 0..1  (higher = more lines)
  blurSigma: 1.6, // smoothing before edge / flow analysis
  minEdgeLength: 18, // drop fragments shorter than this
  lineWeight: 1.5, // px
  // flow engine
  sigmaC: 1.3, // stroke scale (DoG centre sigma)
  rho: 0.985, // DoG surround weight (higher = only crisp lines)
  sigmaM: 3.0, // integration length along the flow
  etfRadius: 5,
  etfIters: 3,
  fdogIters: 2,
  thinLines: true,
  // canny engine
  hysteresisRatio: 0.4,
  localBalance: 0.6,
  // tone
  brightness: 0,
  contrast: 1.1,
  gamma: 1.0,
  autoLevels: true,
  // shading
  shadeMode: 'mixed', // stipple | diffusion | halftone | hatch | mixed | none
  dotSpacing: 6,
  dotSize: 1.0,
  shadeStrength: 0.8,
  shadeThreshold: 0.42,
  shadeMax: 0.86, // darker than this = hair / background, leave to lines
  shadeGamma: 1.0,
  shadeSmooth: 2.5,
  edgeAvoid: 2,
  bgCut: 0,
  lineDensityCut: 0.09, // skip dots where strokes already cover the area
  hatchFrom: 0.6, // mixed mode: cross-hatch tones darker than this
  halftoneAngle: 45,
  seed: 1,
}

const DEFAULT_OUTPUT = {
  ink: '#0a0a0a',
  bg: 'white', // white | transparent
  mirror: false,
  exportWidth: 1800,
}

const AI_STYLES = [
  { value: 'studio', label: 'Studio stencil', desc: 'Flow lines, skin stipple, hatched lips' },
  { value: 'fineline', label: 'Fine line', desc: 'Thin minimal contours' },
  { value: 'bold', label: 'Bold traditional', desc: 'Heavy outlines, chunky dots' },
  { value: 'dotwork', label: 'Dotwork', desc: 'Everything in dots' },
  { value: 'realism', label: 'Realism map', desc: 'Every contour + shadow zones' },
]
const AI_SEND_MAX = 1536 // long side sent to the model

const INKS = [
  { name: 'Black', value: '#0a0a0a' },
  { name: 'Stencil purple', value: '#5b2a86' },
  { name: 'Thermal blue', value: '#1d3fa3' },
  { name: 'Red', value: '#b91c1c' },
]

const PRESETS = [
  {
    name: 'Studio stencil',
    desc: 'Flow lines, skin stipple, hatched darks',
    params: {},
  },
  {
    name: 'Fine line',
    desc: 'Delicate strokes, light stipple',
    params: { edgeSensitivity: 0.55, blurSigma: 1.4, sigmaC: 0.8, lineWeight: 1.25, minEdgeLength: 14, shadeMode: 'stipple', dotSpacing: 7, dotSize: 0.8, shadeStrength: 0.7, shadeThreshold: 0.45 },
  },
  {
    name: 'Dotwork',
    desc: 'Dense even stippling, strong strokes',
    params: { edgeSensitivity: 0.45, blurSigma: 1.8, sigmaC: 1.2, lineWeight: 1.75, shadeMode: 'diffusion', dotSpacing: 5, dotSize: 1.0, shadeStrength: 0.95, shadeThreshold: 0.3, shadeMax: 0.9 },
  },
  {
    name: 'Bold traditional',
    desc: 'Thick clean outlines, chunky halftone',
    params: { edgeSensitivity: 0.32, blurSigma: 2.4, sigmaC: 1.6, sigmaM: 4, lineWeight: 3.5, minEdgeLength: 35, contrast: 1.3, shadeMode: 'halftone', dotSpacing: 11, dotSize: 1.4, shadeStrength: 0.9, shadeThreshold: 0.45, shadeGamma: 1.0, edgeAvoid: 3 },
  },
  {
    name: 'Sketch / hatch',
    desc: 'Pencil-style cross hatching',
    params: { edgeSensitivity: 0.5, blurSigma: 1.5, lineWeight: 1.4, shadeMode: 'hatch', dotSpacing: 6, dotSize: 1.0, shadeStrength: 0.85, shadeThreshold: 0.35, shadeMax: 1 },
  },
  {
    name: 'Canny detail',
    desc: 'Technical every-edge map',
    params: { lineEngine: 'canny', edgeSensitivity: 0.5, blurSigma: 1.4, lineWeight: 1.25, minEdgeLength: 12, shadeMode: 'stipple', dotSpacing: 8, dotSize: 0.7, shadeStrength: 0.55, shadeThreshold: 0.45 },
  },
  {
    name: 'Lines only',
    desc: 'Pure outline transfer, no shading',
    params: { edgeSensitivity: 0.5, blurSigma: 1.8, lineWeight: 2, minEdgeLength: 24, shadeMode: 'none' },
  },
]

/* ------------------------------------------------------------------ */
/*  worker wrapper                                                     */
/* ------------------------------------------------------------------ */

function createProcessor() {
  const worker = new Worker(new URL('./stencil.worker.js', import.meta.url), { type: 'module' })
  let seq = 0
  const pending = new Map()
  worker.onmessage = (e) => {
    const cb = pending.get(e.data.id)
    if (cb) {
      pending.delete(e.data.id)
      cb(e.data)
    }
  }
  worker.onerror = (e) => console.error('worker error', e)
  return {
    run(imageData, params) {
      const id = ++seq
      return new Promise((resolve) => {
        pending.set(id, resolve)
        worker.postMessage(
          { id, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer, params },
          [imageData.data.buffer],
        )
      })
    },
    terminate: () => worker.terminate(),
  }
}

/* scale spatial parameters when rendering at a different resolution */
function scaleParams(p, f) {
  return {
    ...p,
    blurSigma: p.blurSigma * f,
    sigmaC: p.sigmaC * f,
    sigmaM: p.sigmaM * f,
    etfRadius: Math.round(p.etfRadius * f),
    minEdgeLength: Math.round(p.minEdgeLength * f),
    lineWeight: 1 + (p.lineWeight - 1) * f,
    dotSpacing: p.dotSpacing * f,
    dotSize: p.dotSize * f,
    edgeAvoid: p.edgeAvoid * f,
    shadeSmooth: p.shadeSmooth * f,
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/* draw a worker result onto a 2D context */
function renderResult(ctx, res, out, scratch) {
  const { width: w, height: h } = res
  const edges = new Uint8Array(res.edges)
  const dots = new Float32Array(res.dots)
  const segs = new Float32Array(res.segs)
  const cw = ctx.canvas.width, ch = ctx.canvas.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  if (out.bg === 'white') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
  }
  if (out.mirror) {
    ctx.translate(cw, 0)
    ctx.scale(-1, 1)
  }
  // edges → image data
  const [r, g, b] = hexToRgb(out.ink)
  const img = new ImageData(w, h)
  const d = img.data
  for (let i = 0, j = 0; i < edges.length; i++, j += 4) {
    if (edges[i]) {
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255
    }
  }
  scratch.width = w
  scratch.height = h
  scratch.getContext('2d').putImageData(img, 0, 0)
  ctx.drawImage(scratch, 0, 0)
  // dots
  if (dots.length) {
    ctx.fillStyle = out.ink
    ctx.beginPath()
    for (let i = 0; i < dots.length; i += 3) {
      const x = dots[i], y = dots[i + 1], rad = dots[i + 2]
      ctx.moveTo(x + rad, y)
      ctx.arc(x, y, rad, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  // hatch segments
  if (segs.length) {
    ctx.strokeStyle = out.ink
    ctx.lineCap = 'round'
    for (let i = 0; i < segs.length; i += 5) {
      ctx.lineWidth = segs[i + 4]
      ctx.beginPath()
      ctx.moveTo(segs[i], segs[i + 1])
      ctx.lineTo(segs[i + 2], segs[i + 3])
      ctx.stroke()
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  small UI atoms                                                     */
/* ------------------------------------------------------------------ */

function Slider({ label, value, min, max, step = 1, onChange, format = (v) => v, hint }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="block select-none">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="font-mono tabular-nums text-neutral-400">{format(value)}</span>
      </div>
      <input
        type="range"
        className="range w-full"
        style={{ '--fill': `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <p className="-mt-0.5 text-[11px] leading-snug text-neutral-500">{hint}</p>}
    </label>
  )
}

function Section({ title, badge, children, defaultOpen = true, onReset }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-neutral-100"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-normal text-neutral-400">{badge}</span>}
        </span>
        <span className="flex items-center gap-3">
          {onReset && open && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onReset() }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onReset() } }}
              className="text-[11px] text-neutral-500 hover:text-accent"
            >
              reset
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && <div className="space-y-3.5 px-4 pb-4">{children}</div>}
    </div>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="grid gap-1 rounded-lg bg-neutral-800/80 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
            value === o.value ? 'bg-neutral-100 text-neutral-900 shadow' : 'text-neutral-400 hover:text-neutral-100'
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

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [source, setSource] = useState(null) // { bitmap, w, h, name }
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [out, setOut] = useState(DEFAULT_OUTPUT)
  const [view, setView] = useState('stencil') // stencil | original | split
  const [split, setSplit] = useState(50)
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [quality, setQuality] = useState('full') // 'fast' while dragging a slider
  const [ai, setAi] = useState({ style: 'studio', size: '2K', busy: false, error: null, result: null, threshold: 0 })
  const aiCanvasRef = useRef(null)

  const previewRef = useRef(null) // stencil canvas
  const originalRef = useRef(null) // original canvas (preview res)
  const stageRef = useRef(null)
  const scratchRef = useRef(document.createElement('canvas'))
  const processorRef = useRef(null)
  const lastResultRef = useRef(null)
  const jobRef = useRef({ running: false, queued: null })
  const fileInputRef = useRef(null)

  const setParam = useCallback((k, v) => setParams((p) => ({ ...p, [k]: v })), [])
  const setOutput = useCallback((k, v) => setOut((p) => ({ ...p, [k]: v })), [])

  useEffect(() => {
    processorRef.current = createProcessor()
    return () => processorRef.current?.terminate()
  }, [])

  /* preview dimensions */
  const preview = useMemo(() => {
    if (!source) return null
    const s = Math.min(1, PREVIEW_MAX / Math.max(source.w, source.h))
    return { w: Math.round(source.w * s), h: Math.round(source.h * s), scale: s }
  }, [source])

  /* ---------------- loading ---------------- */
  const loadFile = useCallback(async (file) => {
    if (!file) return
    if (!/^image\/(png|jpeg|jpg|webp|bmp|gif)$/i.test(file.type)) {
      setError('Please choose a JPEG, PNG or WebP image.')
      return
    }
    setError(null)
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      setSource({ bitmap, w: bitmap.width, h: bitmap.height, name: file.name.replace(/\.[^.]+$/, '') })
      setView('stencil')
    } catch (e) {
      console.error(e)
      setError('Could not decode that image.')
    }
  }, [])

  const loadSample = useCallback(async (name = 'portrait2') => {
    const res = await fetch(`/samples/${name}.jpg`)
    const blob = await res.blob()
    await loadFile(new File([blob], `sample-${name}.jpg`, { type: 'image/jpeg' }))
  }, [loadFile])

  /* paste support */
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  /* draw original to its preview canvas */
  useEffect(() => {
    if (!source || !preview) return
    const c = originalRef.current
    if (!c) return
    c.width = preview.w
    c.height = preview.h
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.bitmap, 0, 0, preview.w, preview.h)
  }, [source, preview])

  /* ---------------- live processing (latest-wins) ---------------- */
  const runPreview = useCallback(
    async (p, fast) => {
      if (!source || !preview) return
      const job = jobRef.current
      if (job.running) {
        job.queued = [p, fast]
        return
      }
      job.running = true
      setBusy(true)
      try {
        const f = fast ? DRAG_SCALE : 1
        const w = Math.round(preview.w * f), h = Math.round(preview.h * f)
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(source.bitmap, 0, 0, w, h)
        const data = ctx.getImageData(0, 0, w, h)
        const res = await processorRef.current.run(data, f === 1 ? p : scaleParams(p, f))
        lastResultRef.current = res
        if (res.timings) console.debug('stencil timings', res.timings.map(([k, v]) => `${k}:${v}`).join(' '))
        setStats({ ms: res.ms, dots: res.dotCount, segs: res.segCount, w: res.width, h: res.height, fast })
      } finally {
        job.running = false
        if (job.queued) {
          const [np, nf] = job.queued
          job.queued = null
          runPreview(np, nf)
        } else {
          setBusy(false)
        }
      }
    },
    [source, preview],
  )

  useEffect(() => {
    if (!source) return
    const t = setTimeout(() => runPreview(params, quality === 'fast'), 30)
    return () => clearTimeout(t)
  }, [params, source, quality, runPreview])

  /* drop to a smaller working size while a slider is held down */
  useEffect(() => {
    const up = () => setQuality('full')
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  /* paint whenever a result or an output option changes */
  useEffect(() => {
    const res = lastResultRef.current
    const c = previewRef.current
    if (!res || !c) return
    if (c.width !== res.width || c.height !== res.height) {
      c.width = res.width
      c.height = res.height
    }
    renderResult(c.getContext('2d'), res, out, scratchRef.current)
  }, [stats, out])

  /* fit canvas to stage */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!preview) return
      const pw = el.clientWidth - 24, ph = el.clientHeight - 24
      const s = Math.min(pw / preview.w, ph / preview.h)
      setFit({ w: Math.floor(preview.w * s), h: Math.floor(preview.h * s) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [preview])

  /* ---------------- AI stencil ---------------- */
  const generateAI = useCallback(async () => {
    if (!source) return
    setAi((a) => ({ ...a, busy: true, error: null }))
    try {
      const s = Math.min(1, AI_SEND_MAX / Math.max(source.w, source.h))
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
        body: JSON.stringify({ image, style: ai.style, size: ai.size, width: w, height: h }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `Server error ${r.status}`)
      const blob = await (await fetch(json.image)).blob()
      const bitmap = await createImageBitmap(blob)
      setAi((a) => ({ ...a, busy: false, result: { bitmap, w: bitmap.width, h: bitmap.height, model: json.model, ms: json.ms } }))
      setView('ai')
    } catch (e) {
      console.error(e)
      setAi((a) => ({ ...a, busy: false, error: e.message }))
    }
  }, [source, ai.style, ai.size])

  /* draw the AI result (with optional clean-up) onto a canvas */
  const renderAI = useCallback((ctx, targetW, targetH) => {
    const res = ai.result
    if (!res) return
    const cw = ctx.canvas.width, ch = ctx.canvas.height
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    if (out.mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1) }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(res.bitmap, 0, 0, targetW, targetH)
    ctx.restore()
    // clean-up: map luminance → ink alpha, threshold, recolour
    const img = ctx.getImageData(0, 0, cw, ch)
    const d = img.data
    const [ir, ig, ib] = hexToRgb(out.ink)
    const white = out.bg === 'white'
    const thr = ai.threshold // 0 = keep anti-aliasing, >0 = hard black/white cut
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      let inkA = 1 - lum / 255
      if (thr > 0) inkA = inkA > thr ? 1 : 0
      if (white) {
        d[i] = Math.round(255 + (ir - 255) * inkA)
        d[i + 1] = Math.round(255 + (ig - 255) * inkA)
        d[i + 2] = Math.round(255 + (ib - 255) * inkA)
        d[i + 3] = 255
      } else {
        d[i] = ir; d[i + 1] = ig; d[i + 2] = ib
        d[i + 3] = Math.round(inkA * 255)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [ai.result, ai.threshold, out])

  useEffect(() => {
    const c = aiCanvasRef.current
    if (!c || !ai.result) return
    const s = Math.min(1, PREVIEW_MAX / Math.max(ai.result.w, ai.result.h))
    c.width = Math.round(ai.result.w * s)
    c.height = Math.round(ai.result.h * s)
    renderAI(c.getContext('2d', { willReadFrequently: true }), c.width, c.height)
  }, [ai.result, renderAI])

  const exportAI = useCallback(async () => {
    if (!ai.result) return
    const c = document.createElement('canvas')
    c.width = ai.result.w
    c.height = ai.result.h
    renderAI(c.getContext('2d', { willReadFrequently: true }), c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${source?.name || 'portrait'}-ai-stencil-${ai.style}${out.mirror ? '-mirrored' : ''}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [ai.result, ai.style, renderAI, out.mirror, source])

  /* ---------------- export ---------------- */
  const exportPNG = useCallback(async () => {
    if (!source || !preview) return
    setExporting(true)
    try {
      const targetW = Math.min(EXPORT_CAP, out.exportWidth === 'original' ? source.w : out.exportWidth)
      const s = targetW / source.w
      const w = Math.round(source.w * s), h = Math.round(source.h * s)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source.bitmap, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h)
      const proc = createProcessor() // separate worker so preview stays live
      const res = await proc.run(data, scaleParams(params, w / preview.w))
      proc.terminate()
      const outC = document.createElement('canvas')
      outC.width = w
      outC.height = h
      renderResult(outC.getContext('2d'), res, out, document.createElement('canvas'))
      const blob = await new Promise((r) => outC.toBlob(r, 'image/png'))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${source.name}-stencil-${w}px${out.mirror ? '-mirrored' : ''}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      console.error(e)
      setError('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }, [source, preview, params, out])

  /* ---------------- drag & drop ---------------- */
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    loadFile(e.dataTransfer.files?.[0])
  }

  /* split-view drag */
  const onSplitPointer = (e) => {
    if (view !== 'split') return
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

  const applyPreset = (preset) => setParams({ ...DEFAULT_PARAMS, ...preset.params, seed: params.seed, bgCut: params.bgCut, brightness: params.brightness, gamma: params.gamma })
  const resetKeys = (keys) => setParams((p) => ({ ...p, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_PARAMS[k]])) }))

  /* ------------------------------------------------------------------ */
  /*  render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex h-full min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      {/* header */}
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-neutral-950">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-lg leading-tight tracking-wide">Tattoo Stencil Studio</h1>
            <p className="hidden text-[11px] text-neutral-500 sm:block">Portrait → clean outlines + dotwork shading, all in your browser</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium hover:border-neutral-500"
          >
            {source ? 'Replace photo' : 'Upload'}
          </button>
          <button
            type="button"
            disabled={!source || exporting}
            onClick={view === 'ai' && ai.result ? exportAI : exportPNG}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-900/30 border-t-neutral-900" />
                Rendering…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                <span className="hidden sm:inline">Export PNG</span>
                <span className="sm:hidden">Export</span>
              </>
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between bg-red-900/40 px-4 py-2 text-sm text-red-200 sm:px-6">
          {error}
          <button type="button" onClick={() => setError(null)} className="text-red-300 hover:text-white">✕</button>
        </div>
      )}

      {/* body */}
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        {/* stage */}
        <section
          className={`relative flex min-h-[55vh] flex-col overflow-hidden rounded-2xl border transition lg:min-h-0 ${
            dragOver ? 'border-accent bg-accent/5' : 'border-neutral-800 bg-neutral-900/40'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {/* stage toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'stencil', label: 'Algorithm' },
                ...(ai.result ? [{ value: 'ai', label: 'AI' }] : []),
                { value: 'split', label: 'Compare' },
                { value: 'original', label: 'Original' },
              ]}
            />
            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              {busy && <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />{stats?.fast ? 'quick preview' : 'processing'}</span>}
              {view === 'ai' && ai.result && (
                <span className="font-mono tabular-nums">{ai.result.w}×{ai.result.h} · {ai.result.model} · {(ai.result.ms / 1000).toFixed(1)} s</span>
              )}
              {stats && view !== 'ai' && (
                <span className="font-mono tabular-nums">
                  {stats.w}×{stats.h} · {stats.dots.toLocaleString()} dots{stats.segs ? ` · ${stats.segs.toLocaleString()} strokes` : ''} · {Math.round(stats.ms)} ms
                </span>
              )}
            </div>
          </div>

          {/* canvas area */}
          <div ref={stageRef} className={`relative flex flex-1 items-center justify-center p-3 ${out.bg === 'transparent' ? 'checker' : ''}`}>
            {!source ? (
              <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-neutral-700 text-neutral-500">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                </div>
                <div>
                  <p className="text-base font-medium">Drop a portrait here</p>
                  <p className="mt-1 text-sm text-neutral-500">JPEG, PNG or WebP · or paste from clipboard · nothing is uploaded, everything runs locally</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-white">Choose photo</button>
                  <button type="button" onClick={() => loadSample('portrait2')} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">Try sample</button>
                  <button type="button" onClick={() => loadSample('portrait')} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">Sample 2</button>
                </div>
              </div>
            ) : (
              <div
                className={`relative select-none overflow-hidden rounded-md shadow-2xl shadow-black/60 ${view === 'split' ? 'cursor-ew-resize' : ''}`}
                style={{ width: fit.w || undefined, height: fit.h || undefined }}
                onPointerDown={onSplitPointer}
              >
                <canvas ref={previewRef} className="block h-full w-full" style={{ display: view === 'ai' ? 'none' : 'block' }} />
                <canvas ref={aiCanvasRef} className="absolute inset-0 h-full w-full" style={{ display: view === 'ai' ? 'block' : 'none' }} />
                <canvas
                  ref={originalRef}
                  className="absolute inset-0 h-full w-full"
                  style={{
                    display: view === 'stencil' || view === 'ai' ? 'none' : 'block',
                    clipPath: view === 'split' ? `inset(0 ${100 - split}% 0 0)` : undefined,
                    transform: out.mirror ? 'scaleX(-1)' : undefined,
                  }}
                />
                {view === 'split' && (
                  <div className="pointer-events-none absolute inset-y-0" style={{ left: `calc(${split}% - 1px)` }}>
                    <div className="h-full w-0.5 bg-accent shadow" />
                    <div className="absolute top-1/2 left-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-neutral-950 shadow">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
                    </div>
                  </div>
                )}
                {busy && !stats && <div className="shimmer absolute inset-0" />}
              </div>
            )}
          </div>
        </section>

        {/* control panel */}
        <aside
          className="scrollbar-thin space-y-3 lg:overflow-y-auto lg:pr-1"
          onPointerDown={(e) => { if (e.target.matches('input[type="range"]')) setQuality('fast') }}
        >
          {/* AI stencil */}
          <div className="rounded-xl border border-accent/40 bg-gradient-to-b from-accent/10 to-transparent p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-medium tracking-wider text-accent uppercase">AI stencil</p>
              <span className="text-[10px] text-neutral-500">Gemini image model</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
              {AI_STYLES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setAi((a) => ({ ...a, style: st.value }))}
                  className={`rounded-lg border px-2.5 py-2 text-left ${ai.style === st.value ? 'border-accent bg-accent/10' : 'border-neutral-800 bg-neutral-800/50 hover:border-neutral-600'}`}
                  title={st.desc}
                >
                  <span className="block text-xs font-medium">{st.label}</span>
                  <span className="block truncate text-[10px] text-neutral-500">{st.desc}</span>
                </button>
              ))}
            </div>
            <div className="mt-2">
              <Segmented value={ai.size} onChange={(v) => setAi((a) => ({ ...a, size: v }))} options={[{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' }]} />
            </div>
            <button
              type="button"
              disabled={!source || ai.busy}
              onClick={generateAI}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-neutral-950 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ai.busy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-900/30 border-t-neutral-900" />
                  Drawing… (10–40 s)
                </>
              ) : (
                <>✦ Generate AI stencil</>
              )}
            </button>
            {ai.error && <p className="mt-2 rounded-md bg-red-900/40 px-2 py-1.5 text-[11px] leading-snug text-red-200">{ai.error}</p>}
            {ai.result && (
              <div className="mt-3 space-y-3 border-t border-neutral-800 pt-3">
                <Toggle label="Hard black & white" hint="Threshold the drawing to pure ink for thermal transfer" checked={ai.threshold > 0} onChange={(v) => setAi((a) => ({ ...a, threshold: v ? 0.45 : 0 }))} />
                {ai.threshold > 0 && (
                  <Slider label="Ink cut-off" value={ai.threshold} min={0.1} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setAi((a) => ({ ...a, threshold: v }))} hint="Lower keeps faint marks; higher keeps only solid ink." />
                )}
                <p className="text-[11px] text-neutral-500">Ink colour, background and mirror from the Output section apply to the AI stencil too. Not happy? Generate again — every run is a fresh drawing.</p>
              </div>
            )}
            <p className="mt-2 px-1 text-[10px] leading-snug text-neutral-500">Sends a downsized copy of the photo to Google's Gemini image model. Costs the owner roughly $0.05–0.15 per image.</p>
          </div>

          {/* presets */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
            <p className="mb-2 px-1 text-[11px] font-medium tracking-wider text-neutral-500 uppercase">Presets</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
              {PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  type="button"
                  onClick={() => applyPreset(pr)}
                  className="rounded-lg border border-neutral-800 bg-neutral-800/50 px-2.5 py-2 text-left hover:border-accent/60 hover:bg-neutral-800"
                  title={pr.desc}
                >
                  <span className="block text-xs font-medium">{pr.name}</span>
                  <span className="block truncate text-[10px] text-neutral-500">{pr.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Section title="Lines" badge={params.lineEngine === 'flow' ? 'flow / FDoG' : 'Canny'} onReset={() => resetKeys(['lineEngine', 'edgeSensitivity', 'blurSigma', 'hysteresisRatio', 'minEdgeLength', 'lineWeight', 'localBalance', 'sigmaC', 'rho', 'sigmaM', 'etfIters', 'fdogIters', 'thinLines'])}>
            <Segmented
              value={params.lineEngine}
              onChange={(v) => setParam('lineEngine', v)}
              options={[
                { value: 'flow', label: 'Flow strokes' },
                { value: 'canny', label: 'Canny edges' },
              ]}
            />
            <Slider label="Line sensitivity" value={params.edgeSensitivity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setParam('edgeSensitivity', v)} hint="Higher = more strokes (pores, stray hair). Lower = only strong features." />
            <Slider label="Detail / smoothing" value={params.blurSigma} min={0.4} max={5} step={0.1} format={(v) => `σ ${v.toFixed(1)}`} onChange={(v) => setParam('blurSigma', v)} hint="Blur before analysis. Low keeps fine texture; high gives smooth, sparse contours." />
            {params.lineEngine === 'flow' ? (
              <>
                <Slider label="Stroke scale" value={params.sigmaC} min={0.5} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setParam('sigmaC', v)} hint="Size of feature that becomes a stroke. Small = hair strands and fine lines; large = only broad contours." />
                <Slider label="Stroke length" value={params.sigmaM} min={1} max={8} step={0.25} format={(v) => v.toFixed(2)} onChange={(v) => setParam('sigmaM', v)} hint="How far each stroke is smoothed along the flow. Higher = longer, calmer, more connected lines." />
                <Slider label="Crispness" value={params.rho} min={0.9} max={0.999} step={0.001} format={(v) => v.toFixed(3)} onChange={(v) => setParam('rho', v)} hint="Suppresses soft gradients so only real lines remain." />
                <Slider label="Flow coherence" value={params.etfIters} min={1} max={5} step={1} format={(v) => `${v} pass`} onChange={(v) => setParam('etfIters', v)} />
                <Slider label="Refinement" value={params.fdogIters} min={1} max={3} step={1} format={(v) => `${v} pass`} onChange={(v) => setParam('fdogIters', v)} hint="Re-runs with found lines painted in, sharpening and connecting them." />
                <Toggle label="Thin to single strokes" hint="Skeletonise lines to 1 px before applying line weight" checked={params.thinLines} onChange={(v) => setParam('thinLines', v)} />
              </>
            ) : (
              <>
                <Slider label="Local balance" value={params.localBalance} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setParam('localBalance', v)} hint="Evens out edge strength across the face so soft features aren't drowned out by busy hair or clothing." />
                <Slider label="Line continuity" value={params.hysteresisRatio} min={0.15} max={0.9} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setParam('hysteresisRatio', v)} hint="Lower lets strong edges keep tracing through faint areas (longer continuous lines)." />
              </>
            )}
            <Slider label="Line weight" value={params.lineWeight} min={1} max={6} step={0.25} format={(v) => `${v.toFixed(2)} px`} onChange={(v) => setParam('lineWeight', v)} />
            <Slider label="Remove specks under" value={params.minEdgeLength} min={0} max={80} step={1} format={(v) => `${v} px`} onChange={(v) => setParam('minEdgeLength', v)} />
          </Section>

          <Section title="Tone" onReset={() => resetKeys(['brightness', 'contrast', 'gamma', 'autoLevels'])}>
            <Slider label="Brightness" value={params.brightness} min={-100} max={100} step={1} format={(v) => (v > 0 ? `+${v}` : v)} onChange={(v) => setParam('brightness', v)} />
            <Slider label="Contrast" value={params.contrast} min={0.4} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setParam('contrast', v)} />
            <Toggle label="Auto levels" hint="Stretch the photo's tones to full range before analysis" checked={params.autoLevels} onChange={(v) => setParam('autoLevels', v)} />
            <Slider label="Gamma" value={params.gamma} min={0.4} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setParam('gamma', v)} hint="Below 1 darkens midtones (more shading); above 1 lifts them." />
          </Section>

          <Section title="Shading" badge={params.shadeMode} onReset={() => resetKeys(['shadeMode', 'dotSpacing', 'dotSize', 'shadeStrength', 'shadeThreshold', 'shadeGamma', 'shadeSmooth', 'edgeAvoid', 'bgCut', 'halftoneAngle', 'shadeMax', 'lineDensityCut', 'hatchFrom'])}>
            <Segmented
              value={params.shadeMode}
              onChange={(v) => setParam('shadeMode', v)}
              options={[
                { value: 'mixed', label: 'Mixed' },
                { value: 'stipple', label: 'Stipple' },
                { value: 'diffusion', label: 'Even' },
                { value: 'halftone', label: 'Halftone' },
                { value: 'hatch', label: 'Hatch' },
                { value: 'none', label: 'Off' },
              ]}
            />
            {params.shadeMode !== 'none' && (
              <>
                <Slider label={params.shadeMode === 'hatch' ? 'Line spacing' : 'Dot spacing'} value={params.dotSpacing} min={2.5} max={24} step={0.5} format={(v) => `${v} px`} onChange={(v) => setParam('dotSpacing', v)} />
                <Slider label={params.shadeMode === 'hatch' ? 'Stroke width' : 'Dot size'} value={params.dotSize} min={0.3} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setParam('dotSize', v)} />
                <Slider label="Density" value={params.shadeStrength} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setParam('shadeStrength', v)} />
                <Slider label="Shade from" value={params.shadeThreshold} min={0} max={0.85} step={0.01} format={(v) => `${Math.round(v * 100)}% dark`} onChange={(v) => setParam('shadeThreshold', v)} hint="Areas lighter than this stay blank skin." />
                <Slider label="Ignore darker than" value={params.shadeMax} min={0.4} max={1} step={0.01} format={(v) => (v >= 1 ? 'off' : `${Math.round(v * 100)}% dark`)} onChange={(v) => setParam('shadeMax', v)} hint="Very dark areas (hair, backdrop) are left to the strokes instead of filling with dots." />
                {params.shadeMode === 'mixed' && (
                  <Slider label="Hatch from" value={params.hatchFrom} min={0.3} max={0.95} step={0.01} format={(v) => `${Math.round(v * 100)}% dark`} onChange={(v) => setParam('hatchFrom', v)} hint="Tones darker than this get cross-hatching (lips, deep shadows); lighter tones get dots." />
                )}
                <Slider label="Falloff" value={params.shadeGamma} min={0.4} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setParam('shadeGamma', v)} hint="Higher pushes dots into only the darkest areas." />
                <Slider label="Tone smoothing" value={params.shadeSmooth} min={0.5} max={8} step={0.25} format={(v) => `σ ${v}`} onChange={(v) => setParam('shadeSmooth', v)} />
                <Slider label="Gap from lines" value={params.edgeAvoid} min={0} max={8} step={0.5} format={(v) => `${v} px`} onChange={(v) => setParam('edgeAvoid', v)} hint="Keeps shading off the outlines so they read cleanly on skin." />
                <Slider label="Skip line-dense areas" value={params.lineDensityCut} min={0} max={0.3} step={0.005} format={(v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`)} onChange={(v) => setParam('lineDensityCut', v)} hint="Where strokes already cover the area (hair, fabric) no dots are added. Lower = more aggressive." />
                <Slider label="Background cut" value={params.bgCut} min={0} max={0.5} step={0.01} format={(v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`)} onChange={(v) => setParam('bgCut', v)} hint="Flood-fills a uniform backdrop from the photo edges and leaves it unshaded. Raise until the backdrop clears." />
                {params.shadeMode === 'halftone' && (
                  <Slider label="Screen angle" value={params.halftoneAngle} min={0} max={90} step={1} format={(v) => `${v}°`} onChange={(v) => setParam('halftoneAngle', v)} />
                )}
                {(params.shadeMode === 'stipple' || params.shadeMode === 'diffusion' || params.shadeMode === 'mixed') && (
                  <button type="button" onClick={() => setParam('seed', params.seed + 1)} className="w-full rounded-lg border border-neutral-800 py-1.5 text-xs text-neutral-300 hover:border-neutral-600">
                    ↻ Reshuffle dots (seed {params.seed})
                  </button>
                )}
              </>
            )}
          </Section>

          <Section title="Output">
            <div>
              <p className="mb-1.5 text-xs text-neutral-300">Ink colour</p>
              <div className="flex items-center gap-2">
                {INKS.map((ink) => (
                  <button
                    key={ink.value}
                    type="button"
                    title={ink.name}
                    onClick={() => setOutput('ink', ink.value)}
                    className={`h-7 w-7 rounded-full border-2 ${out.ink === ink.value ? 'border-accent' : 'border-neutral-700'}`}
                    style={{ background: ink.value }}
                  />
                ))}
                <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 border-neutral-700" title="Custom colour">
                  <span className="absolute inset-0 grid place-items-center text-[11px] text-neutral-300" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
                  <input type="color" value={out.ink} onChange={(e) => setOutput('ink', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <span className="ml-1 font-mono text-[11px] text-neutral-500">{out.ink}</span>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-neutral-300">Background</p>
              <Segmented value={out.bg} onChange={(v) => setOutput('bg', v)} options={[{ value: 'white', label: 'White' }, { value: 'transparent', label: 'Transparent' }]} />
            </div>
            <Toggle label="Mirror for transfer" hint="Flip horizontally so the stencil reads correctly once applied to skin" checked={out.mirror} onChange={(v) => setOutput('mirror', v)} />
            <div>
              <p className="mb-1.5 text-xs text-neutral-300">Export width</p>
              <div className="grid grid-cols-5 gap-1">
                {[1200, 1800, 2400, 3200, 'original'].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setOutput('exportWidth', w)}
                    className={`rounded-md border px-1 py-1.5 text-[11px] ${out.exportWidth === w ? 'border-accent bg-accent/10 text-accent' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'}`}
                  >
                    {w === 'original' ? (source ? `${Math.min(EXPORT_CAP, source.w)}` : 'orig') : w}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">Pixels wide. Lines and dots are re-rendered at full resolution, not upscaled. Print at 300 dpi: 2400 px ≈ 20 cm.</p>
            </div>
          </Section>

          <p className="px-2 pb-6 text-center text-[11px] text-neutral-600">
            Processing runs in a Web Worker on your device. Photos never leave the browser.
          </p>
        </aside>
      </main>

      {/* mobile sticky export */}
      {source && (
        <div className="sticky bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/90 p-3 backdrop-blur lg:hidden">
          <button type="button" disabled={exporting} onClick={view === 'ai' && ai.result ? exportAI : exportPNG} className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50">
            {exporting ? 'Rendering high-res…' : view === 'ai' && ai.result ? `Export AI stencil · ${ai.result.w} px` : `Export PNG · ${out.exportWidth === 'original' ? 'original size' : out.exportWidth + ' px'}`}
          </button>
        </div>
      )}
    </div>
  )
}
