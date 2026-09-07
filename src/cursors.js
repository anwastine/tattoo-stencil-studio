/*
 * Signature tattoo cursors.
 *
 * Ten flash motifs drawn as tiny SVGs and used as the page cursor, cycling
 * every few seconds and advancing on click. Each motif is drawn with a dark
 * outline under a bone-white line so it stays readable on ink-black panels and
 * on the cream flash sheet alike, and each has its "point" at the top-left so
 * the 3,3 hotspot lands where the eye expects it.
 */

const A = '#f4ead6' // bone
const O = '#0b0a09' // outline

/** Wrap paths in an SVG, drawn twice: fat dark stroke underneath, bone on top. */
function cursor(paths, { fills = '' } = {}) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<g fill="none" stroke="${O}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<g fill="none" stroke="${A}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    fills +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 3`
}

const DAGGER = cursor(
  // tapered blade from the point, crossguard, bound grip, round pommel
  '<path d="M3 3 L12.5 15.5 L15.5 12.5 Z"/>' +
    '<path d="M9.5 19 L19 9.5"/>' +
    '<path d="M15 15 L22.5 22.5"/>' +
    '<path d="M17 20 L20 17"/>' +
    '<circle cx="25" cy="25" r="2.6"/>',
)

const SWALLOW = cursor(
  '<path d="M3 3 C9 6 12 10 13 15"/><path d="M13 15 C17 9 23 7 29 8 C25 12 24 17 22 21"/><path d="M22 21 C18 24 12 24 8 21"/><path d="M8 21 L4 27 L11 25"/>',
)

const ROSE = cursor(
  '<path d="M3 3 C7 7 9 11 10 15"/><path d="M6 14 C2 16 3 22 8 22"/><path d="M20 12 a7 7 0 1 1-9 9 a5 5 0 1 1 7-7 a3 3 0 1 1-3 4"/><path d="M13 24 C16 28 22 28 25 24"/>',
)

const ANCHOR = cursor(
  '<path d="M3 3 L10 10"/><path d="M16 9 L16 27"/><circle cx="16" cy="7" r="3"/><path d="M9 14 L23 14"/><path d="M7 19 C7 26 12 29 16 29 C20 29 25 26 25 19"/>',
)

const SNAKE = cursor(
  '<path d="M3 3 L7 7"/><path d="M7 7 C12 4 15 8 12 12 C8 17 13 21 18 19 C24 17 27 21 25 26"/><path d="M25 26 L29 29"/><path d="M22 27 L25 26 L26 23"/>',
)

const STAR = cursor(
  '<path d="M3 3 L14 14"/><path d="M16 4 L19 14 L29 17 L19 20 L16 30 L13 20 L3 17 L13 14 Z"/>',
)

const SKULL = cursor(
  '<path d="M3 3 L9 9"/><path d="M8 16 a9 9 0 1 1 18 0 c0 4-2 6-3 8 l-1 4 h-10 l-1-4 c-1-2-3-4-3-8 Z"/><circle cx="13" cy="16" r="2.4"/><circle cx="21" cy="16" r="2.4"/><path d="M17 20 v3"/><path d="M13 28 v-4 M17 28 v-4 M21 28 v-4"/>',
)

const HEART = cursor(
  // heart over an unfurled banner
  '<path d="M3 3 L8 8"/>' +
    '<path d="M17 24 C11 20 8 17 8 14 a4.6 4.6 0 0 1 9-1.7 a4.6 4.6 0 0 1 9 1.7 c0 3-3 6-9 10 Z"/>' +
    '<path d="M4 26 C10 23 24 29 30 26"/>' +
    '<path d="M4 26 L4 30 M30 26 L30 30"/>',
)

const EYE = cursor(
  '<path d="M3 3 L9 9"/><path d="M4 19 C9 12 23 12 28 19 C23 26 9 26 4 19 Z"/><circle cx="16" cy="19" r="4"/><path d="M16 8 v-3 M7 11 L5 9 M25 11 L27 9"/>',
)

const ARROW = cursor(
  '<path d="M3 3 L27 27"/><path d="M3 3 L4 12 M3 3 L12 4"/><path d="M20 24 L24 20 M23 27 L27 23"/>',
)

/** The rotation, in the order they cycle. */
export const TATTOO_CURSORS = [DAGGER, ROSE, SWALLOW, SNAKE, ANCHOR, STAR, HEART, EYE, SKULL, ARROW]

/** A tattoo machine, used for anything clickable so the affordance stays obvious. */
export const MACHINE_CURSOR = cursor(
  // a tattoo pen: needle tip at the hotspot, barrel, grip band, cable
  '<path d="M3 3 L13 13"/>' +
    '<path d="M11.5 11.5 L21.5 21.5 L26 17 L16 7 Z"/>' +
    '<path d="M17 13 L21 17"/>' +
    '<path d="M22.5 22.5 C26 26 27 28 29 29"/>',
)

/**
 * Cycles the page cursor through the flash motifs. Honours reduced-motion by
 * settling on a single design, and skips touch devices entirely.
 */
export function startTattooCursor({ intervalMs = 3500 } = {}) {
  if (typeof window === 'undefined') return () => {}
  const root = document.documentElement
  root.style.setProperty('--machine-cursor', `${MACHINE_CURSOR}, pointer`)

  const fine = window.matchMedia?.('(pointer: fine)')?.matches
  if (!fine) return () => {}

  let i = Math.floor(Math.random() * TATTOO_CURSORS.length)
  const paint = () => root.style.setProperty('--tattoo-cursor', `${TATTOO_CURSORS[i % TATTOO_CURSORS.length]}, auto`)
  paint()

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  if (reduced) return () => {}

  const advance = () => { i += 1; paint() }
  const timer = setInterval(advance, intervalMs)
  window.addEventListener('pointerdown', advance)
  return () => {
    clearInterval(timer)
    window.removeEventListener('pointerdown', advance)
  }
}
