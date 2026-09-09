/*
 * Business rules in one place. Change a number here and the whole app follows:
 * the UI reads these values from GET /api/config.
 */

/** Free credits granted once, the first time a person signs in with Google. */
export const WELCOME_CREDITS = 10

/** Rupees per credit. Displayed everywhere; orders are created in paise. */
export const RUPEES_PER_CREDIT = 9

/**
 * Credits burned per generation. One size, one credit.
 * A 1K render costs roughly $0.05-0.08 against ₹9 (~$0.10) of revenue, so this
 * stays profitable. Raise RUPEES_PER_CREDIT before adding larger output sizes.
 */
export const OUTPUT_SIZE = '1K'
export const CREDIT_COST = { '1K': 1 }

export const creditCostFor = () => CREDIT_COST[OUTPUT_SIZE]

/** Recharge packs. Straight ₹9 per credit, no bonus, so the maths stays obvious. */
export const PACKS = [
  { id: 'p10', credits: 10 },
  { id: 'p25', credits: 25 },
  { id: 'p50', credits: 50 },
  { id: 'p100', credits: 100 },
]

export const packById = (id) => PACKS.find((p) => p.id === id) || null

/** Razorpay works in paise. */
export const paiseFor = (credits) => credits * RUPEES_PER_CREDIT * 100

/**
 * Referrals. The referrer is paid once, the first time someone they invited
 * buys credits.
 *
 * THE MATHS: a credit sells for RUPEES_PER_CREDIT and costs roughly ₹5-7 to
 * draw, so a ₹90 starter pack earns about ₹30 of margin. Paying 5 credits back
 * spends about that much, which puts a referral at break-even — and slightly
 * ahead in practice, since a credit only costs anything once it is spent.
 *
 * The minimum stays at the smallest pack on purpose. Raising it to 25 would
 * make each payout profitable, but the ₹90 pack is what most people buy first,
 * so most referrals would never pay out at all — and a programme people invite
 * to and earn nothing from is one they stop using.
 */
export const REFERRAL_CREDITS = 5
export const REFERRAL_MIN_PURCHASE = 10

/** Anti-abuse limits. */
export const LIMITS = {
  generationsPerHour: 30, // per user
  generationsPerDay: 120, // per user
  concurrentGenerations: 1, // one render at a time per user
}

export const publicConfig = () => ({
  welcomeCredits: WELCOME_CREDITS,
  rupeesPerCredit: RUPEES_PER_CREDIT,
  creditCost: CREDIT_COST,
  outputSize: OUTPUT_SIZE,
  creditsPerStencil: CREDIT_COST[OUTPUT_SIZE],
  packs: PACKS.map((p) => ({ ...p, rupees: p.credits * RUPEES_PER_CREDIT })),
  referralCredits: REFERRAL_CREDITS,
  referralMinPurchase: REFERRAL_MIN_PURCHASE,
})
