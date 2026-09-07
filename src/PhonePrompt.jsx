import { useCallback, useState } from 'react'
import { api } from './api.js'

/**
 * Shown once, right after a new artist signs in. Entirely optional — "Not now"
 * is a real choice and the number is never required to use the studio.
 */
export default function PhonePrompt({ onDone }) {
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const submit = useCallback(
    async (e) => {
      e?.preventDefault()
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        const out = await api('/api/auth/phone', { method: 'POST', body: { phone } })
        setDone(true)
        setTimeout(() => onDone?.(out.user), 1400)
      } catch (err) {
        setError(err.message)
        setBusy(false)
      }
    },
    [phone, busy, onDone],
  )

  const skip = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const out = await api('/api/auth/phone', { method: 'POST', body: { skip: true } })
      onDone?.(out.user)
    } catch {
      onDone?.(null)
    }
  }, [busy, onDone])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4 backdrop-blur-sm">
      <div className="panel w-full max-w-md rounded-sm p-6 text-center shadow-2xl">
        {done ? (
          <>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border-2 border-gold text-gold">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <p className="wordmark text-2xl text-paper">You're on the list</p>
            <p className="stamp mt-1 text-[11px] text-gold">We'll be in touch when it opens</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-gold/40 text-gold">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5a1 1 0 0 1 1-1h3l2 5-2.5 1.5a12 12 0 0 0 6 6L15 14l5 2v3a1 1 0 0 1-1 1A15 15 0 0 1 4 5Z" />
              </svg>
            </div>

            <h2 className="wordmark text-2xl leading-tight text-paper">
              Join India's largest tattoo artist channel
            </h2>
            <p className="stamp mt-1.5 text-[11px] text-gold">Opening soon</p>
            <p className="mx-auto mt-3 mb-5 max-w-[20rem] text-[12px] leading-snug text-paper-3/80">
              Enter your mobile number and we'll let you know the day it opens. Completely
              optional — your credits and the studio work either way.
            </p>

            <form onSubmit={submit}>
              <div className="mx-auto flex max-w-[16rem] items-center overflow-hidden rounded-sm border border-gold/30 bg-ink-2 focus-within:border-gold">
                <span className="stamp shrink-0 border-r border-gold/20 px-3 py-2.5 text-[13px] text-paper-3">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  autoFocus
                  maxLength={11}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setError(null) }}
                  placeholder="98765 43210"
                  aria-label="Mobile number"
                  className="w-full bg-transparent px-3 py-2.5 text-[15px] tracking-wide text-paper outline-none placeholder:text-paper-3/40"
                />
              </div>

              {error && <p className="mx-auto mt-3 max-w-[18rem] rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[11px] leading-snug text-paper-2">{error}</p>}

              <button type="submit" disabled={busy || !phone.trim()} className="btn-ink mt-4 w-full rounded-sm py-3 text-[12px]">
                {busy ? 'Saving…' : 'Count me in'}
              </button>
            </form>

            <button type="button" onClick={skip} disabled={busy} className="stamp mt-3 text-[10px] text-paper-3/60 hover:text-paper disabled:opacity-50">
              Not now
            </button>

            <p className="mt-4 text-[10px] leading-snug text-paper-3/45">
              We use it only to tell you about the channel. No spam, and you can ask us to
              delete it any time.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
