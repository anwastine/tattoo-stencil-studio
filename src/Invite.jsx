/*
 * Invite an artist, earn credits.
 *
 * The reward lands when the person you invited first buys credits, not when
 * they sign up — so this shows "joined" and "bought" as separate numbers.
 * Otherwise the first question is always why a name has not paid out yet.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

export function InviteModal({ onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api('/api/referral').then(setData).catch((e) => setError(e.message))
  }, [])

  const link = data?.link || ''
  const message = data
    ? `I'm using SUI to draw tattoo stencils — photos into stencils, and lettering in any Indian language. ` +
      `You get ${data.welcomeCredits || 10} free to try it: ${link}`
    : ''

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy — select the link and copy it by hand.')
    }
  }, [link])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel w-full max-w-md rounded-sm p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Invite an artist"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="wordmark text-2xl text-paper">Invite an artist</h2>
            <p className="stamp mt-0.5 text-[10px] text-gold">
              {data ? `${data.reward} credits when they first buy` : 'Earn credits'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-paper-3/60 hover:text-paper" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <p className="mb-3 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[12px] text-paper-2">{error}</p>}

        {!data && !error && <p className="stamp py-6 text-center text-[11px] text-paper-3/50">Loading…</p>}

        {data && (
          <>
            <p className="text-[12px] leading-snug text-paper-2">
              Send another artist your link. They start with free stencils like you did, and the first time
              they buy {data.minPurchase} credits or more, <strong className="text-gold">{data.reward} credits</strong>{' '}
              land in your wallet — worth ₹{data.reward * data.rupeesPerCredit}.
            </p>

            <label className="stamp mt-4 mb-1 block text-[10px] text-paper-3/60">Your link</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-sm border border-gold/25 bg-ink-2 px-3 py-2.5 font-mono text-[12px] text-paper outline-none focus:border-gold"
              />
              <button type="button" onClick={copy} className="btn-quiet shrink-0 rounded-sm px-3 py-2.5 text-[11px]">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ink mt-3 flex w-full items-center justify-center gap-2 rounded-sm py-3 text-[12px]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1a13.6 13.6 0 0 1-6.3-5.5c-.5-.8-.8-1.7-.8-2.5 0-.9.5-1.4.7-1.6a.9.9 0 0 1 .7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6a9 9 0 0 0 4 3.4c.3.1.5.1.6-.1l.8-1c.2-.2.3-.2.6-.1l1.8.9c.3.1.5.2.5.4v.9Z" />
              </svg>
              Share on WhatsApp
            </a>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ['Joined', data.invited],
                ['Bought', data.converted],
                ['Credits earned', data.creditsEarned],
              ].map(([label, value]) => (
                <div key={label} className="rounded-sm border border-gold/20 bg-ink-2 px-2 py-2.5 text-center">
                  <p className="stamp text-xl tabular-nums text-paper">{value}</p>
                  <p className="stamp text-[9px] text-paper-3/55">{label}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[10px] leading-snug text-paper-3/50">
              Paid once per artist, on their first purchase. Inviting yourself with a second email does not
              count — the studio checks.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
