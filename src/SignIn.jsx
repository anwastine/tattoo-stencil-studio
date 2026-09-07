import { GoogleSignIn } from './Auth.jsx'

/* ------------------------------------------------------------------ */
/*  Flash ornaments — the same motif vocabulary as the cursors, drawn  */
/*  large and stroke-only so the page reads like a flash sheet.        */
/* ------------------------------------------------------------------ */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const Rose = (p) => (
  <svg viewBox="0 0 32 32" {...p} aria-hidden="true">
    <g {...stroke}>
      <path d="M3 3 C7 7 9 11 10 15" />
      <path d="M6 14 C2 16 3 22 8 22" />
      <path d="M20 12 a7 7 0 1 1-9 9 a5 5 0 1 1 7-7 a3 3 0 1 1-3 4" />
      <path d="M13 24 C16 28 22 28 25 24" />
    </g>
  </svg>
)

const Dagger = (p) => (
  <svg viewBox="0 0 32 32" {...p} aria-hidden="true">
    <g {...stroke}>
      <path d="M3 3 L12.5 15.5 L15.5 12.5 Z" />
      <path d="M9.5 19 L19 9.5" />
      <path d="M15 15 L22.5 22.5" />
      <circle cx="25" cy="25" r="2.6" />
    </g>
  </svg>
)

const Swallow = (p) => (
  <svg viewBox="0 0 32 32" {...p} aria-hidden="true">
    <g {...stroke}>
      <path d="M3 3 C9 6 12 10 13 15" />
      <path d="M13 15 C17 9 23 7 29 8 C25 12 24 17 22 21" />
      <path d="M22 21 C18 24 12 24 8 21" />
      <path d="M8 21 L4 27 L11 25" />
    </g>
  </svg>
)

const Diamond = ({ className = '' }) => (
  <svg viewBox="0 0 12 12" className={className} aria-hidden="true" fill="currentColor">
    <path d="M6 0 L9 6 L6 12 L3 6 Z" />
  </svg>
)

const POINTS = [
  { numeral: 'I', title: 'Five stencil styles', body: 'Studio realism, fine line, bold traditional, pure dotwork, or a full contour map for black-and-grey work.' },
  { numeral: 'II', title: 'Ready for the machine', body: 'Threshold to solid ink, mirror it for transfer, drop the background out, and download a full-size PNG.' },
  { numeral: 'III', title: 'Your drawing, your client', body: 'Every run is a fresh draw, so keep going until the likeness is right. Nothing you upload is stored.' },
]

/* ------------------------------------------------------------------ */

export default function SignIn({ config, onSignedIn }) {
  const welcomeCredits = config?.welcomeCredits ?? 29
  const rupees = config?.rupeesPerCredit ?? 9

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* faint flash art pinned to the wall behind everything */}
      <Rose className="pointer-events-none absolute -top-10 -left-16 h-72 w-72 text-gold/[0.06] sm:h-96 sm:w-96" />
      <Dagger className="pointer-events-none absolute -right-14 top-1/3 h-64 w-64 rotate-12 text-red/[0.07] sm:h-80 sm:w-80" />
      <Swallow className="pointer-events-none absolute -bottom-12 left-1/4 h-64 w-64 -rotate-6 text-gold/[0.05] sm:h-80 sm:w-80" />

      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:px-6">
        {/* mark */}
        <span className="mb-5 grid h-14 w-14 place-items-center rounded-sm border border-gold/40 bg-ink-2 text-red-bright">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6 L16 14" /><path d="M13 19 L21 27" /><path d="M11 22 L19 14" /><path d="M15 26 L23 18" /><path d="M20 15 L24 19" />
          </svg>
        </span>

        <div className="ornament mb-3 w-full max-w-xs"><Diamond className="h-2 w-2" /></div>
        <h1 className="wordmark text-[40px] leading-[0.95] text-paper sm:text-[56px]">Tattoo Stencil Studio</h1>
        <p className="stamp mt-2 text-[11px] text-gold sm:text-[12px]">Portrait photo → hand-inked stencil</p>
        <div className="ornament mt-3 mb-7 w-full max-w-xs"><Diamond className="h-2 w-2" /></div>

        <p className="max-w-md text-[15px] leading-relaxed text-paper-2">
          Upload a client's photo and get a clean, transfer-ready stencil in under a minute —
          confident linework and dot-work shading, drawn the way you would draw it.
        </p>

        {/* the gate */}
        <div className="rule-double mt-8 w-full max-w-sm rounded-sm p-6">
          <p className="wordmark text-2xl text-paper">{welcomeCredits} stencils, on the house</p>
          <p className="mx-auto mt-2 mb-5 max-w-[17rem] text-[12px] leading-snug text-paper-3/80">
            Sign in with Google and start drawing straight away. No card, no trial period, nothing to cancel.
          </p>
          <div className="flex justify-center">
            <GoogleSignIn clientId={config?.googleClientId} onSignedIn={onSignedIn} width={260} />
          </div>
          <p className="mt-4 text-[11px] leading-snug text-paper-3/55">
            After the free {welcomeCredits}, credits are ₹{rupees} each — one credit per stencil.
          </p>
        </div>

        {/* what you get */}
        <div className="mt-10 grid w-full gap-2.5 text-left sm:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.numeral} className="panel rounded-sm p-4">
              <span className="stamp block text-[15px] text-red-bright">{p.numeral}</span>
              <span className="stamp mt-1 block text-[12px] text-paper">{p.title}</span>
              <span className="mt-1.5 block text-[11px] leading-snug text-paper-3/75">{p.body}</span>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 px-5 pb-8 text-center">
        <div className="ornament mx-auto mb-3 max-w-xs"><Diamond className="h-2 w-2" /></div>
        <nav className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          {[
            ['Pricing', 'pricing'],
            ['Terms', 'terms'],
            ['Privacy', 'privacy'],
            ['Refunds', 'refunds'],
            ['Delivery', 'shipping'],
            ['Contact', 'contact'],
          ].map(([label, slug], i) => (
            <span key={slug} className="flex items-center gap-2.5">
              {i > 0 && <Diamond className="h-1.5 w-1.5 text-gold/40" />}
              <a href={`/legal/${slug}.html`} className="stamp text-[10px] text-paper-3/60 hover:text-gold">{label}</a>
            </span>
          ))}
        </nav>
      </footer>
    </div>
  )
}

/** Shown for the moment it takes to find out whether you are already signed in. */
export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-sm border border-gold/30 bg-ink-2 text-red-bright">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6 L16 14" /><path d="M13 19 L21 27" /><path d="M11 22 L19 14" /><path d="M15 26 L23 18" />
          </svg>
        </span>
        <p className="stamp inkpulse text-[11px] text-paper-3/60">Opening the studio</p>
      </div>
    </div>
  )
}
