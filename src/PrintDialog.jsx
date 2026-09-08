/*
 * Print at the size it will actually be tattooed.
 *
 * A PNG has no physical size, so "download and print" usually comes out
 * whatever size the printer felt like. This lays the stencil onto an A4 sheet
 * at a size given in millimetres or inches, fits as many copies as will go,
 * and prints through the browser's own page box (@page size: A4, zero margin)
 * so 60 mm on screen is 60 mm on paper.
 *
 * The 50 mm check bar is there because printer drivers still love to "fit to
 * page" — measure it once and you know whether the sheet can be trusted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paintStencil } from './stencil.js'

const A4 = { w: 210, h: 297 }      // millimetres
const MARGIN = 8                   // keeps clear of the unprintable edge
const GAP = 6
const MM_PER_IN = 25.4

const UNITS = {
  mm: { label: 'mm', step: 1, dp: 0, from: (mm) => mm, to: (v) => v },
  cm: { label: 'cm', step: 0.1, dp: 1, from: (mm) => mm / 10, to: (v) => v * 10 },
  in: { label: 'inches', step: 0.05, dp: 2, from: (mm) => mm / MM_PER_IN, to: (v) => v * MM_PER_IN },
}

/** Where each copy sits on the sheet, in millimetres. */
function layout({ sheet, itemW, itemH, copies }) {
  const printW = sheet.w - MARGIN * 2
  const printH = sheet.h - MARGIN * 2
  const maxCols = Math.max(1, Math.floor((printW + GAP) / (itemW + GAP)))
  const maxRows = Math.max(1, Math.floor((printH + GAP) / (itemH + GAP)))

  let cols = maxCols, rows = maxRows
  if (copies !== 'auto') {
    const n = Number(copies)
    cols = maxCols
    for (let c = 1; c <= maxCols; c++) {
      if (Math.ceil(n / c) <= maxRows) { cols = c; break }
    }
    rows = Math.ceil(n / cols)
  }
  const total = copies === 'auto' ? cols * rows : Math.min(Number(copies), maxCols * maxRows)
  if (!total) return { items: [], cols: 0, rows: 0, fits: false, perSheet: maxCols * maxRows }

  const usedW = cols * itemW + (cols - 1) * GAP
  const left = (sheet.w - usedW) / 2
  const usedH = rows * itemH + (rows - 1) * GAP
  const top = Math.max(MARGIN, (sheet.h - usedH) / 2)

  const items = []
  for (let i = 0; i < total; i++) {
    const c = i % cols, r = Math.floor(i / cols)
    items.push({ x: left + c * (itemW + GAP), y: top + r * (itemH + GAP) })
  }
  return { items, cols, rows, fits: true, perSheet: maxCols * maxRows }
}

/** The stencil on its own, re-inked, at a given pixel size. */
function renderTile(bitmap, w, h, finish) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  paintStencil(c.getContext('2d', { willReadFrequently: true }), bitmap, finish)
  return c
}

export default function PrintDialog({ bitmap, w, h, finish, filename = 'stencil', onClose }) {
  const ratio = h / w
  const [unit, setUnit] = useState('mm')
  const [widthMm, setWidthMm] = useState(() => Math.min(90, A4.w - MARGIN * 2))
  const [copies, setCopies] = useState(1)
  const [orientation, setOrientation] = useState('portrait')
  const [guides, setGuides] = useState(true)
  const [checkBar, setCheckBar] = useState(true)
  const [dpi, setDpi] = useState(300)
  const [busy, setBusy] = useState(false)
  const previewRef = useRef(null)

  const u = UNITS[unit]
  const sheet = orientation === 'portrait' ? A4 : { w: A4.h, h: A4.w }
  const heightMm = widthMm * ratio
  const maxWidthMm = Math.min(sheet.w - MARGIN * 2, (sheet.h - MARGIN * 2) / ratio)

  useEffect(() => {
    setWidthMm((mm) => Math.min(mm, maxWidthMm))
  }, [maxWidthMm])

  const plan = useMemo(
    () => layout({ sheet, itemW: widthMm, itemH: heightMm, copies }),
    [sheet, widthMm, heightMm, copies],
  )

  const setFromDisplay = (value, dim) => {
    const mm = u.to(Number(value) || 0)
    const asWidth = dim === 'w' ? mm : mm / ratio
    setWidthMm(Math.max(5, Math.min(maxWidthMm, asWidth)))
  }
  const show = (mm) => (Math.round(u.from(mm) * 10 ** u.dp) / 10 ** u.dp).toFixed(u.dp)

  /* ---------------- draw the sheet ---------------- */

  const drawSheet = useCallback((ctx, pxPerMm, { forPreview }) => {
    const tileW = widthMm * pxPerMm
    const tile = renderTile(bitmap, tileW, tileW * ratio, finish)

    ctx.canvas.width = Math.round(sheet.w * pxPerMm)
    ctx.canvas.height = Math.round(sheet.h * pxPerMm)
    if (finish.bg !== 'transparent' || forPreview) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    }
    ctx.imageSmoothingQuality = 'high'

    for (const it of plan.items) {
      const x = it.x * pxPerMm, y = it.y * pxPerMm
      ctx.drawImage(tile, x, y, tileW, tileW * ratio)
      if (guides) {
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'
        ctx.lineWidth = Math.max(1, 0.2 * pxPerMm)
        ctx.setLineDash([2 * pxPerMm, 2 * pxPerMm])
        ctx.strokeRect(x, y, tileW, tileW * ratio)
        ctx.setLineDash([])
      }
    }

    if (checkBar) {
      const y = (sheet.h - MARGIN / 2) * pxPerMm
      const x = MARGIN * pxPerMm
      ctx.strokeStyle = '#000'
      ctx.fillStyle = '#000'
      ctx.lineWidth = Math.max(1, 0.25 * pxPerMm)
      ctx.beginPath()
      ctx.moveTo(x, y); ctx.lineTo(x + 50 * pxPerMm, y)
      ctx.moveTo(x, y - 1.5 * pxPerMm); ctx.lineTo(x, y + 1.5 * pxPerMm)
      ctx.moveTo(x + 50 * pxPerMm, y - 1.5 * pxPerMm); ctx.lineTo(x + 50 * pxPerMm, y + 1.5 * pxPerMm)
      ctx.stroke()
      ctx.font = `${2.8 * pxPerMm}px system-ui, sans-serif`
      ctx.textBaseline = 'bottom'
      ctx.fillText('50 mm — measure this to check the print scale', x + 52 * pxPerMm, y + 1.4 * pxPerMm)
    }
  }, [bitmap, ratio, finish, sheet, widthMm, plan, guides, checkBar])

  useEffect(() => {
    const c = previewRef.current
    if (!c || !bitmap) return
    drawSheet(c.getContext('2d', { willReadFrequently: true }), 2.2, { forPreview: true })
  }, [drawSheet, bitmap])

  /* ---------------- outputs ---------------- */

  const save = (canvas, name) =>
    new Promise((resolve) => canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      resolve()
    }, 'image/png'))

  const downloadSheet = async () => {
    setBusy(true)
    try {
      const c = document.createElement('canvas')
      drawSheet(c.getContext('2d', { willReadFrequently: true }), dpi / MM_PER_IN, { forPreview: false })
      await save(c, `${filename}-A4-${Math.round(widthMm)}mm.png`)
    } finally { setBusy(false) }
  }

  const downloadExact = async () => {
    setBusy(true)
    try {
      const pxPerMm = dpi / MM_PER_IN
      const tile = renderTile(bitmap, widthMm * pxPerMm, heightMm * pxPerMm, finish)
      await save(tile, `${filename}-${Math.round(widthMm)}mm-${dpi}dpi.png`)
    } finally { setBusy(false) }
  }

  /* True-size printing: the browser's own page box, not a scaled bitmap. */
  const print = () => {
    const pxPerMm = dpi / MM_PER_IN
    const tile = renderTile(bitmap, widthMm * pxPerMm, heightMm * pxPerMm, finish)
    const src = tile.toDataURL('image/png')
    const imgs = plan.items
      .map((it) => `<img src="${src}" style="left:${it.x}mm;top:${it.y}mm;width:${widthMm}mm;height:${heightMm}mm">`)
      .join('')
    const bar = checkBar
      ? `<div style="position:absolute;left:${MARGIN}mm;top:${sheet.h - MARGIN / 2}mm;width:50mm;border-top:0.3mm solid #000"></div>
         <div style="position:absolute;left:${MARGIN + 52}mm;top:${sheet.h - MARGIN / 2 - 3}mm;font:2.6mm system-ui,sans-serif">50 mm — measure this to check the print scale</div>`
      : ''
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)
    const doc = frame.contentWindow.document
    doc.open()
    doc.write(`<!doctype html><meta charset="utf-8"><title>${filename}</title>
      <style>
        @page { size: A4 ${orientation}; margin: 0 }
        html,body { margin:0; padding:0; background:#fff }
        img { position:absolute; image-rendering:auto }
        ${guides ? '.cut{position:absolute;outline:0.2mm dashed rgba(0,0,0,.35)}' : ''}
      </style>${imgs}${bar}`)
    doc.close()
    const go = () => {
      frame.contentWindow.focus()
      frame.contentWindow.print()
      setTimeout(() => frame.remove(), 1000)
    }
    // wait for the data URL image to decode, or print anyway after a beat
    const img = doc.images[0]
    if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 1500) }
    else go()
  }

  const Field = ({ label, value, onChange }) => (
    <label className="flex-1">
      <span className="stamp mb-1 block text-[10px] text-paper-3/60">{label}</span>
      <input
        type="number"
        value={value}
        step={u.step}
        min={0}
        onChange={onChange}
        className="w-full rounded-sm border border-gold/25 bg-ink-2 px-2.5 py-2 text-[14px] tabular-nums text-paper outline-none focus:border-gold"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-sm p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Print size"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="wordmark text-2xl text-paper">Print it at the right size</h2>
            <p className="stamp mt-0.5 text-[10px] text-gold">A4 sheet · {dpi} dpi</p>
          </div>
          <button type="button" onClick={onClose} className="text-paper-3/60 hover:text-paper" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          {/* ---- controls ---- */}
          <div className="space-y-4">
            <div>
              <div className="mb-2 grid gap-px overflow-hidden rounded-sm border border-gold/25 bg-gold/15" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                {Object.entries(UNITS).map(([id, cfg]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setUnit(id)}
                    className={`stamp px-2 py-2 text-[10px] transition ${unit === id ? 'bg-red text-paper' : 'bg-ink-2 text-paper-3 hover:text-paper'}`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Field label="Width" value={show(widthMm)} onChange={(e) => setFromDisplay(e.target.value, 'w')} />
                <Field label="Height" value={show(heightMm)} onChange={(e) => setFromDisplay(e.target.value, 'h')} />
              </div>
              <input
                type="range"
                min={10}
                max={Math.round(maxWidthMm)}
                value={Math.round(widthMm)}
                onChange={(e) => setWidthMm(Number(e.target.value))}
                aria-label="Width"
                className="mt-2.5 w-full accent-red-bright"
              />
              <p className="mt-1 text-[10px] text-paper-3/55">
                Proportions are locked — change one and the other follows. Largest that fits: {show(maxWidthMm)} {u.label}.
              </p>
            </div>

            <div>
              <p className="stamp mb-1.5 text-[10px] text-paper-3/60">Copies on the sheet</p>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 4, 6, 'auto'].map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-on={copies === n}
                    onClick={() => setCopies(n)}
                    className="flash-card rounded-sm px-1 py-2 text-center"
                  >
                    <span className="stamp block text-[11px] text-paper">{n === 'auto' ? 'Fill' : n}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-paper-3/55">
                {plan.items.length} on this sheet · up to {plan.perSheet} fit at this size.
              </p>
            </div>

            <div>
              <p className="stamp mb-1.5 text-[10px] text-paper-3/60">Sheet</p>
              <div className="grid gap-px overflow-hidden rounded-sm border border-gold/25 bg-gold/15" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                {['portrait', 'landscape'].map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrientation(o)}
                    className={`stamp px-2 py-2 text-[10px] capitalize transition ${orientation === o ? 'bg-red text-paper' : 'bg-ink-2 text-paper-3 hover:text-paper'}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {[
                [guides, setGuides, 'Cut lines around each copy'],
                [checkBar, setCheckBar, 'Add a 50 mm check bar'],
              ].map(([on, set, label]) => (
                <label key={label} className="flex cursor-pointer items-center gap-2 text-[11px] text-paper-2">
                  <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="accent-red-bright" />
                  {label}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-paper-2">
                <span className="stamp text-[10px] text-paper-3/60">Detail</span>
                <select
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value))}
                  className="rounded-sm border border-gold/25 bg-ink-2 px-2 py-1 text-[11px] text-paper outline-none focus:border-gold"
                >
                  <option value={150}>150 dpi · draft</option>
                  <option value={300}>300 dpi · print</option>
                  <option value={600}>600 dpi · fine line</option>
                </select>
              </label>
            </div>
          </div>

          {/* ---- preview ---- */}
          <div className="flex flex-col gap-3">
            <div className="grid flex-1 place-items-center rounded-sm border border-gold/15 bg-ink p-4">
              <canvas
                ref={previewRef}
                className="max-h-[46vh] w-auto max-w-full shadow-[0_18px_46px_-22px_rgba(0,0,0,.95)]"
                style={{ background: '#fff' }}
              />
            </div>
            <p className="text-[11px] leading-snug text-paper-3/65">
              Print with scaling set to <strong>100%</strong> or “actual size”, never “fit to page”. Measure the
              check bar afterwards — if it reads 50&nbsp;mm, the stencil is true size.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={busy} onClick={print} className="btn-ink rounded-sm py-3 text-[12px]">Print sheet</button>
              <button type="button" disabled={busy} onClick={downloadSheet} className="btn-quiet rounded-sm py-3 text-[11px]">Download A4 PNG</button>
              <button type="button" disabled={busy} onClick={downloadExact} className="btn-quiet rounded-sm py-3 text-[11px] sm:col-span-2">
                Download just the stencil at {show(widthMm)}×{show(heightMm)} {u.label}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
