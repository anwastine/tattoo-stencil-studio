/*
 * The SUI mark.
 *
 * Every candidate from the design sheet is kept here, so switching the brand
 * mark is a one-word change to ACTIVE rather than an edit in five files.
 *
 * All marks are drawn in a 64x64 box, use `currentColor`, and are tuned to
 * survive at 20px — a mark that only works large is no use as a favicon or in
 * the header. Anything that needs a knocked-out counter reads
 * `--logo-knockout`, which defaults to the studio's ink black.
 */

export const ACTIVE = 'serpent'

/* A snake coiled into the S: traditional flash, and the letter comes free. */
const serpent = (
  <>
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M44 18C44 12.2 38.2 9.5 32 9.5C25.4 9.5 19 12.6 19 19C19 25.4 26 27.8 32 29.8C38.6 32 45.5 34.8 45.5 41.8C45.5 48.8 39 53.5 32 53.5C27 53.5 22.6 51.4 20 47.6" strokeWidth="7.5" />
      {/* the tail thins in two steps; overlapping round caps read as one taper */}
      <path d="M20 47.6L16.6 42.6" strokeWidth="5" />
      <path d="M16.6 42.6L13.4 38.3" strokeWidth="2.3" />
    </g>
    <ellipse cx="46.8" cy="13" rx="6.3" ry="4.9" transform="rotate(-30 46.8 13)" fill="currentColor" />
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M51.6 8.2L56.6 4.4" /><path d="M56.6 4.4L59.4 4.9" /><path d="M56.6 4.4L57.4 2" />
    </g>
  </>
)

/* The line a machine draws: needle point at one end, ink breaking to dots at the other. */
const needle = (
  <>
    <path d="M43.5 19C43.5 13 37.8 10 32 10C25.6 10 19.5 13 19.5 19C19.5 25 26 27.4 32 29.4C38.4 31.5 45 34.2 45 40.8C45 47.4 38.8 51.6 32 51.6" fill="none" stroke="currentColor" strokeWidth="6.4" strokeLinecap="round" />
    <path d="M43.5 19L47.8 4.5L39.4 15.5Z" fill="currentColor" />
    <circle cx="25.6" cy="52.4" r="3.1" fill="currentColor" />
    <circle cx="19.6" cy="53.6" r="2.2" fill="currentColor" />
    <circle cx="14.6" cy="54.6" r="1.4" fill="currentColor" />
  </>
)

const S_SOLID = 'M43.6 20.2C43.6 14.4 38.6 11 32 11C25.6 11 20.4 13.8 20.4 18.8C20.4 23.4 24.6 25.4 31 27.2L33.6 27.9C41.8 30.1 46 33.4 46 40.4C46 48 39.4 53 32 53C24.8 53 18.4 49.2 17.6 42.4L24.6 41.6C25.2 45.4 28.4 47.2 32.2 47.2C36.4 47.2 39.2 45.2 39.2 41.6C39.2 38.4 36.6 36.8 31.2 35.4L28.4 34.6C20.6 32.5 13.6 29.6 13.6 21.6C13.6 12.4 22 5 32 5C42 5 50.4 11.4 50.4 20.2Z'

/* The S as a shape cut from stencil paper, framed by transfer registration marks. */
const stencil = (
  <>
    <path d={S_SOLID} fill="currentColor" />
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55">
      <path d="M3 10V3h7" /><path d="M54 3h7v7" /><path d="M61 54v7h-7" /><path d="M10 61H3v-7" />
    </g>
  </>
)

/* A drop of ink with the S knocked out of it. One silhouette, strongest small. */
const drop = (
  <>
    <path d="M32 3C32 3 51 24.5 51 38C51 48.9 42.5 57.5 32 57.5C21.5 57.5 13 48.9 13 38C13 24.5 32 3 32 3Z" fill="currentColor" />
    <path d="M39.4 30.6C39.4 27.2 36 25.4 32 25.4C28 25.4 24.6 27.2 24.6 30.4C24.6 33.4 27.6 34.6 31.4 35.7C35.4 36.9 39.8 38.4 39.8 42.4C39.8 46.2 36 48.4 32 48.4C28.2 48.4 24.8 46.8 24.4 43.4"
      fill="none" stroke="var(--logo-knockout, #0b0a09)" strokeWidth="4.4" strokeLinecap="round" />
  </>
)

/* Flash sheets frame everything; SUI set inside the frame itself. */
const diamond = (
  <>
    <path d="M32 3l29 29-29 29L3 32Z" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path d="M32 9.5L54.5 32 32 54.5 9.5 32Z" fill="none" stroke="currentColor" strokeWidth="1" />
    <text fontFamily="'Bebas Neue',sans-serif" fontSize="19" letterSpacing="2" textAnchor="middle" x="33" y="39" fill="currentColor">SUI</text>
  </>
)

/* Blackletter S in a shield — the most classic tattoo-shop reading of all. */
const shield = (
  <>
    <path d="M32 3l25 7v22c0 15-11.5 25-25 30C19.5 57 8 47 8 32V10Z" fill="none" stroke="currentColor" strokeWidth="2.6" />
    <text fontFamily="'Pirata One',serif" fontSize="34" textAnchor="middle" x="32" y="43" fill="currentColor">S</text>
  </>
)

export const MARKS = { serpent, needle, stencil, drop, diamond, shield }

/** The brand mark on its own. */
export function Mark({ size = 32, variant = ACTIVE, className = '', title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      {MARKS[variant] || MARKS[ACTIVE]}
    </svg>
  )
}

/** The mark in the badge the header and sign-in page both use. */
export function MarkBadge({ box = 40, size = 26, className = '' }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-sm border border-gold/40 bg-ink-2 text-red-bright ${className}`}
      style={{ width: box, height: box, '--logo-knockout': '#14110d' }}
    >
      <Mark size={size} />
    </span>
  )
}

/**
 * Mark, name and tagline together.
 *
 * `SUI` is tracked out deliberately: set solid, Pirata One's blackletter U and
 * I fuse into something that reads as a W. The letter-spacing is what makes the
 * name legible, so do not remove it.
 */
export function Lockup({ nameClass = 'text-[26px] sm:text-[30px]', box = 40, size = 26, tagline = 'Tattoo Stencil Studio' }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <MarkBadge box={box} size={size} />
      <div className="min-w-0">
        <h1 className={`brandmark truncate text-paper ${nameClass}`}>SUI</h1>
        {tagline && <p className="stamp hidden text-[10px] text-paper-3/70 sm:block">{tagline}</p>}
      </div>
    </div>
  )
}
