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
})
