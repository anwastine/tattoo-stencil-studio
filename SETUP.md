# Go-live checklist

**Sign-in is live.** Anyone with a Google account can now sign in and get 29
free credits. The only thing left is payments, and only when you want to start
charging.

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
| Sign in with Google | ✅ done — published to production |
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

## Step 2 — Sign in with Google ✅ DONE

A dedicated Google Cloud project (**Tattoo Stencil Studio**, id
`tattoo-stencil-studio`) was created so the consent screen carries this app's
own name rather than another project's.

- OAuth consent screen: app name "Tattoo Stencil Studio", support and developer
  contact anwastine@gmail.com, home page / privacy / terms pointing at the live
  site, audience **External**, publishing status **In production** — so any
  Google account can sign in, not just test users.
- OAuth client "Tattoo Stencil Studio Web" with authorised JavaScript origins
  for the live site, the team alias and `http://localhost:8801`. No redirect
  URIs, which this flow does not use. The client secret was never needed.
- `GOOGLE_CLIENT_ID` set in Vercel for all three environments and redeployed.

Manage it at
https://console.cloud.google.com/auth/clients?project=tattoo-stencil-studio

If you later add a custom domain, add it in two places or sign-in will break:
the OAuth client's **Authorised JavaScript origins**, and **Branding →
Authorised domains**.

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
