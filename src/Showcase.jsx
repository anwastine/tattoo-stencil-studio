/*
 * What the studio actually produces, on the landing page.
 *
 * Every image here is a real download from this site, not a mock-up — a
 * stencil people are about to pay for is the one thing you cannot fake in
 * marketing, because the first generation would give it away.
 *
 * The portrait pair is draggable: seeing the photo turn into linework under
 * your own finger sells the product better than any adjective.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------------- portraits ---------------- */

const STYLES = [
  { id: 'studio', label: 'Studio stencil', note: 'Clean linework, stippled skin, hatched lips' },
  { id: 'fineline', label: 'Fine line', note: 'Thin, minimal, plenty of open skin' },
  { id: 'bold', label: 'Bold traditional', note: 'Heavy outlines, chunky dot shading' },
  { id: 'dotwork', label: 'Dotwork', note: 'No outlines — tone built purely from dots' },
  { id: 'realism', label: 'Realism map', note: 'Every contour plus shadow boundaries' },
]

/** Drag-to-compare. Photo on the left of the handle, ink on the right. */
function Compare({ photo, ink, alt }) {
  const [pos, setPos] = useState(52)
  const box = useRef(null)

  const move = useCallback((clientX) => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }, [])

  const start = (e) => {
    e.preventDefault()
    move(e.clientX)
    const onMove = (ev) => move(ev.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div
      ref={box}
      onPointerDown={start}
      className="relative aspect-[4/5] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-sm border border-gold/25 bg-paper"
      role="slider"
      aria-label="Drag to compare the photo with the stencil"
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 4))
        if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 4))
      }}
    >
      <img src={photo} alt={alt} draggable="false" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={ink} alt="" draggable="false" className="absolute inset-0 h-full w-full object-cover" />
      </div>

      {/* the handle */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-red-bright/90 shadow-[0_0_12px_rgba(216,72,59,.7)]" />
        <div className="absolute top-1/2 -ml-4 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-gold/60 bg-ink text-gold shadow-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6 4 12l5 6M15 6l5 6-5 6" />
          </svg>
        </div>
      </div>

      <span className="stamp pointer-events-none absolute bottom-2 left-2 rounded-sm bg-ink/80 px-2 py-1 text-[9px] text-paper-2">Photo</span>
      <span className="stamp pointer-events-none absolute bottom-2 right-2 rounded-sm bg-ink/80 px-2 py-1 text-[9px] text-gold">Stencil</span>
    </div>
  )
}

/* ---------------- lettering ---------------- */

/* The word for love, in ten scripts. Google's `text=` parameter ships only the
   glyphs actually shown, so ten Indic fonts cost a few KB instead of a MB. */
const SCRIPTS = [
  { id: 'devanagari', label: 'Hindi', word: 'प्रेम', family: 'Noto Serif Devanagari', google: 'Noto+Serif+Devanagari:wght@600' },
  { id: 'bengali', label: 'Bengali', word: 'ভালোবাসা', family: 'Noto Serif Bengali', google: 'Noto+Serif+Bengali:wght@600' },
  { id: 'telugu', label: 'Telugu', word: 'ప్రేమ', family: 'Noto Serif Telugu', google: 'Noto+Serif+Telugu:wght@600' },
  { id: 'tamil', label: 'Tamil', word: 'காதல்', family: 'Noto Serif Tamil', google: 'Noto+Serif+Tamil:wght@600' },
  { id: 'kannada', label: 'Kannada', word: 'ಪ್ರೀತಿ', family: 'Noto Serif Kannada', google: 'Noto+Serif+Kannada:wght@600' },
  { id: 'malayalam', label: 'Malayalam', word: 'സ്നേഹം', family: 'Noto Serif Malayalam', google: 'Noto+Serif+Malayalam:wght@600' },
  { id: 'gujarati', label: 'Gujarati', word: 'પ્રેમ', family: 'Noto Serif Gujarati', google: 'Noto+Serif+Gujarati:wght@600' },
  { id: 'gurmukhi', label: 'Punjabi', word: 'ਪਿਆਰ', family: 'Noto Serif Gurmukhi', google: 'Noto+Serif+Gurmukhi:wght@600' },
  { id: 'odia', label: 'Odia', word: 'ପ୍ରେମ', family: 'Noto Serif Oriya', google: 'Noto+Serif+Oriya:wght@600' },
  { id: 'urdu', label: 'Urdu', word: 'محبت', family: 'Noto Nastaliq Urdu', google: 'Noto+Nastaliq+Urdu:wght@600', dir: 'rtl' },
]

function useScriptFonts() {
  useEffect(() => {
    const links = SCRIPTS.map((s) => {
      const href = `https://fonts.googleapis.com/css2?family=${s.google}&text=${encodeURIComponent(s.word)}&display=swap`
      if (document.querySelector(`link[href="${href}"]`)) return null
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = href
      document.head.appendChild(l)
      return l
    })
    return () => links.forEach((l) => l && l.remove())
  }, [])
}

/* ---------------- the section ---------------- */

export default function Showcase({ lettering = [] }) {
  const [style, setStyle] = useState('studio')
  useScriptFonts()

  return (
    <section className="mt-16 w-full text-left">
      {/* ---- portraits ---- */}
      <div className="text-center">
        <p className="stamp text-[10px] text-gold">Drag the line</p>
        <h2 className="wordmark mt-1 text-[30px] leading-none text-paper sm:text-[38px]">One photo, five ways to ink it</h2>
        <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-paper-3/80">
          Every image on this page came out of this site. Pick a style and drag the handle to see the
          same photo redrawn.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <Compare
          photo="/showcase/ink-photo.webp"
          ink={`/showcase/ink-${style}.webp`}
          alt="Portrait photograph before it becomes a stencil"
        />
        <div className="flex flex-col gap-1.5">
          {STYLES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              data-on={s.id === style}
              onClick={() => setStyle(s.id)}
              className="flash-card rounded-sm px-3 py-2.5 text-left"
            >
              <span className="stamp block text-[9px] text-red-bright">{['I', 'II', 'III', 'IV', 'V'][i]}</span>
              <span className="stamp block text-[12px] text-paper">{s.label}</span>
              <span className="block text-[10px] leading-snug text-paper-3/70">{s.note}</span>
            </button>
          ))}
        </div>
      </div>

      {/* a second face, so it is clearly not one lucky photo */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <figure className="panel overflow-hidden rounded-sm">
          <img src="/showcase/face-fineline.webp" alt="Fine line stencil of a man's face" loading="lazy" className="block w-full bg-paper" />
          <figcaption className="stamp px-3 py-2 text-[10px] text-paper-3/70">Fine line · another face, same one credit</figcaption>
        </figure>
        <figure className="panel overflow-hidden rounded-sm">
          <img src="/showcase/face-dotwork.webp" alt="Dotwork stencil of the same face" loading="lazy" className="block w-full bg-paper" />
          <figcaption className="stamp px-3 py-2 text-[10px] text-paper-3/70">Dotwork · the same photo, a different hand</figcaption>
        </figure>
      </div>

      {/* ---- lettering ---- */}
      <div className="mt-16 text-center">
        <p className="stamp text-[10px] text-gold">Lettering</p>
        <h2 className="wordmark mt-1 text-[30px] leading-none text-paper sm:text-[38px]">Any Indian language</h2>
        <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-paper-3/80">
          Type the name the way you say it — “amma” — and it becomes అమ్మ. Ten scripts, typeset in a real
          font first so the spelling can never drift, then inked.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SCRIPTS.map((s) => (
          <div key={s.id} className="panel rounded-sm px-2 py-3 text-center">
            <span
              dir={s.dir || 'ltr'}
              className="block truncate text-[22px] leading-tight text-paper"
              style={{ fontFamily: `"${s.family}", serif` }}
            >
              {s.word}
            </span>
            <span className="stamp mt-1 block text-[9px] text-paper-3/55">{s.label}</span>
          </div>
        ))}
      </div>

      {lettering.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lettering.map((l) => (
            <figure key={l.src} className="panel overflow-hidden rounded-sm">
              <img src={l.src} alt={l.alt} loading="lazy" className="block w-full bg-paper" />
              <figcaption className="flex items-baseline justify-between gap-2 px-3 py-2">
                <span className="stamp text-[10px] text-paper-2">{l.label}</span>
                <span className="stamp text-[9px] text-paper-3/55">{l.meta}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] leading-snug text-paper-3/55">
        Every stencil above cost one credit. The finished file downloads at the size you set in
        millimetres or inches, laid out on an A4 sheet.
      </p>
    </section>
  )
}
