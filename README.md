# Tattoo Stencil Studio

Sign in with Google, upload a portrait, and an AI image model redraws it as a
hand-inked tattoo stencil. New accounts get **29 free credits**; after that,
credits cost **₹9 each**. One credit = one stencil.

Live: https://tattoo-stencil-studio-kappa.vercel.app

## What it does

- **Google sign-in** — the browser gets an ID token from Google Identity
  Services; the server verifies it against Google's JWKS and issues its own
  HttpOnly session cookie. The credit balance is never trusted from the browser.
- **29 welcome credits**, granted once per mailbox (Gmail dots and `+tags` are
  normalised so the same inbox cannot claim it twice).
- **Credits** — spent atomically in a single SQL statement, so two parallel
  requests can never both take the last credit. A failed generation is
  refunded automatically.
- **Wallet top-up** via Razorpay (UPI, cards, net banking, wallets). Crediting
  is idempotent: the browser callback and the webhook can both fire and the
  order is still only credited once.
- **Five stencil styles**, 1K/2K/4K output, hard black-and-white clean-up, ink
  colour, transparent background, mirror for transfer, full-size PNG export.

## Setup

Everything is configured with environment variables in
**Vercel → Project → Settings → Environment Variables** (tick all three
environments), then **Deployments → Redeploy**.

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `OPENAI_API_KEY` | generating | https://platform.openai.com/api-keys |
| `GEMINI_API_KEY` | alternative model | https://aistudio.google.com/apikey |
| `GOOGLE_CLIENT_ID` | sign-in | Google Cloud Console (below) |
| `SESSION_SECRET` | sign-in | `openssl rand -hex 32` |
| `DATABASE_URL` | accounts + credits | injected by Vercel → Storage → Neon |
| `RAZORPAY_KEY_ID` | payments | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | payments | same page |
| `RAZORPAY_WEBHOOK_SECRET` | payments (recommended) | you choose it when creating the webhook |

The app degrades gracefully: with no database it still runs as a signed-out
demo, and each missing piece shows its own message in the UI.

### 1. Database

Vercel dashboard → the project → **Storage** → **Create Database** → **Neon
(Postgres)** → **Connect Project**. `DATABASE_URL` appears automatically. The
tables create themselves on first use — there is no migration to run.

### 2. Google sign-in

1. https://console.cloud.google.com/apis/credentials → **Create credentials**
   → **OAuth client ID** → **Web application**.
2. **Authorised JavaScript origins**: add the live URL and
   `http://localhost:8801`. Leave **redirect URIs empty** — this flow does not
   use them.
3. Copy the Client ID into `GOOGLE_CLIENT_ID`. The client *secret* is not
   needed and should not be added anywhere.
4. **OAuth consent screen**: fill in the app name, support email and developer
   contact, keep the scopes to `openid`, `email`, `profile`, then
   **Publish app** — while it is in Testing only listed accounts can sign in.

### 3. Payments

1. Sign up at https://dashboard.razorpay.com/signup. Test-mode keys work
   immediately; live keys need activation.
2. Fill in the placeholders on the policy pages in `public/legal/` (business
   name, address, email, phone, grievance officer). Razorpay opens these during
   activation and rejects placeholder text.
3. Submit the policy URLs under **Account Settings → Business Website Details**.
4. After activation: **Settings → Webhooks → Add New Webhook**, URL
   `https://<your-domain>/api/payments/webhook`, event `payment.captured`,
   with a secret you also store as `RAZORPAY_WEBHOOK_SECRET`.

## Prices and margin

`api/_lib/config.js` holds every business number in one place — welcome
credits, rupees per credit, packs, credit cost per size, rate limits.

⚠️ At ₹9 a credit (≈$0.10) a 2K render costs roughly $0.30–0.45 and 4K more, so
**2K and 4K currently sell below cost**. To fix, edit one line:

```js
export const CREDIT_COST = { '1K': 1, '2K': 4, '4K': 8 }
```

The UI reads it from the server, so nothing else needs changing.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in what you want to test
npm run dev                  # http://localhost:8801
```

The dev server mounts everything in `api/` at the same paths Vercel uses, so
sign-in, credits and payments all work locally.

## Files

```
api/
  _lib/config.js       welcome credits, price, packs, limits
  _lib/db.js           Neon Postgres: users, ledger, orders, atomic spend
  _lib/session.js      Google ID-token verification + session cookie
  _lib/http.js         request/response helpers, log redaction
  auth/google.js       POST — sign in, grant the welcome bonus
  auth/me.js           GET  — current user + balance + history
  auth/logout.js       POST — clear the session
  payments/create-order.js  POST — create a Razorpay order
  payments/verify.js        POST — verify signature + capture, add credits
  payments/webhook.js       POST — server-to-server safety net
  stencil.js           POST — spend a credit and generate (refunds on failure)
  config.js            GET  — public config + current user
src/
  App.jsx              the whole UI
  Auth.jsx             Google button + session hook
  Wallet.jsx           credit pill, account menu, recharge dialog
  api.js               fetch wrapper + script loader
public/legal/          terms, privacy, refunds, delivery, pricing, contact
```

Deployed from GitHub `anwastine/tattoo-stencil-studio`; every push to `main`
redeploys.
