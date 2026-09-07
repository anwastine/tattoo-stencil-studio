import { useCallback, useEffect, useState } from 'react'
import { api, loadScript, rupees } from './api.js'

const CHECKOUT = 'https://checkout.razorpay.com/v1/checkout.js'

export function CreditPill({ credits, onClick }) {
  const low = credits <= 3
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add credits"
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        low ? 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20' : 'border-neutral-700 bg-neutral-800/70 hover:border-neutral-500'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
      </svg>
      <span className="tabular-nums">{credits}</span>
      <span className="hidden text-[11px] font-normal text-neutral-400 sm:inline">credits</span>
    </button>
  )
}

export function AccountMenu({ user, onBuy, onSignOut }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="block h-9 w-9 overflow-hidden rounded-full border border-neutral-700 hover:border-neutral-500">
        {user.picture ? (
          <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-neutral-800 text-sm font-semibold">{(user.name || user.email || '?')[0].toUpperCase()}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl">
          <div className="border-b border-neutral-800 px-3 py-2.5">
            <p className="truncate text-sm font-medium">{user.name || 'Signed in'}</p>
            <p className="truncate text-[11px] text-neutral-500">{user.email}</p>
            <p className="mt-1.5 text-xs text-neutral-300">
              Balance <span className="font-semibold tabular-nums text-accent">{user.credits}</span> credits
            </p>
          </div>
          <button type="button" onClick={() => { setOpen(false); onBuy() }} className="block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-800">Add credits</button>
          <button type="button" onClick={() => { setOpen(false); onSignOut() }} className="block w-full px-3 py-2.5 text-left text-sm text-neutral-400 hover:bg-neutral-800">Sign out</button>
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
          name: 'Tattoo Stencil Studio',
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-accent text-neutral-950">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <p className="text-lg font-semibold">{done.added} credits added</p>
            <p className="mt-1 text-sm text-neutral-400">New balance: <span className="font-semibold tabular-nums text-neutral-100">{done.credits}</span> credits</p>
            <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-neutral-950">Back to drawing</button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg">Add credits</h2>
                <p className="text-[11px] text-neutral-500">{rupees(perCredit)} per credit · 1 credit = 1 stencil</p>
              </div>
              <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPackId(p.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${packId === p.id ? 'border-accent bg-accent/10' : 'border-neutral-800 bg-neutral-800/50 hover:border-neutral-600'}`}
                >
                  <span className="block text-lg font-semibold tabular-nums">{p.credits}</span>
                  <span className="block text-[11px] text-neutral-500">credits</span>
                  <span className="mt-1 block text-sm font-medium text-accent">{rupees(p.rupees)}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-neutral-500">
              Current balance {user?.credits ?? 0} credits. Payments are handled by Razorpay — cards, UPI, net banking and wallets.
            </p>

            {!paymentsReady && (
              <p className="mt-3 rounded-md bg-amber-900/30 px-3 py-2 text-[11px] leading-snug text-amber-200">
                Payments are not switched on yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel → Settings → Environment Variables, then redeploy.
              </p>
            )}
            {error && <p className="mt-3 rounded-md bg-red-900/40 px-3 py-2 text-[11px] leading-snug text-red-200">{error}</p>}

            <button
              type="button"
              disabled={busy || !paymentsReady || !packId}
              onClick={pay}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-semibold text-neutral-950 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (<><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-900/30 border-t-neutral-900" />Opening payment…</>) : `Pay ${rupees((packs.find((p) => p.id === packId)?.rupees) || 0)}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
