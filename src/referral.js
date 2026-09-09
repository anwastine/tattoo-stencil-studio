/*
 * Remembering who invited you.
 *
 * The code arrives as ?r=ABC123 and has to survive the trip through Google's
 * sign-in, which leaves and re-enters the page — so it goes to localStorage and
 * comes off the URL immediately, because nobody wants to share a link with
 * someone else's referral code still hanging off it.
 */

const KEY = 'sui_ref'
const VALID = /^[A-Z0-9]{4,12}$/

const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }

/** Call once on load. Returns the stored code, if any. */
export function captureReferral() {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = (params.get('r') || '').trim().toUpperCase()
    if (VALID.test(raw)) {
      try { localStorage.setItem(KEY, raw) } catch { /* private window; it just will not stick */ }
      params.delete('r')
      const q = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash)
    }
  } catch { /* never let a malformed URL stop the app booting */ }
  return read()
}

export const storedReferral = read
export const clearReferral = () => { try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ } }
