import { useCallback, useEffect, useState } from 'react'
import { api, loadScript, rupees } from './api.js'

const CHECKOUT = 'https://checkout.razorpay.com/v1/checkout.js'

/** A punched studio ticket showing the balance. */
export function CreditTicket({ credits, onClick }) {
  const low = credits <= 3
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add credits"
      className={`stamp flex items-center gap-2 rounded-sm border px-3 py-2 text-[12px] transition ${
        low ? 'border-red-bright bg-red/20 text-paper' : 'border-gold/35 bg-ink-2 text-paper-2 hover:border-gold'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={low ? 'text-red-bright' : 'text-gold'}>
        <path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6Z" />
        <path d="M12 8v8" strokeDasharray="2 3" />
      </svg>
      <span className="tabular-nums">{credits}</span>
      <span className="hidden text-paper-3/70 sm:inline">left</span>
    </button>
  )
}

export function AccountMenu({ user, onBuy, onInvite, onSignOut }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="block h-9 w-9 overflow-hidden rounded-full border-2 border-gold/50 transition hover:border-gold">
        {user.picture ? (
          <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="stamp grid h-full w-full place-items-center bg-ink-3 text-[13px] text-gold">{(user.name || user.email || '?')[0].toUpperCase()}</span>
        )}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-sm shadow-2xl">
          <div className="border-b border-gold/20 px-3 py-2.5">
            <p className="truncate text-[13px] text-paper">{user.name || 'Signed in'}</p>
            <p className="truncate text-[11px] text-paper-3/70">{user.email}</p>
            <p className="stamp mt-2 text-[11px] text-paper-2">
              Balance <span className="tabular-nums text-gold">{user.credits}</span> credits
            </p>
          </div>
          <button type="button" onClick={() => { setOpen(false); onBuy() }} className="stamp block w-full px-3 py-2.5 text-left text-[11px] text-paper-2 hover:bg-gold/10">Add credits</button>
          <button type="button" onClick={() => { setOpen(false); onInvite?.() }} className="stamp block w-full px-3 py-2.5 text-left text-[11px] text-paper-2 hover:bg-gold/10">Invite an artist</button>
          {user.isAdmin && (
            <a href="/admin" className="stamp block w-full px-3 py-2.5 text-left text-[11px] text-gold hover:bg-gold/10">The books</a>
          )}
          <button type="button" onClick={() => { setOpen(false); onSignOut() }} className="stamp block w-full px-3 py-2.5 text-left text-[11px] text-paper-3/70 hover:bg-gold/10">Sign out</button>
        </div>
      )}
    </div>
  )
}

/**
 * Recharge dialog. The browser never sets the price: it asks the server for an
 * order, Razorpay collects the money, and the server verifies the signature
 * before a single credit is added.
 */
export function BuyCreditsModal({ config, user, onClose, onCredited }) {
  const packs = config?.packs || []
  const [packId, setPackId] = useState(packs[1]?.id || packs[0]?.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const perCredit = config?.rupeesPerCredit ?? 9
  const paymentsReady = !!config?.ready?.payments

  const pay = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await loadScript(CHECKOUT)
      const order = await api('/api/payments/create-order', { method: 'POST', body: { packId } })
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountPaise,
          currency: 'INR',
          name: 'SUI — Tattoo Stencil Studio',
          description: `${order.credits} credits`,
          prefill: order.prefill,
          theme: { color: '#e5b567' },
          modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
          handler: async (resp) => {
            try {
              const out = await api('/api/payments/verify', { method: 'POST', body: resp })
              setDone({ added: out.added || order.credits, credits: out.credits })
              onCredited?.(out.credits)
              resolve()
            } catch (e) {
              reject(e)
            }
          },
        })
        rz.on('payment.failed', (e) => reject(new Error(e?.error?.description || 'Payment failed.')))
        rz.open()
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [packId, onCredited])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel w-full max-w-md rounded-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border-2 border-gold text-gold">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <p className="wordmark text-2xl text-paper">{done.added} credits added</p>
            <p className="stamp mt-1 text-[11px] text-paper-3/70">New balance: <span className="tabular-nums text-gold">{done.credits}</span> credits</p>
            <button type="button" onClick={onClose} className="btn-ink mt-5 w-full rounded-sm py-3 text-[12px]">Back to the bench</button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="wordmark text-2xl text-paper">Top up the wallet</h2>
                <p className="stamp mt-0.5 text-[10px] text-gold">{rupees(perCredit)} per credit · 1 credit = 1 stencil</p>
              </div>
              <button type="button" onClick={onClose} className="text-paper-3/60 hover:text-paper" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPackId(p.id)}
                  data-on={packId === p.id}
                  className="flash-card rounded-sm px-3 py-3 text-left"
                >
                  <span className="stamp block text-2xl tabular-nums text-paper">{p.credits}</span>
                  <span className="stamp block text-[10px] text-paper-3/60">credits</span>
                  <span className="stamp mt-1 block text-[13px] text-gold">{rupees(p.rupees)}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11px] leading-snug text-paper-3/65">
              Current balance {user?.credits ?? 0} credits. Payments run through Razorpay — UPI, cards, net banking and wallets.
            </p>

            {!paymentsReady && (
              <p className="mt-3 rounded-sm border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] leading-snug text-paper-2">
                Payments are not switched on yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel → Settings → Environment Variables, then redeploy.
              </p>
            )}
            {error && <p className="mt-3 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[11px] leading-snug text-paper-2">{error}</p>}

            <button
              type="button"
              disabled={busy || !paymentsReady || !packId}
              onClick={pay}
              className="btn-ink mt-4 flex w-full items-center justify-center gap-2 rounded-sm py-3.5 text-[12px]"
            >
              {busy ? 'Opening payment…' : `Pay ${rupees((packs.find((p) => p.id === packId)?.rupees) || 0)}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
