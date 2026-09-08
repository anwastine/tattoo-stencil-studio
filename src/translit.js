/*
 * Type it the way you say it.
 *
 * "amma" becomes అమ్మ as you type, so nobody has to install an Indic keyboard
 * to get their own mother's name into the app. Each word is transliterated on
 * its own — that is what the upstream endpoint is good at — and the result is
 * reassembled with the original spacing and line breaks intact.
 *
 * A word the reader disagrees with can be corrected by picking a different
 * candidate; that choice is remembered for that word, so retyping the same
 * name later gives the same spelling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'

/** Roman words only; anything else is already script, punctuation or a number. */
const ROMAN = /^[A-Za-z][A-Za-z'.-]*$/

/* Promises, not values: two keystrokes racing on the same word share one request. */
const cache = new Map()

export function candidatesFor(lang, word) {
  const key = `${lang}|${word.toLowerCase()}`
  if (!cache.has(key)) {
    cache.set(
      key,
      api(`/api/translit?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(word)}`)
        .then((j) => j.candidates || [])
        .catch(() => []), // offline or upstream down: keep the roman text
    )
  }
  return cache.get(key)
}

/**
 * @param lang   script id, e.g. 'telugu'
 * @param roman  what the person typed, in English letters
 * @param picks  { 'lang|word': chosenSpelling } overrides
 */
export function useTransliteration(lang, roman, picks) {
  const [native, setNative] = useState('')
  const [options, setOptions] = useState([])   // candidates for the last word typed
  const [lastWord, setLastWord] = useState('')
  const [busy, setBusy] = useState(false)
  const runId = useRef(0)

  /* Keeping the separators means "\n" and double spaces survive the round trip. */
  const parts = useMemo(() => roman.split(/(\s+)/), [roman])

  useEffect(() => {
    const id = ++runId.current
    const words = parts.filter((p) => ROMAN.test(p))
    if (!words.length) {
      setNative(roman)
      setOptions([])
      setLastWord('')
      return
    }
    setBusy(true)
    const timer = setTimeout(async () => {
      const resolved = await Promise.all(parts.map((p) => (ROMAN.test(p) ? candidatesFor(lang, p) : null)))
      if (id !== runId.current) return // a newer keystroke already won
      const out = parts.map((p, i) => {
        if (!ROMAN.test(p)) return p
        const chosen = picks[`${lang}|${p.toLowerCase()}`]
        return chosen || resolved[i]?.[0] || p
      })
      setNative(out.join(''))
      const last = words[words.length - 1]
      setLastWord(last)
      setOptions(resolved[parts.lastIndexOf(last)] || [])
      setBusy(false)
    }, 180)
    return () => { clearTimeout(timer); setBusy(false) }
  }, [parts, lang, picks, roman])

  return { native, options, lastWord, busy }
}

/** Picks are per-word overrides; this is the key they are stored under. */
export const pickKey = (lang, word) => `${lang}|${String(word).toLowerCase()}`

export function usePicks() {
  const [picks, setPicks] = useState({})
  const pick = useCallback((lang, word, value) => {
    setPicks((p) => ({ ...p, [pickKey(lang, word)]: value }))
  }, [])
  const clear = useCallback(() => setPicks({}), [])
  return { picks, pick, clear }
}
