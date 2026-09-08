# Go-live checklist

**Sign-in is live.** Anyone with a Google account can now sign in and get 29
free credits. The only thing left is payments, and only when you want to start
charging.

Live now: **https://sui.ink**

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

### Where this stands

The existing Razorpay account (Mohmed Anwar Pasha, MID TPfQy39JU20CGt) is
**fully activated** with a live key and one approved website,
eventproductsindia.com. KYC is already done there.

**But sui.ink cannot go on that account.** When adding a second website
Razorpay states plainly: *"Additional websites must follow the same business
model as your first site. For a different business model, you'll need to
create a separate Razorpay account, though you can use the same login
credentials."* Event products and an AI stencil service are different
business models, so sui.ink needs its own account.

The legal pages are finished and carry the registered identity:
Mohmed Anwar Pasha, O-08 2nd Floor, Signature Global Park 2&3, Dhunela,
Sector 36, Sohna, Gurugram, Haryana 122103. Not GST registered, so no GSTIN
is shown and no GST is charged.

### 3a. Prove it works first, in Test Mode (no new account needed)

Test keys work immediately, on any domain, with no website approval.

1. In the Razorpay dashboard click the **MP** avatar → **Enable Test Mode**.
2. **Account & Settings → Websites & API keys → Generate Test Key**.
   Copy the `rzp_test_...` id and the secret (shown once).
3. In Vercel → Settings → Environment Variables add, ticking all three
   environments:
   - `RAZORPAY_KEY_ID` = the `rzp_test_...` id
   - `RAZORPAY_KEY_SECRET` = the test secret
4. Redeploy, then the wallet can be tested end to end with Razorpay's test
   cards. No real money moves.

### 3b. Then open a separate account for sui.ink

Use **Create new account** from that same dialog — same login credentials, new
merchant account. It needs its own KYC (PAN, bank account, address), and then
submit `https://sui.ink` plus the six policy page URLs under
**Account Settings → Business Website Details**.

When it is approved, swap the two Vercel variables for that account's live
key pair and redeploy.

**Never click "Regenerate Key" on the live key of the events account** — it is
in use by eventproductsindia.com and regenerating stops payments there until
that site is updated too.

### 3c. Webhook (optional, add when live)

**Settings → Webhooks → Add New Webhook**
- URL: `https://sui.ink/api/payments/webhook`
- Event: `payment.captured`
- Secret: one you choose, also stored in Vercel as `RAZORPAY_WEBHOOK_SECRET`

Credits still land without it — the browser confirms payment and the server
verifies the capture with Razorpay directly. The webhook is a safety net for
someone closing the tab mid-payment.

## Lettering in Indian languages

The studio has two modes, switched at the top: **Portrait** and **Lettering**.

Lettering takes a name or phrase in Hindi, Tamil, Telugu, Kannada, Malayalam,
Bengali, Gujarati, Punjabi, Odia or Urdu, and inks it as a stencil in one of
six moods — Name, Emotional, Flexing, Devotional, Minimal or Ornamental.
One credit, same as a portrait.

**How the spelling is protected.** AI image models mangle Indic conjuncts and
matras when they write a script from scratch, and a misspelt tattoo cannot be
undone. So the browser typesets the phrase in a real Unicode font first, and
the model is only ever asked to *restyle those exact shapes*. Two consequences
worth knowing:

- **Clean type** is always downloadable on its own. Its spelling is correct by
  construction, whatever the AI does.
- The panel tells the artist to compare the two and have a native reader check
  it before tattooing. Keep that message there.

If you want to add a language, the list is at the top of `src/Lettering.jsx` —
each entry needs a Google Fonts family that covers the script.

## The admin panel

**https://sui.ink/admin** — or "The books" in
your account menu. Signed-in admins only; everyone else gets turned away.

It lists every artist who has signed up with their email, mobile number
(where they gave one), credit balance, stencils drawn and credits bought,
plus totals across the top and a search box. **Export CSV** downloads the
whole list; **Copy numbers** puts just the mobile numbers on your clipboard
for a broadcast list.

Admins are whoever is listed in the `ADMIN_EMAILS` environment variable,
comma separated. It is currently set to anwastine@gmail.com — tell me if you
want to add someone.

## The mobile number prompt

Right after an artist signs in for the first time, they are asked once for
their mobile number to join "India's largest tattoo artist channel, opening
soon". It is genuinely optional: "Not now" dismisses it for good, and either
way they keep their credits and full use of the studio. Numbers are validated
as Indian mobiles and stored as +91XXXXXXXXXX.

The privacy policy now states that the number is collected only for the
channel and can be deleted on request — keep that promise.

## Once it's live

- **Your own free credits:** you get 29 like everyone else. To give yourself
  more, ask me and I'll add them to your account directly.
- **A custom domain** (e.g. tattoostencil.in): buy it, then Vercel → Settings
  → Domains → Add. Remember to add the new domain to the Google
  **Authorised JavaScript origins** list too, or sign-in breaks.
- **Watch the spend:** OpenAI usage page, and Vercel → Logs for errors.
