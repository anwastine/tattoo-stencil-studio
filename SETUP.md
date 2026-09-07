# Go-live checklist

The app is built, deployed, and the database is live. One short step is left
before people can sign in: creating the Google sign-in client.

Live now: https://tattoo-stencil-studio-kappa.vercel.app

Everything you add goes in the same place:
**vercel.com → tattoo-stencil-studio → Settings → Environment Variables →
Add New**, tick **Production, Preview and Development**, Save. When you have
added everything in a step, go to **Deployments → ⋯ → Redeploy**.

Status right now:

| Piece | State |
| --- | --- |
| Drawing (OpenAI) | ✅ working |
| Accounts + credits database | ✅ done — Neon free plan, provisioned and tested |
| Session key | ✅ done |
| Sign in with Google | ⬜ **only this is left** — step 2, ~5 minutes |
| Card / UPI payments | ⬜ step 3, whenever you want to start charging |

---

## Step 1 — Database ✅ DONE

A Neon Postgres database (**free plan**, `tattoo-stencil-db`) is provisioned
and connected to production, preview and development. The four tables —
users, welcome_grants, ledger, orders — are created and tested: a new account
gets 29 credits, a repeat sign-in gets none, and two simultaneous requests
cannot both spend the last credit.

`SESSION_SECRET` is also set, for all three environments.

Nothing to do here.

---

## Step 2 — Sign in with Google (~5 minutes, free) ← **the only thing left**

Send me the Client ID when you have it and I will put it into Vercel and
redeploy — it is a public identifier, not a secret, so it is safe to paste
here. (The client *secret* is never needed; don't send that.)

1. Go to https://console.cloud.google.com/apis/credentials and sign in with
   anwastine@gmail.com. Create a project if it asks.
2. **Create credentials → OAuth client ID → Application type: Web application.**
3. Under **Authorised JavaScript origins** click *Add URI* twice and add:
   - `https://tattoo-stencil-studio-kappa.vercel.app`
   - `http://localhost:8801`
4. Leave **Authorised redirect URIs empty.** This sign-in flow does not use them.
5. Click **Create** and copy the **Client ID** (it ends in
   `.apps.googleusercontent.com`). You do **not** need the client secret —
   don't add it anywhere.
6. Send me that Client ID, or add it in Vercel yourself as `GOOGLE_CLIENT_ID`.
7. Still in Google Cloud, open **APIs & Services → OAuth consent screen**.
   Fill in the app name, your support email and developer contact. Keep the
   scopes to `email`, `profile`, `openid`. Then press **Publish app** —
   until you do, only accounts you list by hand can sign in.
Once the Client ID is in and the site redeploys, sign-in and the 29 free
credits work immediately — the database behind them is already live.

---

## Step 3 — Taking payments (Razorpay)

Test keys work immediately. Live keys need Razorpay to approve the account,
and they check the policy pages, so do the placeholders first.

### 3a. Fill in your business details

Open these six files and replace every highlighted placeholder — business
name, address, email, phone, grievance officer, city:

```
public/legal/contact.html
public/legal/terms.html
public/legal/privacy.html
public/legal/refunds.html
public/legal/pricing.html
public/legal/shipping.html
```

Placeholders look like `[BUSINESS NAME]` and are highlighted in orange on the
page, so they are easy to spot. Ask me and I'll edit them for you — just send
me the details.

### 3b. Open the account

1. Sign up at https://dashboard.razorpay.com/signup.
2. **Settings → API Keys** → generate **test mode** keys.
3. In Vercel add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, then redeploy.
   Top-ups now work with Razorpay's test cards.
4. For real money: complete KYC, and under **Account Settings → Business
   Website Details** submit these URLs:
   - `https://tattoo-stencil-studio-kappa.vercel.app/legal/terms.html`
   - `.../legal/privacy.html`
   - `.../legal/refunds.html`
   - `.../legal/shipping.html`
   - `.../legal/pricing.html`
   - `.../legal/contact.html`
5. Once approved, swap the test keys for the live ones in Vercel and redeploy.

### 3c. Webhook (recommended)

So a payment still lands if someone closes the tab mid-checkout:

**Settings → Webhooks → Add New Webhook**
- URL: `https://tattoo-stencil-studio-kappa.vercel.app/api/payments/webhook`
- Event: `payment.captured`
- Secret: make one up (or `openssl rand -hex 24`)

Add that same secret in Vercel as `RAZORPAY_WEBHOOK_SECRET`, then redeploy.

---

## The numbers

Set in `api/_lib/config.js`, one place, easy to change:

- 29 free credits on first sign-in, once per email address
- ₹9 per credit, 1 credit per stencil
- Packs of 10 / 25 / 50 / 100 credits
- 30 stencils per hour and 120 per day per account, one at a time

A stencil costs roughly ₹5–7 in OpenAI charges, so each ₹9 credit leaves a
small margin. Watch your real spend at https://platform.openai.com/usage for
the first week and raise the price if the margin is too thin.

Failed drawings refund the credit automatically, so nobody pays for a stencil
they didn't get.

---

## Once it's live

- **Your own free credits:** you get 29 like everyone else. To give yourself
  more, ask me and I'll add them to your account directly.
- **A custom domain** (e.g. tattoostencil.in): buy it, then Vercel → Settings
  → Domains → Add. Remember to add the new domain to the Google
  **Authorised JavaScript origins** list too, or sign-in breaks.
- **Watch the spend:** OpenAI usage page, and Vercel → Logs for errors.
