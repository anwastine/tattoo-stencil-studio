import { useCallback, useEffect, useRef, useState } from 'react'
import { api, loadScript } from './api.js'

const GSI = 'https://accounts.google.com/gsi/client'

/**
 * Renders Google's own "Sign in with Google" button. The browser gets an ID
 * token, which our server verifies before creating a session — the browser is
 * never trusted with who it says it is.
 */
export function GoogleSignIn({ clientId, onSignedIn, theme = 'filled_black', width = 250 }) {
  const holder = useRef(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const handle = useCallback(
    async (response) => {
      setBusy(true)
      setError(null)
      try {
        const out = await api('/api/auth/google', { method: 'POST', body: { credential: response.credential } })
        onSignedIn?.(out)
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(false)
      }
    },
    [onSignedIn],
  )

  useEffect(() => {
    if (!clientId || !holder.current) return
    let cancelled = false
    loadScript(GSI)
      .then(() => {
        if (cancelled || !holder.current || !window.google?.accounts?.id) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handle,
          // use_fedcm_for_prompt was removed by Google — One Tap is always FedCM now.
          // use_fedcm_for_button still defaults to false, so opt in: it keeps the
          // personalised button working when third-party cookies are blocked.
          use_fedcm_for_button: true,
          button_auto_select: false,
          auto_select: false,
          ux_mode: 'popup',
          itp_support: true,
        })
        holder.current.innerHTML = ''
        window.google.accounts.id.renderButton(holder.current, {
          theme,
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'left',
          width,
        })
      })
      .catch((e) => setError(e.message))
    return () => { cancelled = true }
  }, [clientId, handle, theme, width])

  if (!clientId) {
    return (
      <p className="rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-left text-[11px] leading-snug text-paper-2">
        Sign-in is not switched on yet. Add GOOGLE_CLIENT_ID and SESSION_SECRET in Vercel → Settings → Environment Variables, then redeploy.
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={holder} className={busy ? 'pointer-events-none opacity-50' : ''} />
      {busy && <p className="stamp text-[10px] text-gold">Signing you in…</p>}
      {error && <p className="max-w-xs rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-center text-[11px] leading-snug text-paper-2">{error}</p>}
    </div>
  )
}

/** Signed-in user + credit balance, kept in sync with the server. */
export function useSession() {
  const [config, setConfig] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/config')
      .then((c) => {
        setConfig(c)
        setUser(c.user || null)
      })
      .catch(() => setConfig({ ready: {}, packs: [], providers: [] }))
      .finally(() => setLoading(false))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api('/api/auth/me')
      setUser(u)
      return u
    } catch {
      return null
    }
  }, [])

  const signOut = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* already gone */ }
    setUser(null)
    window.google?.accounts?.id?.disableAutoSelect?.()
  }, [])

  /** Adjust the balance locally after a spend/purchase without a round trip. */
  const setCredits = useCallback((credits) => {
    setUser((u) => (u && typeof credits === 'number' ? { ...u, credits } : u))
  }, [])

  return { config, user, setUser, loading, refresh, signOut, setCredits }
}
