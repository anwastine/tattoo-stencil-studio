import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })

function Stat({ label, value, hint }) {
  return (
    <div className="panel rounded-sm px-4 py-3">
      <p className="stamp text-[10px] text-paper-3/60">{label}</p>
      <p className="stamp mt-0.5 text-2xl tabular-nums text-paper">{value}</p>
      {hint && <p className="text-[10px] text-paper-3/50">{hint}</p>}
    </div>
  )
}

export default function Admin({ user }) {
  const [data, setData] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setError(null)
    try {
      setData(await api(`/api/admin/users${q ? `?search=${encodeURIComponent(q)}` : ''}`))
    } catch (e) {
      setError(e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search), 350)
    return () => clearTimeout(t)
  }, [search, load])

  const users = data?.users || []
  const stats = data?.stats

  const phones = useMemo(() => users.filter((u) => u.phone).map((u) => u.phone), [users])

  const downloadCsv = useCallback(() => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Name', 'Email', 'Mobile', 'Credits left', 'Stencils drawn', 'Credits bought', 'Joined', 'Last seen']
    const rows = users.map((u) => [u.name, u.email, u.phone, u.credits, u.spent, u.bought, u.joined, u.lastSeen].map(esc).join(','))
    const blob = new Blob([[head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tattoo-stencil-artists-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [users])

  const copyPhones = useCallback(() => {
    navigator.clipboard?.writeText(phones.join('\n'))
  }, [phones])

  /* ---------------- not an admin ---------------- */
  if (error && /administrator/i.test(error)) {
    return (
      <div className="grid min-h-dvh place-items-center px-5 text-center">
        <div className="panel max-w-sm rounded-sm p-6">
          <p className="wordmark text-2xl text-paper">Artists only past this point</p>
          <p className="mt-2 text-[12px] leading-snug text-paper-3/75">
            You're signed in as {user?.email}, which isn't an administrator on this site.
          </p>
          <a href="/" className="btn-quiet mt-4 inline-block rounded-sm px-4 py-2.5 text-[11px]">Back to the studio</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-gold/20 bg-ink/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="wordmark text-2xl leading-tight text-paper">The Books</h1>
            <p className="stamp text-[10px] text-paper-3/60">Everyone who has signed up</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={downloadCsv} disabled={!users.length} className="btn-quiet rounded-sm px-3 py-2 text-[11px] disabled:opacity-40">Export CSV</button>
            <button type="button" onClick={copyPhones} disabled={!phones.length} className="btn-quiet rounded-sm px-3 py-2 text-[11px] disabled:opacity-40">Copy {phones.length} numbers</button>
            <a href="/" className="btn-ink rounded-sm px-3.5 py-2 text-[11px]">Studio</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        {stats && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Artists" value={stats.users} hint={`+${stats.newThisWeek} this week`} />
            <Stat label="With mobile" value={stats.withPhone} hint={stats.users ? `${Math.round((stats.withPhone / stats.users) * 100)}% of sign-ups` : ''} />
            <Stat label="Stencils drawn" value={stats.stencilsDrawn} />
            <Stat label="Credits sold" value={stats.creditsSold} />
            <Stat label="Revenue" value={`₹${stats.revenueRupees.toLocaleString('en-IN')}`} hint={`${stats.paidOrders} paid orders`} />
            <Stat label="Credits held" value={stats.creditsHeld} hint="unspent balance" />
          </div>
        )}

        <div className="mt-5 mb-3 flex items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or mobile…"
            className="w-full max-w-sm rounded-sm border border-gold/25 bg-ink-2 px-3 py-2.5 text-[13px] text-paper outline-none placeholder:text-paper-3/40 focus:border-gold"
          />
          <span className="stamp shrink-0 text-[10px] text-paper-3/50">{users.length} shown</span>
        </div>

        {error && <p className="mb-3 rounded-sm border border-red/50 bg-red/15 px-3 py-2 text-[12px] text-paper-2">{error}</p>}

        <div className="panel overflow-x-auto rounded-sm">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-gold/20">
                {['Artist', 'Email', 'Mobile', 'Credits', 'Drawn', 'Bought', 'Joined'].map((h) => (
                  <th key={h} className="stamp px-3 py-2.5 text-[10px] font-normal text-gold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !users.length && (
                <tr><td colSpan={7} className="stamp px-3 py-8 text-center text-[11px] text-paper-3/50">Loading…</td></tr>
              )}
              {!loading && !users.length && !error && (
                <tr><td colSpan={7} className="stamp px-3 py-8 text-center text-[11px] text-paper-3/50">No one yet</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gold/10 last:border-0 hover:bg-gold/[0.04]">
                  <td className="px-3 py-2.5 text-[13px] text-paper">{u.name || '—'}</td>
                  <td className="px-3 py-2.5 text-[12px] text-paper-2">{u.email}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums">
                    {u.phone ? <a href={`tel:${u.phone}`} className="text-gold hover:underline">{u.phone}</a> : <span className="text-paper-3/35">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] tabular-nums text-paper">{u.credits}</td>
                  <td className="px-3 py-2.5 text-[13px] tabular-nums text-paper-3">{u.spent}</td>
                  <td className="px-3 py-2.5 text-[13px] tabular-nums text-paper-3">{u.bought}</td>
                  <td className="px-3 py-2.5 text-[12px] text-paper-3/70">{fmtDate(u.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 pb-8 text-[10px] leading-snug text-paper-3/45">
          Mobile numbers were given voluntarily for the tattoo artist channel. Use them only for
          that, keep the list off any public place, and delete a number if someone asks.
        </p>
      </main>
    </div>
  )
}
